import asyncio
import logging
import threading
import time
from pathlib import Path

import cv2
import numpy as np

from db_utils import get_db_manager
from embedding_utils import get_extractor, embedding_to_pgvector_str
from face_detector import FaceDetector   # ✅ IMPORTANT

# ============================================================
# CONFIGURATION
# ============================================================

logger = logging.getLogger(__name__)

EMP_ID_PREFIX = "SMAP_"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
EXCLUDED_FOLDERS = {".git", ".venv", ".idea", "__pycache__", "Models"}

# Thread-local storage for face detector (YuNet is NOT thread-safe)
_thread_local = threading.local()

def _get_thread_detector():
    """Get or create a thread-local FaceDetector instance."""
    if not hasattr(_thread_local, 'detector'):
        _thread_local.detector = FaceDetector()
    return _thread_local.detector

# Quality thresholds for enrollment
MIN_FACE_SIZE = 60          # Minimum face width/height in pixels
MIN_BLUR_SCORE = 50.0       # Minimum Laplacian variance (sharpness)


# ============================================================
# DATABASE FUNCTIONS
# ============================================================

async def clear_existing_templates(db):
    logger.warning("🧹 Clearing existing facial_templates table...")
    async with db.pool.acquire() as conn:
        await conn.execute("TRUNCATE TABLE facial_templates RESTART IDENTITY;")
    logger.info("✅ Cleared 'facial_templates' successfully.")


async def get_next_emp_id(db) -> str:
    async with db.pool.acquire() as conn:
        query = f"""
        SELECT MAX(CAST(SUBSTRING(person_id FROM '{EMP_ID_PREFIX}([0-9]+)') AS INTEGER))
        FROM facial_templates
        WHERE person_id LIKE '{EMP_ID_PREFIX}%';
        """
        last_id_num = await conn.fetchval(query)
        next_id_num = (last_id_num or 0) + 1
        return f"{EMP_ID_PREFIX}{next_id_num}"


async def insert_facial_template(db, person_id: str, name: str, embedding: np.ndarray, template_index: int = 0):
    """Insert a single facial template. Supports multiple templates per person."""
    emb_str = embedding_to_pgvector_str(embedding)
    timestamp = time.time()

    unique_pid = f"{person_id}_t{template_index}" if template_index > 0 else person_id

    # UPSERT the employee to avoid foreign key constraints
    upsert_employee_sql = """
        INSERT INTO employees (id, employee_code, first_name, status, created_at, updated_at)
        VALUES ($1, $1, $2, 'active', NOW(), NOW())
        ON CONFLICT (id) DO NOTHING;
    """

    sql = """
        INSERT INTO facial_templates 
        (person_id, person_type, template_data, version,
         model_version, created_at, effective_from, is_active, employee_id, name)
        VALUES ($1, 'employee', $2::vector, 1, 'arcface_r100_v1',
                to_timestamp($3), to_timestamp($3), TRUE, $4, $5);
    """

    async with db.pool.acquire() as conn:
        await conn.execute(upsert_employee_sql, person_id, name)
        await conn.execute(sql, unique_pid, emb_str, timestamp, person_id, name)


# ============================================================
# IMAGE PROCESSING
# ============================================================

def calculate_blur_score(image: np.ndarray) -> float:
    """Calculate image sharpness using Laplacian variance."""
    if image is None or image.size == 0:
        return 0.0
    try:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        return cv2.Laplacian(gray, cv2.CV_64F).var()
    except Exception:
        return 0.0


def process_single_image(extractor, img_path: Path):
    """
    Process a single image: detect face, validate quality, extract embedding.
    Returns (embedding, quality_score) or (None, 0.0).
    
    NOTE: Uses a thread-local FaceDetector because OpenCV's YuNet
    FaceDetectorYN is NOT thread-safe (causes segfault if shared).
    """
    image = cv2.imread(str(img_path))
    if image is None:
        return None, 0.0

    try:
        # ✅ Get a thread-safe detector instance
        detector = _get_thread_detector()

        # ✅ STEP 1: Detect faces using the correct method name
        faces = detector.detect_faces(image)

        if not faces:
            logger.debug(f"No face detected in {img_path.name}")
            return None, 0.0

        # ✅ STEP 2: Pick the largest face (best quality)
        # detect_faces() returns [[x1, y1, x2, y2, confidence], ...]
        best_face = max(
            faces,
            key=lambda f: (f[2] - f[0]) * (f[3] - f[1])
        )

        x1, y1, x2, y2, confidence = int(best_face[0]), int(best_face[1]), int(best_face[2]), int(best_face[3]), best_face[4]

        # ✅ STEP 3: Quality checks
        face_w = x2 - x1
        face_h = y2 - y1

        if face_w < MIN_FACE_SIZE or face_h < MIN_FACE_SIZE:
            logger.debug(f"Face too small ({face_w}x{face_h}) in {img_path.name}")
            return None, 0.0

        # Add margin around the face for better embedding quality
        h, w = image.shape[:2]
        margin_x = int(face_w * 0.15)
        margin_y = int(face_h * 0.15)
        x1 = max(0, x1 - margin_x)
        y1 = max(0, y1 - margin_y)
        x2 = min(w, x2 + margin_x)
        y2 = min(h, y2 + margin_y)

        face_crop = image[y1:y2, x1:x2]

        if face_crop.size == 0:
            return None, 0.0

        # Check blur/sharpness
        blur_score = calculate_blur_score(face_crop)
        if blur_score < MIN_BLUR_SCORE:
            logger.debug(f"Face too blurry (score={blur_score:.1f}) in {img_path.name}")
            return None, 0.0

        # ✅ STEP 4: Extract embedding
        embedding = extractor.extract_embedding(face_crop)

        quality = confidence * min(blur_score / 500.0, 1.0)  # Combined quality metric
        return embedding, quality

    except Exception as e:
        logger.error(f"Error processing {img_path.name}: {e}")
        return None, 0.0


