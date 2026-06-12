import asyncio
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Any, List

import cv2
import numpy as np

# === Debugging Save ===
DEBUG_SAVE = False
DEBUG_SAVE_DIR = "debug_best_frames"
if DEBUG_SAVE:
    os.makedirs(DEBUG_SAVE_DIR, exist_ok=True)
# ======================

logger = logging.getLogger(__name__)  # Use __name__

# Use an internal sentinel to signal the flush task to stop
STOP_SENTINEL = object()


class BestFrameSelector:
    """
    Manages collection and quality scoring of frames for each detected track.
    Sends top-scored cropped frames to the recognition queue upon track timeout or completion.
    """

    # Minimum quality thresholds to reject garbage frames early
    MIN_CROP_SIZE = 60       # Minimum face crop width/height in pixels
    MIN_BLUR_THRESHOLD = 30.0  # Minimum Laplacian variance (sharpness)

    def __init__(self, top_k=7, track_timeout_seconds=3.0, trigger_threshold=0.5, sent_mute_seconds=10.0, extractor=None):
        self.top_k = top_k
        self.track_timeout = track_timeout_seconds
        self.trigger_threshold = trigger_threshold

        self.sent_mute_seconds = sent_mute_seconds
        # State Management
        self.best_frames: Dict[int, List[Dict[str, Any]]] = {}
        self.last_seen: Dict[int, float] = {}
        self.triggered_tracks: Dict[int, bool] = {}

        # --- FIX: Add a dictionary to track sent/muted tracks ---
        self.sent_tracks: Dict[int, float] = {}  # Maps track_id -> timestamp_sent

        # Task Management
        self._flush_queue = asyncio.Queue()
        self._flush_task: asyncio.Task | None = None

        # Eager embedding: pre-compute embeddings in background threads
        self._extractor = extractor
        self._thread_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="emb")
        # Track pending embedding futures per track_id
        self._pending_embeddings: Dict[int, List[Any]] = {}

    def _compute_embedding_sync(self, full_frame, bbox):
        """
        Compute embedding synchronously (called in thread pool).
        Uses bbox-padded crop for person-targeted extraction.
        """
        if self._extractor is None or full_frame is None or bbox is None:
            return None
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
                return self._extractor.extract_embedding(padded_crop)
        except Exception as e:
            logger.debug(f"Eager embedding failed: {e}")
        return None

    async def _resolve_pending_embeddings(self, track_id: int, frames_data: list):
        """Resolve any pending embedding futures and attach results to frame data."""
        pending = self._pending_embeddings.pop(track_id, [])
        loop = asyncio.get_event_loop()
        for frame_dict, future in pending:
            try:
                # Wait for the thread to finish (should be done or near-done)
                emb = await loop.run_in_executor(None, future.result, 0.5)
                if emb is not None:
                    frame_dict["embedding"] = emb
            except Exception:
                pass  # Embedding will be computed by recognizer as fallback

    # ---------------------------------------------------
    # Helper Methods - Optimized Computational Functions
    # ---------------------------------------------------
    def crop_frame(self, frame: np.ndarray, bbox: List[float]) -> np.ndarray:
        """Clamps bbox coordinates and returns the cropped frame."""
        h, w = frame.shape[:2]
        x1, y1, x2, y2 = bbox

        x1_clamped = int(np.clip(x1, 0, w - 1))
        y1_clamped = int(np.clip(y1, 0, h - 1))
        x2_clamped = int(np.clip(x2, 1, w))
        y2_clamped = int(np.clip(y2, 1, h))

        if y1_clamped >= y2_clamped or x1_clamped >= x2_clamped:
            logger.debug(f"Invalid crop dimensions for bbox={bbox}, frame={w}x{h}")
            return np.array([])

        return frame[y1_clamped:y2_clamped, x1_clamped:x2_clamped]

    def calculate_blur(self, cropped_frame: np.ndarray) -> float:
        """Calculates sharpness using variance of the Laplacian (less precise CV_32F)."""
        if cropped_frame.size == 0 or len(cropped_frame.shape) != 3:
            return 0.0
        try:
            gray = cv2.cvtColor(cropped_frame, cv2.COLOR_BGR2GRAY)
            return cv2.Laplacian(gray, cv2.CV_32F).var()
        except cv2.error as e:
            logger.warning(f"OpenCV error calculating blur: {e}")
            return 0.0

    def score_frame(self, confidence: float, blur: float) -> float:
        """Combines confidence and blur for a final quality score."""
        blur_norm = min(max(blur - 100, 0) / 900.0, 1.0)
        return 0.7 * confidence + 0.3 * blur_norm

    def _create_track_batch(self, track_frames_data: List[Dict[str, Any]], track_id: int, camera_id: str) -> Dict[
                                                                                                                 str, Any] | None:
        """Creates a recognition batch dictionary from collected frames."""
        if not track_frames_data:
            return None

        frame_entries = [
            {
                "frame": f["frame"],
                "full_frame": f.get("full_frame"),
                "face_row": f.get("face_row"),
                "bbox": f.get("bbox"),
                "embedding": f.get("embedding"),  # pre-computed by eager threads
            }
            for f in track_frames_data
            if f["frame"] is not None and f["frame"].size > 0
        ]

        if not frame_entries:
            return None

        return {
            "camera_id": camera_id,
            "queued_at": time.time(),  # timestamp for staleness check
            "tracks": [{
                "track_id": track_id,
                "frames": frame_entries
            }]
        }

    async def _dispatch_track_batch(self, batch: Dict[str, Any], recognition_batch_queue: asyncio.Queue, source: str):
        """Puts the batch into the recognition queue, handles errors."""
        try:
            await recognition_batch_queue.put(batch)
            logger.info(f"[Track {batch['tracks'][0]['track_id']}] Sent to recognition queue ({source}).")
        except Exception as e:
            logger.error(f"Failed to put batch for track {batch['tracks'][0]['track_id']} from {source}: {e}")

    # ---------------------------------------------------
    # Asynchronous Logic - Flush Task (CORRECTED)
    # ---------------------------------------------------

    # --- FIX: THIS FUNCTION MUST BE A CLASS METHOD (DE-INDENTED) ---
    async def _flush_stale_tracks(self, recognition_batch_queue: asyncio.Queue, stop_event: asyncio.Event):
        """
        Background task to handle timed-out tracks and dispatch batches.
        Communicates via an internal flush queue.
        """
        logger.info("[BestFrameSelector] Flush task started.")

        # --- FIX: The while loop MUST be the outermost layer ---
        while not stop_event.is_set():
            try:
                # --- FIX: The try/except block is INSIDE the loop ---
                item = await asyncio.wait_for(self._flush_queue.get(), timeout=0.5)

                if item is STOP_SENTINEL:
                    self._flush_queue.task_done()
                    break  # Exit the while loop

                if item is None:
                    self._flush_queue.task_done()
                    continue

                # Item contains (track_id, camera_id, track_frames_data, source)
                tid, cid, frames_data, source = item

                batch = self._create_track_batch(frames_data, tid, cid)

                if batch:
                    await self._dispatch_track_batch(batch, recognition_batch_queue, source)

                self._flush_queue.task_done()

            except asyncio.TimeoutError:
                pass  # Expected when queue is empty, the loop will just continue
            except asyncio.CancelledError:
                logger.info("[BestFrameSelector] Flush task cancelled.")
                break  # Exit the while loop
            except Exception as e:
                logger.error(f"[BestFrameSelector] Error in flush task: {e}", exc_info=True)
                # Log the error but continue the loop
                await asyncio.sleep(0.1)

        # This log will only run when the task is truly stopped
        logger.info("[BestFrameSelector] Flush task stopped.")

    # ---------------------------------------------------
    # Core Processing
    # ---------------------------------------------------
    async def process_frame(self, tracker_data: Dict[str, Any]):
        """Processes a single incoming frame and updates track state."""
        try:
            camera_id = tracker_data["camera_id"]
            frame = tracker_data["frame"]
            track_id = tracker_data["track_id"]
            bbox = tracker_data["bbox"]
            conf = tracker_data.get("confidence", 0.0)
            timestamp = tracker_data.get("timestamp", 0.0)

            # --- 0. CHECK IF TRACK IS MUTED (THE FIX) ---
            if track_id in self.sent_tracks:
                # If we sent this track recently, ignore all incoming frames for it.
                if (timestamp - self.sent_tracks.get(track_id, 0)) < self.sent_mute_seconds:
                    self.last_seen[track_id] = time.time()  # Still update last_seen to prevent timeout
                    return
                else:
                    # Mute period expired. Unmute the track and reset its trigger
                    # to allow it to be collected again if it's still visible.
                    self.sent_tracks.pop(track_id, None)
                    self.triggered_tracks.pop(track_id, None)
                    logger.info(f"[Track {track_id}] Mute period expired. Re-enabling collection.")

            # --- END FIX ---

            self.last_seen[track_id] = time.time()

            cropped = self.crop_frame(frame, bbox)
            if cropped.size == 0:
                return

            # Quality gate: reject tiny face crops that produce unreliable embeddings
            crop_h, crop_w = cropped.shape[:2]
            if crop_w < self.MIN_CROP_SIZE or crop_h < self.MIN_CROP_SIZE:
                logger.debug(f"[Track {track_id}] Crop too small ({crop_w}x{crop_h}), skipping")
                return

            blur = self.calculate_blur(cropped)

            # Quality gate: reject very blurry frames
            if blur < self.MIN_BLUR_THRESHOLD:
                logger.debug(f"[Track {track_id}] Crop too blurry ({blur:.1f}), skipping")
                return

            score = self.score_frame(conf, blur)

            # --- 1. TRIGGER CHECK (No Events) ---
            if track_id not in self.triggered_tracks:
                if score >= self.trigger_threshold:
                    self.triggered_tracks[track_id] = True
                    logger.info(f"[Track {track_id}] Triggered collection (score={score:.2f})")
                else:
                    return  # Skip frame until score meets trigger threshold

            # --- 2. COLLECTION AND SORTING ---
            if track_id not in self.best_frames:
                self.best_frames[track_id] = []

            # Stop collecting if already have top_k frames
            if len(self.best_frames[track_id]) >= self.top_k:
                return

            # face_row: raw YuNet detection row (15-element array with landmarks)
            # stored so the recognizer can do landmark-based alignment (key fix for FP)
            face_row = tracker_data.get("face_row", None)

            frame_dict = {
                "score": score,
                "camera_id": camera_id,
                "track_id": track_id,
                "timestamp": timestamp,
                "frame": cropped,
                "full_frame": frame,     # full decoded frame for landmark alignment
                "face_row": face_row,    # YuNet landmark row for alignment
                "bbox": bbox,            # tracker bbox [x1,y1,x2,y2] for targeted crop
            }
            self.best_frames[track_id].append(frame_dict)

            # EAGER EMBEDDING: submit to thread pool immediately
            if self._extractor is not None:
                future = self._thread_pool.submit(
                    self._compute_embedding_sync, frame, bbox
                )
                if track_id not in self._pending_embeddings:
                    self._pending_embeddings[track_id] = []
                self._pending_embeddings[track_id].append((frame_dict, future))

            self.best_frames[track_id].sort(key=lambda x: x["score"], reverse=True)
            self.best_frames[track_id] = self.best_frames[track_id][:self.top_k]

            # --- 3. IMMEDIATE DISPATCH CHECK ---
            if len(self.best_frames[track_id]) == self.top_k:
                logger.info(
                    f"[Track {track_id}] Collected {self.top_k} best frames — queuing immediately for recognition.")

                # Prepare data for flushing
                frames_data = self.best_frames.pop(track_id)

                # Resolve pending embeddings before dispatch
                await self._resolve_pending_embeddings(track_id, frames_data)

                # Mute this track instead of forgetting it
                self.sent_tracks[track_id] = timestamp

                await self._flush_queue.put((track_id, camera_id, frames_data, "immediate_send"))
                return

            # === DEBUG SAVE ===
            if DEBUG_SAVE:
                for i, bf in enumerate(self.best_frames[track_id]):
                    ts_str = str(bf["timestamp"]).replace(".", "_")
                    filename = f"{camera_id}_track{track_id}_rank{i + 1}_ts{ts_str}_score{bf['score']:.3f}.jpg"
                    save_path = os.path.join(DEBUG_SAVE_DIR, filename)
                    try:
                        if bf["frame"] is not None and bf["frame"].size > 0:
                            cv2.imwrite(save_path, bf["frame"])
                    except Exception as e:
                        logger.warning(f"Failed to save debug image {save_path}: {e}")
            # ==================

        except Exception as e:
            logger.error(f"Error processing detection: {e}", exc_info=True)

    # ---------------------------------------------------
    # Main Run Loop (CORRECTED)
    # ---------------------------------------------------
    async def run(self, tracker_output_queue: asyncio.Queue, recognition_batch_queue: asyncio.Queue,
                  stop_event: asyncio.Event):
        """Starts the main frame processing loop and the background flush task."""
        logger.info("BestFrameSelector (No Events) started...")

        # --- FIX: Wrap entire body in try/except to catch fatal startup errors ---
        try:
            self._flush_task = asyncio.create_task(
                self._flush_stale_tracks(recognition_batch_queue, stop_event)
            )

            await asyncio.sleep(0)
            logger.info("BestFrameSelector run loop starting...")

            while not stop_event.is_set():
                try:
                    # --- Check for stale tracks (Timeout) ---
                    now = time.time()
                    stale_tracks = [tid for tid, ts in self.last_seen.items() if (now - ts) > self.track_timeout]

                    for tid in stale_tracks:
                        frames_data = self.best_frames.pop(tid, [])
                        self.last_seen.pop(tid, None)
                        self.triggered_tracks.pop(tid, None)
                        self.sent_tracks.pop(tid, None)  # Also clear any mute state

                        if frames_data:
                            # Resolve any pending eager embeddings
                            await self._resolve_pending_embeddings(tid, frames_data)
                            camera_id = frames_data[0]["camera_id"]
                            logger.info(
                                f"[BestFrameSelector] Track {tid} timed out. Queuing {len(frames_data)} frames for recognition.")
                            await self._flush_queue.put((tid, camera_id, frames_data, "timeout_send"))

                    # --- Main Queue Get ---
                    tracker_data = await asyncio.wait_for(tracker_output_queue.get(), timeout=0.1)
                    if tracker_data is None:
                        break  # Shutdown signal

                    await self.process_frame(tracker_data)
                    tracker_output_queue.task_done()

                except asyncio.TimeoutError:
                    continue
                except Exception as e:
                    logger.error(f"Error reading from tracker queue: {e}")
                    await asyncio.sleep(0.1)

        except asyncio.CancelledError:
            logger.info("Run loop cancelled.")
        except Exception as e:
            # --- THIS IS THE CRITICAL LOG WE NEED ---
            logger.error(f"[BestFrameSelector] !!FATAL ERROR!! in run method: {e}", exc_info=True)
        finally:
            if self._flush_task:
                await self._flush_queue.put(STOP_SENTINEL)
                self._flush_task.cancel()
                await asyncio.gather(self._flush_task, return_exceptions=True)

            logger.info("BestFrameSelector shutting down.")