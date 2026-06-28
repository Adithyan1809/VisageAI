from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from typing import List
import os
import shutil
from pathlib import Path
import asyncio
import logging
import cv2
import numpy as np
import onnxruntime as ort
import asyncpg
from app.config.database import DATABASE_URL
from urllib.parse import urlparse
from datetime import datetime
from uuid import uuid4

router = APIRouter()
logger = logging.getLogger(__name__)

# Base directory for storing temporary enrollment images
ENROLLMENT_BASE_DIR = Path("enrollment_temp")
ENROLLMENT_BASE_DIR.mkdir(exist_ok=True)

# -------------------------
# DB CONFIG
# -------------------------
# Prefer the application's DATABASE_URL so credentials are consistent
DB_CONFIG = None
try:
    # DATABASE_URL in this project is like: postgresql+psycopg2://user:pass@host:port/db
    dsn = DATABASE_URL.replace("postgresql+psycopg2://", "postgresql://")
    parsed = urlparse(dsn)
    DB_CONFIG = {
        "host": parsed.hostname or "localhost",
        "port": parsed.port or 5432,
        "user": parsed.username or "postgres",
        "password": parsed.password or "",
        "database": parsed.path.lstrip("/") or "postgres",
        "dsn": dsn,
    }
except Exception:
    # fallback to reasonable defaults (can be edited by dev)
    DB_CONFIG = {
        "host": "localhost",
        "port": 5432,
        "user": "postgres",
        "password": "root",
        "database": "SMAP_DB",
        "dsn": None,
    }

# -------------------------
# ArcFace Model Config
# -------------------------
# Point to the repository Models directory (robust against where backend is executed from)
# Try a few likely locations so the service works whether the project root is the
# current repo or wrapped in an extra folder (as in this workspace).
BASE = Path(__file__).resolve().parents[3]
candidate_paths = [
    BASE / "Models" / "arcface_r100.onnx",
    BASE / "AI-Attendance-System" / "Models" / "arcface_r100.onnx",
    Path(__file__).resolve().parents[4] / "Models" / "arcface_r100.onnx",
]

ARCFACE_MODEL_PATH = None
for p in candidate_paths:
    if p.exists():
        ARCFACE_MODEL_PATH = p
        break

if ARCFACE_MODEL_PATH is None:
    # Fallback to the first candidate so the path is deterministic in error messages
    ARCFACE_MODEL_PATH = candidate_paths[0]
INPUT_SIZE = (112, 112)
EMBEDDING_DIM = 512

# -------------------------
# YuNet Face Detector Config
# -------------------------
YUNET_MODEL_PATH = None
yunet_candidates = [
    BASE / "Models" / "face_detection_yunet_2023mar.onnx",
    BASE / "AI-Attendance-System" / "Models" / "face_detection_yunet_2023mar.onnx",
    Path(__file__).resolve().parents[4] / "Models" / "face_detection_yunet_2023mar.onnx",
]
for p in yunet_candidates:
    if p.exists():
        YUNET_MODEL_PATH = p
        break

# Quality thresholds
MIN_FACE_SIZE = 60           # Minimum face width/height in pixels
MIN_BLUR_SCORE = 30.0        # Minimum sharpness for enrollment (lower than batch since camera frames may be noisier)
MIN_DETECTION_CONFIDENCE = 0.5  # Minimum face detection confidence


