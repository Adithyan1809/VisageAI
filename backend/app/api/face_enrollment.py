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


# -------------------------
# Face Detector for Enrollment
# -------------------------
class EnrollmentFaceDetector:
    """YuNet-based face detector for the enrollment API."""

    def __init__(self):
        self._detector = None
        self._clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))

        if YUNET_MODEL_PATH and Path(YUNET_MODEL_PATH).exists():
            try:
                self._detector = cv2.FaceDetectorYN.create(
                    model=str(YUNET_MODEL_PATH),
                    config="",
                    input_size=(320, 320),
                    score_threshold=MIN_DETECTION_CONFIDENCE,
                    nms_threshold=0.3,
                    top_k=10
                )
                logger.info(f"✅ YuNet face detector loaded for enrollment")
            except Exception as e:
                logger.warning(f"⚠️ Could not load YuNet: {e}. Will use full-image fallback.")
        else:
            logger.warning(f"⚠️ YuNet model not found. Will use full-image fallback (less accurate).")

    def detect_and_crop(self, image: np.ndarray) -> list:
        """
        Detect faces in an image and return cropped face regions.
        
        Returns:
            List of dicts: [{"crop": np.ndarray, "confidence": float, "blur_score": float}, ...]
        """
        if self._detector is None:
            # Fallback: use the entire image (less accurate but still works)
            return [{"crop": image, "confidence": 0.5, "blur_score": self._calculate_blur(image)}]

        h, w = image.shape[:2]
        self._detector.setInputSize((w, h))

        _, faces = self._detector.detect(image)

        if faces is None or len(faces) == 0:
            # No face detected — try the whole image as a last resort
            logger.debug("No face detected, trying full image")
            return [{"crop": image, "confidence": 0.3, "blur_score": self._calculate_blur(image)}]

        results = []
        for face in faces:
            x, y, fw, fh = int(face[0]), int(face[1]), int(face[2]), int(face[3])
            confidence = float(face[-1])

            # Skip tiny faces
            if fw < MIN_FACE_SIZE or fh < MIN_FACE_SIZE:
                continue

            # Add margin around face for better embedding
            margin_x = int(fw * 0.15)
            margin_y = int(fh * 0.15)
            x1 = max(0, x - margin_x)
            y1 = max(0, y - margin_y)
            x2 = min(w, x + fw + margin_x)
            y2 = min(h, y + fh + margin_y)

            crop = image[y1:y2, x1:x2]
            if crop.size == 0:
                continue

            blur_score = self._calculate_blur(crop)
            results.append({
                "crop": crop,
                "confidence": confidence,
                "blur_score": blur_score
            })

        if not results:
            # All faces were too small — try the full image
            return [{"crop": image, "confidence": 0.3, "blur_score": self._calculate_blur(image)}]

        # Sort by confidence (best first)
        results.sort(key=lambda r: r["confidence"], reverse=True)
        return results

    def _calculate_blur(self, image: np.ndarray) -> float:
        """Calculate sharpness using Laplacian variance."""
        try:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            return cv2.Laplacian(gray, cv2.CV_64F).var()
        except Exception:
            return 0.0


# -------------------------
# ArcFace Extractor (embedded) — with CLAHE
# -------------------------
class ArcFaceExtractor:
    def __init__(self, model_path=ARCFACE_MODEL_PATH):
        self.model_path = str(model_path)
        self.input_size = INPUT_SIZE
        self.embedding_dim = EMBEDDING_DIM
        self._clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        try:
            self.session = ort.InferenceSession(self.model_path, providers=['CPUExecutionProvider'])
            self.input_name = self.session.get_inputs()[0].name
            logger.info(f"✔ ArcFace model loaded. Input: '{self.input_name}'")
        except Exception as e:
            logger.error(f"❌ Failed to load ArcFace model: {e}")
            raise

    def preprocess_face(self, frame):
        img = cv2.resize(frame, self.input_size)

        # Apply CLAHE for lighting normalization
        try:
            lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
            l_channel, a_channel, b_channel = cv2.split(lab)
            l_channel = self._clahe.apply(l_channel)
            lab = cv2.merge([l_channel, a_channel, b_channel])
            img = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
        except Exception:
            pass

        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        # BUGFIX: This specific model expects raw [0, 255] float32 pixels. 
        # Scaling to [-1, 1] was blinding the model and causing 0.97+ false positives for everyone.
        img = img.astype(np.float32)
        return np.expand_dims(img, axis=0)  # (1,112,112,3)

    def extract_embedding(self, frame):
        if frame is None or frame.size == 0:
            return None
        input_blob = self.preprocess_face(frame)
        emb = self.session.run(None, {self.input_name: input_blob})[0]
        emb = emb.reshape((self.embedding_dim,))
        norm = np.linalg.norm(emb)
        if norm == 0:
            return None
        return emb / norm

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
                    confidence = best_face["confidence"]
                    blur_score = best_face["blur_score"]
                    
                    # Quality check
                    if blur_score < MIN_BLUR_SCORE:
                        logger.warning(f"⚠️ Face too blurry in {Path(img_path).name} (blur={blur_score:.1f})")
                        continue
                    
                    embedding = extractor.extract_embedding(face_crop)
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
                    confidence = best_face["confidence"]
                    blur_score = best_face["blur_score"]
                    
                    # Quality check (more lenient for camera frames)
                    if blur_score < MIN_BLUR_SCORE * 0.5:
                        continue
                    
                    embedding = extractor.extract_embedding(face_crop)
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
    Ultra-fast endpoint to detect face bounding box for UI guidance.
    Returns: {"faces": [{"x": ..., "y": ..., "width": ..., "height": ..., "confidence": ...}]}
    """
    try:
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if image is None:
            return {"faces": []}
            
        detector = EnrollmentFaceDetector()
        results = detector.detect_and_crop(image)
        
        if not results:
            return {"faces": []}
            
        # Return the best face bounding box (we have to recalculate the box from crop logic)
        # Actually, detect_and_crop returns the crop, but we need the raw coordinates.
        # Let's bypass detect_and_crop and just use the internal YuNet detector to get the raw box.
        if detector._detector is None:
            return {"faces": []}
            
        h, w = image.shape[:2]
        detector._detector.setInputSize((w, h))
        _, faces = detector._detector.detect(image)
        
        if faces is None or len(faces) == 0:
            return {"faces": []}
            
        response_faces = []
        for face in faces:
            x, y, fw, fh = int(face[0]), int(face[1]), int(face[2]), int(face[3])
            confidence = float(face[-1])
            if confidence > MIN_DETECTION_CONFIDENCE:
                response_faces.append({
                    "x": x, "y": y, "width": fw, "height": fh, "confidence": confidence
                })
                
        return {"faces": response_faces}
    except Exception as e:
        logger.error(f"Detection error: {e}")
        return {"faces": []}


@router.get("/status")
async def enrollment_status():
    """Check if face enrollment service is available"""
    try:
        extractor = ArcFaceExtractor()
        detector_status = "ready" if YUNET_MODEL_PATH and Path(YUNET_MODEL_PATH).exists() else "fallback (no YuNet model)"
        
        return {
            "status": "ready",
            "message": "Face enrollment service is available",
            "model_path": str(ARCFACE_MODEL_PATH),
            "face_detector": detector_status,
            "yunet_model_path": str(YUNET_MODEL_PATH) if YUNET_MODEL_PATH else None
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"Face enrollment service unavailable: {str(e)}"
        }
