import asyncio
import logging
from collections import Counter
from dataclasses import dataclass, field
from typing import List, Dict, Any, Tuple, Optional

import numpy as np

from embedding_utils import embedding_to_pgvector_str

# Use __name__ to get a logger named "core_recognizer"
logger = logging.getLogger(__name__)


@dataclass
class RecognitionResult:
    """A data class to hold the final result of a recognition attempt."""
    camera_id: str
    track_id: str
    recognized: bool = False
    emp_id: Optional[str] = None
    emp_name: Optional[str] = None
    confidence: float = 0.0
    matches_count: int = 0
    total_processed_frames: int = 0
    errors: List[str] = field(default_factory=list)
    best_embedding: Optional[np.ndarray] = None

    def to_dict(self) -> Dict[str, Any]:
        """Converts the result to a dictionary for logging or JSON output."""
        return {
            "track_id": self.track_id,
            "camera_id": self.camera_id,
            "recognized": self.recognized,
            "emp_id": self.emp_id,
            "emp_name": self.emp_name,
            "confidence": self.confidence,
            "matches_count": self.matches_count,
            "total_processed_frames": self.total_processed_frames,
            "errors": self.errors
        }


class CoreRecognizer:
    """
    Performs face recognition on a batch of frames for a single track.

    It uses a majority-voting-with-threshold strategy to ensure
    high-confidence matches.
    """

    def __init__(self, extractor, majority_threshold: int, cosine_threshold: float, margin_threshold: float = 0.08):
        """
        Initializes the CoreRecognizer.

        Args:
            extractor: An instance of ArcFaceExtractor (or similar).
            majority_threshold (int): The number of frames (votes) required
                                      to win the majority vote.
            cosine_threshold (float): The minimum similarity score for the
                                      best-matching frame to be considered a valid ID.
            margin_threshold (float): Minimum gap between top match and runner-up (prevents false positives).
        """
        self.extractor = extractor
        self.majority_threshold = majority_threshold
        self.cosine_threshold = cosine_threshold
        self.margin_threshold = margin_threshold

    def _extract_single_embedding(self, frame_entry, idx: int):
        """
        Extract embedding for a single frame (runs in thread pool).
        Returns (embedding, error_string_or_None).
        """
        try:
            if isinstance(frame_entry, dict):
                # Fast path: pre-computed embedding from BestFrameSelector
                pre_emb = frame_entry.get("embedding")
                if pre_emb is not None:
                    return pre_emb, None

                crop = frame_entry.get("frame")
                full_frame = frame_entry.get("full_frame")
                face_row = frame_entry.get("face_row")
                bbox = frame_entry.get("bbox")
            else:
                crop = frame_entry
                full_frame = None
                face_row = None
                bbox = None

            emb = None

            # Strategy 1 (FASTEST + MOST RELIABLE): bbox-padded crop
            if emb is None and full_frame is not None and bbox is not None:
                try:
                    ih, iw = full_frame.shape[:2]
                    x1, y1, x2, y2 = [int(v) for v in bbox]
                    bw, bh = x2 - x1, y2 - y1
                    px, py = int(bw * 1.0), int(bh * 1.0)
                    cx1 = max(0, x1 - px)
                    cy1 = max(0, y1 - py)
                    cx2 = min(iw, x2 + px)
                    cy2 = min(ih, y2 + py)
                    padded_crop = full_frame[cy1:cy2, cx1:cx2]
                    if padded_crop.size > 0:
                        emb = self.extractor.extract_embedding(padded_crop)
                except Exception as bbox_err:
                    logger.debug(f"Bbox-padded crop failed @frame_idx={idx}: {bbox_err}")

            # Strategy 2: aligned embedding via YuNet landmarks
            if (emb is None and full_frame is not None and face_row is not None
                    and hasattr(self.extractor, "extract_embedding_aligned")):
                try:
                    emb = self.extractor.extract_embedding_aligned(full_frame, face_row)
                except Exception as align_err:
                    logger.debug(f"Aligned embedding failed @frame_idx={idx}: {align_err}")

            # Strategy 3 (LAST RESORT): plain tight crop
            if emb is None and crop is not None:
                emb = self.extractor.extract_embedding(crop)

            if emb is None:
                return None, f"Embedding failed @frame_idx={idx}"
            return emb, None

        except Exception as e:
            return None, f"Embedding error @frame_idx={idx}: {str(e)}"

    async def _get_frame_matches(self, frames: List, db) -> Tuple[List[tuple], List[np.ndarray], List[str]]:
        """
        OPTIMIZED: Parallel embedding extraction + pre-computed embedding support.

        - If a frame has a pre-computed 'embedding' key, uses it instantly (no inference).
        - Otherwise, extracts embeddings in PARALLEL using asyncio.gather + to_thread.
        - Then batch-queries the DB for matches.
        """
        frame_matches = []
        embeddings = []
        errors = []

        try:
            # Check if any frames have pre-computed embeddings (fast path)
            has_precomputed = any(
                isinstance(f, dict) and f.get("embedding") is not None
                for f in frames
            )

            if has_precomputed:
                # Fast path: extract synchronously (pre-computed = instant)
                for idx, frame_entry in enumerate(frames):
                    emb, err = self._extract_single_embedding(frame_entry, idx)
                    if err:
                        errors.append(err)
                    if emb is not None:
                        embeddings.append(emb)
            else:
                # Parallel path: run all extractions concurrently in thread pool
                tasks = [
                    asyncio.to_thread(self._extract_single_embedding, frame_entry, idx)
                    for idx, frame_entry in enumerate(frames)
                ]
                results = await asyncio.gather(*tasks, return_exceptions=True)

                for result in results:
                    if isinstance(result, Exception):
                        errors.append(f"Thread error: {str(result)}")
                    else:
                        emb, err = result
                        if err:
                            errors.append(err)
                        if emb is not None:
                            embeddings.append(emb)

            if not embeddings:
                return frame_matches, embeddings, errors

            # OPTIMIZED: Batch query DB for all embeddings
            emb_strs = [embedding_to_pgvector_str(emb) for emb in embeddings]

            try:
                if hasattr(db, 'query_best_matches_batch'):
                    matches_list = await db.query_best_matches_batch(emb_strs)
                    for emb_idx, match in enumerate(matches_list):
                        if match:
                            frame_matches.append(
                                (match['empid'], match['similarity'], emb_idx, match.get('name'))
                            )
                        else:
                            frame_matches.append(("unknown", 0.0, emb_idx, None))
                else:
                    for emb_idx, emb_str in enumerate(emb_strs):
                        match = await db.query_best_match_unfiltered(emb_str)
                        if match:
                            frame_matches.append(
                                (match['empid'], match['similarity'], emb_idx, match.get('name'))
                            )
                        else:
                            frame_matches.append(("unknown", 0.0, emb_idx, None))
            except Exception as e:
                errors.append(f"DB query error: {str(e)}")
                logger.warning(f"Batch DB query failed, falling back to sequential: {e}")
                for emb_idx, emb_str in enumerate(emb_strs):
                    try:
                        match = await db.query_best_match_unfiltered(emb_str)
                        if match:
                            frame_matches.append(
                                (match['empid'], match['similarity'], emb_idx, match.get('name'))
                            )
                        else:
                            frame_matches.append(("unknown", 0.0, emb_idx, None))
                    except Exception as e2:
                        errors.append(f"Sequential query error @emb_idx={emb_idx}: {str(e2)}")

        except Exception as e:
            errors.append(f"Batch processing error: {str(e)}")
            logger.error(f"Error in batch embedding extraction: {e}")

        return frame_matches, embeddings, errors

    def _perform_majority_vote(self, frame_matches: List[tuple]) -> Tuple[Optional[str], int]:
        """
        Private helper to count votes and find a winner.
        """
        emp_votes = [fm[0] for fm in frame_matches if fm[0] != "unknown"]
        if not emp_votes:
            return None, 0

        counts = Counter(emp_votes)
        winning_emp_id, winning_count = counts.most_common(1)[0]
        return winning_emp_id, winning_count

    async def recognize_track(self, camera_id: str, track_id: str, frames: List[np.ndarray], db) -> RecognitionResult:
        """
        Main recognition logic, refactored to call helper methods.
        OPTIMIZED: Uses batch embedding extraction and optimized DB queries.

        This method is now a "coordinator" that is easy to read.
        """
        result = RecognitionResult(camera_id, track_id)

        # 1. Get embeddings and matches from the database (now with batch optimization)
        frame_matches, embeddings, errors = await self._get_frame_matches(frames, db)
        result.errors.extend(errors)
        result.total_processed_frames = len(embeddings)

        if not frame_matches:
            result.errors.append("No frames were successfully processed for embeddings.")
            logger.warning(f"Track {track_id}: No frames processed -> UNKNOWN")
            return self._format_unknown_result(result, embeddings)

        # 2. Perform majority voting
        winning_emp_id, winning_count = self._perform_majority_vote(frame_matches)
        result.matches_count = winning_count

        if not winning_emp_id:
            result.errors.append("No valid matches found across frames.")
            logger.info(f"Track {track_id}: No valid matches found -> UNKNOWN")
            return self._format_unknown_result(result, embeddings)

        # 3. Check if the winner passes the thresholds
        if winning_count < self.majority_threshold:
            result.errors.append(
                f"Majority vote failed for {winning_emp_id} ({winning_count}/{len(frame_matches)} "
                f"needed {self.majority_threshold})")
            logger.info(
                f"Track {track_id}: Majority vote failed ({winning_count}/{len(frame_matches)} "
                f"needed {self.majority_threshold}) -> UNKNOWN")
            return self._format_unknown_result(result, embeddings)

        # 4. Winner is valid, find their best-scoring frame
        winning_matches = [(sim, emb_idx, name) for empid, sim, emb_idx, name in frame_matches if
                           empid == winning_emp_id]

        if not winning_matches:
            # This should be logically impossible, but good to check
            result.errors.append("Logic error: Majority winner found but no matching frames recorded.")
            logger.error(f"Track {track_id}: Logic error during recognition.")
            return self._format_unknown_result(result, embeddings)

        # Find the best frame among the winner's matches
        best_match_tuple = max(winning_matches, key=lambda x: x[0])
        max_similarity, best_match_index, best_match_name = best_match_tuple

        # 5. Final check: Does the best frame pass the similarity threshold?
        if max_similarity < self.cosine_threshold:
            result.errors.append(
                f"Majority vote passed ({winning_count}/{len(frame_matches)}) but Max Similarity failed "
                f"({max_similarity:.4f} < {self.cosine_threshold})")
            logger.info(
                f"Track {track_id}: Majority vote passed BUT Max Similarity failed "
                f"({max_similarity:.4f} < {self.cosine_threshold}) -> UNKNOWN")
            return self._format_unknown_result(result, embeddings)

        # 6. NEW: MARGIN-BASED VERIFICATION (anti-false-positive check)
        # Get runner-up to verify best match is significantly better than different employees
        best_embedding_str = embedding_to_pgvector_str(embeddings[best_match_index])
        top_matches = await db.query_top_k_matches(best_embedding_str, k=2)
        
        if len(top_matches) >= 2:
            winner_sim = top_matches[0]['similarity']
            runner_up_sim = top_matches[1]['similarity']
            runner_up_empid = top_matches[1]['empid']
            margin = winner_sim - runner_up_sim
            
            # Only check margin if runner-up is a DIFFERENT employee
            if str(runner_up_empid) != str(winning_emp_id):
                if margin < self.margin_threshold:
                    result.errors.append(
                        f"Margin check failed: {winning_emp_id} ({winner_sim:.4f}) vs "
                        f"{runner_up_empid} ({runner_up_sim:.4f}), margin={margin:.4f} < {self.margin_threshold}")
                    logger.warning(
                        f"Track {track_id}: 🚨 REJECTED - Too ambiguous between different employees! "
                        f"{winning_emp_id} ({winner_sim:.4f}) too close to {runner_up_empid} ({runner_up_sim:.4f}). "
                        f"Margin {margin:.4f} < {self.margin_threshold}")
                    return self._format_unknown_result(result, embeddings)
                else:
                    logger.info(
                        f"Track {track_id}: ✓ Margin check PASSED (different employees: {winning_emp_id}: {winner_sim:.4f} "
                        f"vs {runner_up_empid}: {runner_up_sim:.4f}, margin={margin:.4f})")
            else:
                # Same employee - that's OK, multiple templates is normal
                logger.debug(f"Track {track_id}: Runner-up is same employee (duplicate template), allowing")
        else:
            logger.debug(f"Track {track_id}: Could not verify margin (only {len(top_matches)} match found)")

        # 7. SUCCESS! We have a recognized, high-confidence match.
        result.recognized = True
        result.emp_id = winning_emp_id
        result.emp_name = best_match_name or "NameNotFound"
        result.confidence = float(max_similarity)
        result.best_embedding = embeddings[best_match_index]

        logger.info(
            f"Track {track_id}: ✅ RECOGNIZED as {result.emp_name} ({result.emp_id}) "
            f"| Majority: {winning_count}/{len(frame_matches)} | Similarity: {max_similarity:.4f}")

        return result

    def _format_unknown_result(self, result: RecognitionResult, embeddings: List[np.ndarray]) -> RecognitionResult:
        """
        Private helper to populate a RecognitionResult for an UNKNOWN track.
        """
        result.recognized = False
        result.emp_id = f"unk_{int(np.round(np.random.rand() * 1e8))}"
        result.emp_name = "Unknown"
        result.confidence = 0.0
        # Still provide the best_embedding (if any) for potential future use
        result.best_embedding = embeddings[0] if embeddings else None
        return result