# ─────────────────────────────────────────────────────────────────────────────
# Face Detector for Enrollment — InsightFace buffalo_l backend
# No model path needed; InsightFace manages its own model cache (~/.insightface)
# ─────────────────────────────────────────────────────────────────────────────
class EnrollmentFaceDetector:
    """
    InsightFace-backed face detector for the enrollment API.

    Replaces the YuNet detector which had fragile path resolution.
    InsightFace's det_10g (RetinaFace) gives superior accuracy with zero
    manual model file management.
    """

    def __init__(self):
        self._app = _get_insight_app_enrollment()

    def _calculate_blur(self, image: np.ndarray) -> float:
        try:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            return float(cv2.Laplacian(gray, cv2.CV_64F).var())
        except Exception:
            return 0.0

    def detect_and_crop(self, image: np.ndarray) -> list:
        """
        Detect faces and return cropped regions with metadata.

        ROI nearest-person logic:
            proximity_score = bbox_area × laplacian_variance
        A person closer to the camera occupies more pixels AND is sharper
        (higher Laplacian variance). The product of the two signals is a
        robust depth proxy — the result list is sorted by it so index-0 is
        always the nearest enrolled person.

        Returns:
            List of dicts: {crop, full_image, face_row, confidence,
                            blur_score, bbox_area, proximity_score, is_nearest}
        """
        if image is None or image.size == 0:
            return []

        try:
            faces = self._app.get(image)
        except Exception as e:
            logger.warning(f"InsightFace detection failed: {e}")
            blur = self._calculate_blur(image)
            return [{"crop": image, "full_image": image, "face_row": None,
                     "confidence": 0.3, "blur_score": blur,
                     "bbox_area": image.shape[0] * image.shape[1],
                     "proximity_score": blur, "is_nearest": True}]

        if not faces:
            blur = self._calculate_blur(image)
            return [{"crop": image, "full_image": image, "face_row": None,
                     "confidence": 0.3, "blur_score": blur,
                     "bbox_area": image.shape[0] * image.shape[1],
                     "proximity_score": blur, "is_nearest": True}]

        results = []
        h, w = image.shape[:2]
        for face in faces:
            x1, y1, x2, y2 = [int(v) for v in face.bbox]
            x1, y1 = max(0, x1), max(0, y1)
            x2, y2 = min(w, x2), min(h, y2)
            if x2 <= x1 or y2 <= y1:
                continue

            fw, fh = x2 - x1, y2 - y1
            if fw < MIN_FACE_SIZE or fh < MIN_FACE_SIZE:
                continue

            # 15% margin for better embedding context
            mx, my = int(fw * 0.15), int(fh * 0.15)
            cx1, cy1 = max(0, x1 - mx), max(0, y1 - my)
            cx2, cy2 = min(w, x2 + mx), min(h, y2 + my)
            crop = image[cy1:cy2, cx1:cx2]
            if crop.size == 0:
                continue

            confidence = float(face.det_score) if hasattr(face, "det_score") else 0.9
            blur_score = self._calculate_blur(crop)
            bbox_area = fw * fh
            # proximity_score = bbox_area × laplacian_variance
            # Larger area = physically closer; higher laplacian = sharper/in-focus
            proximity_score = bbox_area * blur_score
            results.append({
                "crop": crop,
                "full_image": image,
                "face_row": None,   # InsightFace handles alignment internally
                "confidence": confidence,
                "blur_score": blur_score,
                "bbox_area": bbox_area,
                "proximity_score": proximity_score,
                "is_nearest": False,  # set after sorting
            })

        if not results:
            blur = self._calculate_blur(image)
            return [{"crop": image, "full_image": image, "face_row": None,
                     "confidence": 0.3, "blur_score": blur,
                     "bbox_area": image.shape[0] * image.shape[1],
                     "proximity_score": blur, "is_nearest": True}]

        # Sort by Laplacian-weighted proximity: largest AND sharpest face wins
        results.sort(key=lambda r: r["proximity_score"], reverse=True)
        results[0]["is_nearest"] = True

        if len(results) > 1:
            top = results[0]
            logger.warning(
                f"⚠️ Multiple faces detected ({len(results)}) — "
                f"selecting nearest (area={top['bbox_area']}px², "
                f"laplacian={top['blur_score']:.1f}, "
                f"score={top['proximity_score']:.0f})"
            )

        return results

    def get_bboxes(self, image: np.ndarray) -> list:
        """
        Return bounding boxes for the UI overlay, enriched with ROI proximity data.

        Each box includes:
            x, y, width, height  — pixel coordinates
            confidence           — detection score
            blur_score           — Laplacian variance of the face crop
            proximity_score      — bbox_area × blur_score (depth proxy)
            is_nearest           — True for the person closest to the camera
        """
        try:
            faces = self._app.get(image)
            h, w = image.shape[:2]
            boxes = []
            for face in faces:
                x1, y1, x2, y2 = [int(v) for v in face.bbox]
                x1, y1 = max(0, x1), max(0, y1)
                x2, y2 = min(w, x2), min(h, y2)
                confidence = float(face.det_score) if hasattr(face, "det_score") else 0.9
                if confidence < MIN_DETECTION_CONFIDENCE:
                    continue
                fw, fh = x2 - x1, y2 - y1
                crop = image[y1:y2, x1:x2]
                blur_score = self._calculate_blur(crop) if crop.size > 0 else 0.0
                bbox_area = fw * fh
                proximity_score = bbox_area * blur_score
                boxes.append({
                    "x": x1, "y": y1,
                    "width": fw, "height": fh,
                    "confidence": confidence,
                    "blur_score": round(blur_score, 2),
                    "proximity_score": round(proximity_score, 2),
                    "is_nearest": False,  # set below
                })

            if boxes:
                # Mark the highest proximity_score box as nearest
                boxes.sort(key=lambda b: b["proximity_score"], reverse=True)
                boxes[0]["is_nearest"] = True
                if len(boxes) > 1:
                    logger.debug(
                        f"ROI: {len(boxes)} faces — nearest score={boxes[0]['proximity_score']:.0f}"
                    )
            return boxes
        except Exception as e:
            logger.debug(f"get_bboxes failed: {e}")
            return []