async def process_person_folder(extractor, db, folder_path: Path, person_id: str, name: str):
    """
    Process all images in a person's folder.
    
    IMPROVED: Stores multiple templates per person (one per high-quality image)
    instead of averaging all embeddings into one. This significantly improves
    recognition accuracy across different angles and lighting conditions.
    
    NOTE: Processes images sequentially to avoid thread-safety issues with
    OpenCV's YuNet FaceDetectorYN. Enrollment is a one-time operation so
    speed is not critical — correctness matters more.
    """
    image_paths = [
        p for p in folder_path.glob("*")
        if p.suffix.lower() in IMAGE_EXTENSIONS
    ]

    if not image_paths:
        return False, 0

    # Process images sequentially (YuNet is not thread-safe)
    results = []
    for img_path in image_paths:
        result = process_single_image(extractor, img_path)
        results.append(result)

    # Collect valid embeddings with quality scores
    valid_results = [(emb, quality) for emb, quality in results if emb is not None]

    if not valid_results:
        logger.warning(f"⚠️ No valid embeddings for {name}")
        return False, 0

    # Sort by quality (best first)
    valid_results.sort(key=lambda x: x[1], reverse=True)

    # Strategy: Store multiple templates for better coverage
    # - If we have 1-2 images: store all embeddings individually
    # - If we have 3+: store top 3 individual + 1 averaged template
    MAX_INDIVIDUAL_TEMPLATES = 3

    templates_stored = 0

    if len(valid_results) <= 2:
        # Store each embedding individually
        for idx, (emb, quality) in enumerate(valid_results):
            emb_normalized = emb / np.linalg.norm(emb)
            await insert_facial_template(db, person_id, name, emb_normalized, template_index=idx)
            templates_stored += 1
    else:
        # Store top 3 individual embeddings
        for idx in range(min(MAX_INDIVIDUAL_TEMPLATES, len(valid_results))):
            emb, quality = valid_results[idx]
            emb_normalized = emb / np.linalg.norm(emb)
            await insert_facial_template(db, person_id, name, emb_normalized, template_index=idx)
            templates_stored += 1

        # Also store an averaged embedding from ALL valid images (captures the "average face")
        all_embeddings = [emb for emb, _ in valid_results]
        avg_emb = np.mean(all_embeddings, axis=0)
        avg_emb = avg_emb / np.linalg.norm(avg_emb)
        await insert_facial_template(db, person_id, name, avg_emb, template_index=templates_stored)
        templates_stored += 1

    logger.info(f"✅ {name} ({person_id}): {templates_stored} templates from {len(valid_results)} valid images")

    return True, len(valid_results)


# ============================================================
# MAIN LOGIC
# ============================================================

async def main(folder_path: str):
    base_path = Path(folder_path)
    if not base_path.exists():
        logger.error(f"❌ Path does not exist: {folder_path}")
        return

    db = get_db_manager()
    await db.create_pool()

    extractor = get_extractor()

    await clear_existing_templates(db)

    next_id_str = await get_next_emp_id(db)
    emp_counter = int(next_id_str.replace(EMP_ID_PREFIX, ""))

    people_enrolled = 0
    images_processed = 0

    for subfolder in sorted(base_path.iterdir()):
        if not subfolder.is_dir() or subfolder.name in EXCLUDED_FOLDERS:
            continue

        person_name = subfolder.name.strip()
        person_id = f"{EMP_ID_PREFIX}{emp_counter}"

        # Run sequentially to ensure 100% safety with YuNet
        success, img_count = await process_person_folder(
            extractor,
            db,
            subfolder,
            person_id,
            person_name
        )

        if success:
            people_enrolled += 1
            images_processed += img_count
            logger.info(f"✅ {person_name} ({person_id}) enrolled with {img_count} images")

        emp_counter += 1

    logger.info("=== Enrollment Summary ===")
    logger.info(f"👥 People enrolled: {people_enrolled}")
    logger.info(f"🖼️ Images processed: {images_processed}")
    logger.info("===========================")

    await db.pool.close()


# ============================================================
# ENTRY POINT
# ============================================================

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    folder = Path(__file__).parent / "Test_Face"
    asyncio.run(main(str(folder)))