# ──────────────────────────────────────────────────────────────────────────────
# ArcFace Extractor — InsightFace buffalo_l (w600k_r50) backend
# ──────────────────────────────────────────────────────────────────────────────
_insight_app_enrollment = None


def _get_insight_app_enrollment():
    """Lazy-load InsightFace buffalo_l for enrollment (singleton)."""
    global _insight_app_enrollment
    if _insight_app_enrollment is None:
        from insightface.app import FaceAnalysis
        _insight_app_enrollment = FaceAnalysis(
            name="buffalo_l",
            providers=["CPUExecutionProvider"]
        )
        _insight_app_enrollment.prepare(ctx_id=0, det_size=(640, 640))
        logger.info("✅ InsightFace buffalo_l loaded for enrollment (w600k_r50)")
    return _insight_app_enrollment


class ArcFaceExtractor:
    """
    Enrollment embedding extractor backed by InsightFace buffalo_l.

    Replaces the broken arcface_r100.onnx + manual preprocessing pipeline.
    InsightFace handles detection, 5-pt alignment, and L2-normed embedding.

    Discrimination: same-person ~0.65-1.0  |  different-person ~0.005-0.07
    """

    def __init__(self, model_path=None):
        self._app = _get_insight_app_enrollment()
        self.embedding_dim = 512

    def extract_embedding(self, frame: np.ndarray, face_row=None) -> np.ndarray | None:
        """
        Extract 512-d L2-normalised embedding from a face image.

        Args:
            frame:    BGR face crop (any size). InsightFace handles alignment internally.
            face_row: Ignored — InsightFace detects landmarks itself.

        Returns:
            512-d normalised numpy embedding, or None if no face found.
        """
        if frame is None or frame.size == 0:
            return None

        h, w = frame.shape[:2]
        if h < 20 or w < 20:
            return None

        try:
            faces = self._app.get(frame)

            if not faces:
                # Try with a small padding to help with tight crops
                pad = max(int(h * 0.15), int(w * 0.15), 10)
                padded = cv2.copyMakeBorder(frame, pad, pad, pad, pad,
                                             cv2.BORDER_REPLICATE)
                faces = self._app.get(padded)
                if not faces:
                    logger.debug("InsightFace: no face detected in crop or padded version")
                    return None

            # Use the largest detected face
            face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
            return face.normed_embedding.astype(np.float32)

        except Exception as e:
            logger.debug(f"InsightFace embedding failed: {e}")
            return None


# -------------------------
# DB FUNCTIONS
# -------------------------
async def save_face_template(person_id: str, employee_id: str, name: str, embedding: np.ndarray):
    """Save face embedding to PostgreSQL database"""
    try:
        # Convert embedding to pgvector format
        embedding_str = "[" + ",".join(str(float(x)) for x in embedding) + "]"
        
        conn = await asyncpg.connect(
            host=DB_CONFIG["host"],
            port=DB_CONFIG["port"],
            user=DB_CONFIG["user"],
            password=DB_CONFIG["password"],
            database=DB_CONFIG["database"]
        )

        # Acquire an advisory lock per-employee to serialize enrollments and avoid
        # race conditions that create duplicate active templates. Prefer a numeric
        # lock key when employee_id is numeric.
        async with conn.transaction():
            lock_key = None
            try:
                lock_key = int(employee_id)
            except Exception:
                # fallback: use a stable positive hash
                lock_key = abs(hash(employee_id)) % (2 ** 31)

            await conn.execute('SELECT pg_advisory_xact_lock($1)', lock_key)

            # Check if employee has existing templates (but don't delete them)
            existing_count = await conn.fetchval(
                "SELECT COUNT(*) FROM facial_templates "
                "WHERE (employee_id::text = $1::text OR person_id::text = $1::text) "
                "AND is_active=TRUE",
                employee_id
            )

            # Always INSERT new template(s) instead of updating
            # This allows accumulating multiple face embeddings for the same employee
            # which improves recognition accuracy
            sql = """
            INSERT INTO facial_templates
            (id, person_id, person_type, template_data, version, model_version, created_at,
             effective_from, is_active, employee_id, name)
            VALUES ($1, $2, 'employee', $3::vector, 1, 'arcface_r100_v1', NOW(), NOW(), TRUE, $4, $5)
            """
            template_id = str(uuid4())
            await conn.execute(sql, template_id, person_id, embedding_str, employee_id, name)
            
            if existing_count > 0:
                logger.info(f"✅ Added new embedding #{existing_count + 1} for {name} ({employee_id}) — keeping previous templates")
            else:
                logger.info(f"✅ Embedding saved for {name} ({person_id}) — first enrollment")
        
        # Close connection after transaction completes
        await conn.close()
        return True
    except Exception as e:
        logger.error(f"❌ DB Insert Error: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return False


@router.post("/enroll")
async def enroll_face(
    employee_id: str = Form(...),
    employee_name: str = Form(...),
    files: List[UploadFile] = File(...)
):
    """
    Endpoint to enroll a new employee's face.
    
    - employee_id: Unique employee identifier
    - employee_name: Employee's full name
    - files: List of face images for the employee
    
    IMPROVED: Now detects and crops faces before embedding extraction,
    and stores multiple templates for better accuracy.
    """
    
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")
    
    # Create a temporary folder for this employee
    employee_folder = ENROLLMENT_BASE_DIR / employee_name
    employee_folder.mkdir(exist_ok=True, parents=True)
    
    try:
        # Save uploaded files
        saved_files = []
        for idx, file in enumerate(files):
            if not file.content_type.startswith("image/"):
                continue
            
            file_extension = Path(file.filename).suffix
            filename = f"{employee_id}_{idx}{file_extension}"
            file_path = employee_folder / filename
            
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            
            saved_files.append(str(file_path))
        
        if not saved_files:
            raise HTTPException(status_code=400, detail="No valid image files uploaded")
        
        logger.info(f"Saved {len(saved_files)} images for {employee_name}")
        
        try:
            # Initialize extractor and face detector
            extractor = ArcFaceExtractor()
            face_detector = EnrollmentFaceDetector()
            
            # Process all images: detect face → crop → extract embedding
            embeddings = []
            quality_scores = []
            
            for img_path in saved_files:
                image = cv2.imread(img_path)
                if image is None:
                    logger.warning(f"⚠️ Could not read {img_path}")
                    continue
                
                try:
                    # ✅ FIXED: Detect and crop face before embedding
                    face_results = face_detector.detect_and_crop(image)
                    
                    if not face_results:
                        logger.warning(f"⚠️ No face found in {Path(img_path).name}")
                        continue
                    
                    # Use the best (highest confidence) face
                    best_face = face_results[0]
                    face_crop = best_face["crop"]
                    full_image = best_face.get("full_image", image)
                    face_row = best_face.get("face_row", None)
                    confidence = best_face["confidence"]
                    blur_score = best_face["blur_score"]
                    
                    # Quality check
                    if blur_score < MIN_BLUR_SCORE:
                        logger.warning(f"⚠️ Face too blurry in {Path(img_path).name} (blur={blur_score:.1f})")
                        continue
                    
                    # Use landmark-aligned embedding when face_row is available
                    embedding = extractor.extract_embedding(full_image if face_row is not None else face_crop, face_row)
                    if embedding is not None:
                        embeddings.append(embedding)
                        quality_scores.append(confidence * min(blur_score / 500.0, 1.0))
                        logger.info(f"✅ Processed {Path(img_path).name} (conf={confidence:.2f}, blur={blur_score:.0f})")
                except Exception as e:
                    logger.error(f"❌ Error processing {img_path}: {e}")
            
            if not embeddings:
                raise HTTPException(status_code=400, detail="No valid face embeddings could be extracted. Ensure images contain clear, front-facing faces.")
            
            # ✅ IMPROVED: Store all valid distinct templates.
            # Do NOT average them, because averaging different head poses (Center, Left, Right)
            # destroys the vector representation. We want distinct clusters for each angle.
            templates_saved = 0
            
            # Sort by quality just to keep the best ones if there are too many
            sorted_pairs = sorted(zip(embeddings, quality_scores), key=lambda x: x[1], reverse=True)
            
            # Save up to 10 distinct high-quality templates per enrollment session
            for emb, _ in sorted_pairs[:10]:
                emb_normalized = emb / np.linalg.norm(emb)
                success = await save_face_template(employee_id, employee_id, employee_name, emb_normalized)
                if success:
                    templates_saved += 1
            
            if templates_saved > 0:
                return JSONResponse(
                    status_code=200,
                    content={
                        "status": "success",
                        "message": f"Successfully enrolled {employee_name} with {templates_saved} face templates",
                        "employee_id": employee_id,
                        "images_processed": len(embeddings),
                        "templates_saved": templates_saved
                    }
                )
            else:
                raise HTTPException(
                    status_code=500, 
                    detail="Failed to save face templates to database"
                )
        
        except HTTPException:
            raise
        except Exception as e:
            import traceback
            error_detail = traceback.format_exc()
            logger.error(f"Error during face enrollment from upload: {e}\n{error_detail}")
            raise HTTPException(
                status_code=500,
                detail=f"Face enrollment failed: {str(e)}"
            )
    
    finally:
        # Clean up temporary files
        try:
            if employee_folder.exists():
                shutil.rmtree(employee_folder)
        except Exception as e:
            logger.warning(f"Failed to clean up temporary files: {e}")


@router.post("/enroll-from-camera")
async def enroll_from_camera(
    employee_id: str = Form(...),
    employee_name: str = Form(...),
    frames: List[UploadFile] = File(...)
):
    """
    Endpoint to enroll a face from camera-captured frames.
    
    - employee_id: Unique employee identifier
    - employee_name: Employee's full name
    - frames: List of captured frames from camera
    
    IMPROVED: Detects faces in each frame, filters by quality, stores multiple templates.
    """
    logger.info(f"🎥 Received enrollment request for {employee_name} (ID: {employee_id}) with {len(frames)} frames")
    
    if not frames:
        raise HTTPException(status_code=400, detail="No frames uploaded")
    
    if len(frames) < 5:
        raise HTTPException(status_code=400, detail=f"Insufficient frames. Expected at least 5, got {len(frames)}")
    
    # Create a temporary folder for this employee
    employee_folder = ENROLLMENT_BASE_DIR / employee_name
    employee_folder.mkdir(exist_ok=True, parents=True)
    
    try:
        # Save all captured frames
        saved_files = []
        for idx, frame in enumerate(frames):
            if not frame.content_type.startswith("image/"):
                continue
            
            filename = f"{employee_id}_frame_{idx:03d}.jpg"
            file_path = employee_folder / filename
            
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(frame.file, buffer)
            
            saved_files.append(str(file_path))
        
        if len(saved_files) < 5:
            raise HTTPException(status_code=400, detail=f"Insufficient valid frames. Got {len(saved_files)}")
        
        logger.info(f"Saved {len(saved_files)} frames for {employee_name}")
        
        try:
            # Initialize extractor and face detector
            logger.info("Initializing ArcFace extractor and YuNet detector...")
            extractor = ArcFaceExtractor()
            face_detector = EnrollmentFaceDetector()
            logger.info("✅ Models loaded")
            
            # Process all frames: detect face → crop → extract embedding
            embeddings = []
            quality_scores = []
            
            for img_path in saved_files:
                image = cv2.imread(img_path)
                if image is None:
                    logger.warning(f"⚠️ Could not read {img_path}")
                    continue
                
                try:
                    # ✅ FIXED: Detect and crop face before embedding
                    face_results = face_detector.detect_and_crop(image)
                    
                    if not face_results:
                        continue
                    
                    best_face = face_results[0]
                    face_crop = best_face["crop"]
                    full_image = best_face.get("full_image", image)
                    face_row = best_face.get("face_row", None)
                    confidence = best_face["confidence"]
                    blur_score = best_face["blur_score"]
                    
                    # Quality check (more lenient for camera frames)
                    if blur_score < MIN_BLUR_SCORE * 0.5:
                        continue
                    
                    # Use landmark-aligned embedding when face_row is available
                    embedding = extractor.extract_embedding(full_image if face_row is not None else face_crop, face_row)
                    if embedding is not None:
                        embeddings.append(embedding)
                        quality_scores.append(confidence * min(blur_score / 500.0, 1.0))
                except Exception as e:
                    logger.error(f"❌ Error processing {img_path}: {e}")
            
            if not embeddings:
                raise HTTPException(status_code=400, detail="No valid face embeddings could be extracted from frames")
            
            logger.info(f"📦 Extracted {len(embeddings)} embeddings from {len(saved_files)} frames")
            
            # ✅ IMPROVED: Store multiple templates
            templates_saved = 0
            
            # Sort by quality
            sorted_pairs = sorted(zip(embeddings, quality_scores), key=lambda x: x[1], reverse=True)
            
            # Save all 5 distinct templates from the Face ID capture without averaging!
            MAX_TEMPLATES = 5
            for emb, _ in sorted_pairs[:MAX_TEMPLATES]:
                emb_normalized = emb / np.linalg.norm(emb)
                success = await save_face_template(employee_id, employee_id, employee_name, emb_normalized)
                if success:
                    templates_saved += 1
            
            if templates_saved > 0:
                logger.info(f"✅ Successfully enrolled {employee_name} with {templates_saved} distinct templates")
                return JSONResponse(
                    status_code=200,
                    content={
                        "status": "success",
                        "message": f"Successfully enrolled {employee_name} with {templates_saved} distinct face angles",
                        "employee_id": employee_id,
                        "frames_processed": len(embeddings),
                        "templates_saved": templates_saved
                    }
                )
            else:
                raise HTTPException(
                    status_code=500, 
                    detail="Failed to save face templates to database"
                )
        
        except HTTPException:
            raise
        except Exception as e:
            import traceback
            error_detail = traceback.format_exc()
            logger.error(f"Error during face enrollment from camera: {e}\n{error_detail}")
            raise HTTPException(
                status_code=500,
                detail=f"Face enrollment failed: {str(e)}"
            )
    
    finally:
        # Clean up temporary files
        try:
            if employee_folder.exists():
                shutil.rmtree(employee_folder)
        except Exception as e:
            logger.warning(f"Failed to clean up temporary files: {e}")

@router.post("/detect")
async def detect_face_realtime(file: UploadFile = File(...)):
    """
    Real-time face detection endpoint for UI guidance overlay.
    Returns: {"faces": [{"x", "y", "width", "height", "confidence"}, ...]}
    Powered by InsightFace buffalo_l det_10g (RetinaFace).
    """
    try:
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if image is None:
            return {"faces": []}

        detector = EnrollmentFaceDetector()
        boxes = detector.get_bboxes(image)
        return {"faces": boxes}

    except Exception as e:
        logger.error(f"Detection error: {e}")
        return {"faces": []}


@router.get("/status")
async def enrollment_status():
    """Check if face enrollment service is available."""
    try:
        _get_insight_app_enrollment()  # will raise if model unavailable
        return {
            "status": "ready",
            "message": "Face enrollment service is available",
            "face_detector": "InsightFace buffalo_l (det_10g)",
            "embedding_model": "InsightFace buffalo_l (w600k_r50 ArcFace)",
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"Face enrollment service unavailable: {str(e)}"
        }

