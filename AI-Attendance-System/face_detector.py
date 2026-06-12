# face_detector.py
import asyncio
import logging
import os
from typing import Optional, Union, List

import cv2
import numpy as np

# ------------------- Logging -------------------

logger = logging.getLogger(__name__)

# ------------------- Model Path -------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
YUNET_MODEL_PATH = os.path.join(BASE_DIR, "Models", "face_detection_yunet_2023mar.onnx")


# ------------------- Frame Utilities -------------------

def validate_frame(frame: Optional[np.ndarray]) -> Optional[np.ndarray]:
    """Ensure frame is valid, 3-channel uint8 image."""
    if frame is None:
        logger.debug("Frame is None")
        return None

    if not isinstance(frame, np.ndarray):
        logger.debug(f"Invalid frame type: {type(frame)}")
        return None

    if frame.size == 0:
        logging.warning("Frame is empty array")
        return None

    if len(frame.shape) != 3 or frame.shape[2] != 3:
        logging.warning(f"Invalid frame shape: {frame.shape}, expected (H, W, 3)")
        return None

    if frame.dtype != np.uint8:
        try:
            frame = frame.astype(np.uint8)
        except Exception:
            logger.debug("Failed dtype conversion to uint8")
            return None

    return frame


def decode_frame(frame_data: Union[np.ndarray, bytes]) -> Optional[np.ndarray]:
    """Decode frame from numpy array or JPEG bytes."""
    if frame_data is None:
        return None
    if isinstance(frame_data, np.ndarray):
        return frame_data
    if isinstance(frame_data, bytes):
        try:
            frame_np = np.frombuffer(frame_data, np.uint8)
            return cv2.imdecode(frame_np, cv2.IMREAD_COLOR)
        except Exception:
            logger.debug("JPEG decode failed", exc_info=True)
            return None
    logger.debug(f"Unsupported frame type: {type(frame_data)}")
    return None


# ------------------- Face Detector (YuNet DNN) -------------------

class FaceDetector:
    """
    High-accuracy face detector using OpenCV's YuNet DNN model.
    
    YuNet is a modern, lightweight face detection neural network that provides:
    - Real confidence scores per detection (not hardcoded)
    - Much higher accuracy than Haar Cascade
    - Better handling of angles, partial occlusion, and distance
    - Facial landmark points for potential alignment
    - Fast inference even on CPU
    """

    def __init__(self, confidence: float = 0.6, min_face_size: int = 40):
        """
        Initialize YuNet face detector.
        
        Args:
            confidence: Minimum confidence threshold for detections (0.0-1.0)
            min_face_size: Minimum face width/height in pixels to accept
        """
        try:
            if not os.path.exists(YUNET_MODEL_PATH):
                raise FileNotFoundError(
                    f"YuNet model not found at {YUNET_MODEL_PATH}. "
                    f"Download from: https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet"
                )

            self.confidence_threshold = confidence
            self.min_face_size = min_face_size
            
            # Create the YuNet detector via OpenCV's FaceDetectorYN
            # Input size will be set dynamically per-frame
            self.detector = cv2.FaceDetectorYN.create(
                model=YUNET_MODEL_PATH,
                config="",
                input_size=(320, 320),  # Will be resized per-frame
                score_threshold=self.confidence_threshold,
                nms_threshold=0.3,       # Non-Maximum Suppression threshold
                top_k=50                 # Max detections per frame
            )

            logger.info(
                "✅ YuNet DNN FaceDetector initialized (min_conf=%.2f, min_face=%dpx)",
                confidence, min_face_size
            )
        except Exception as e:
            logger.error(f"Failed to initialize YuNet FaceDetector: {e}", exc_info=True)
            raise

    def detect_faces(self, frame_data: Union[np.ndarray, bytes]) -> List[List[float]]:
        """
        Detect faces in a frame and return list of [x1, y1, x2, y2, confidence, face_row].

        face_row is the raw 15-element YuNet output array containing both the
        bounding box AND the 5 landmark coordinates. It is passed downstream so
        the ArcFace extractor can perform landmark-based face alignment, which
        dramatically reduces false positives.

        Args:
            frame_data: BGR image as numpy array or JPEG bytes

        Returns:
            List of detections, each as [x1, y1, x2, y2, confidence, face_row]
        """
        frame = decode_frame(frame_data)
        frame = validate_frame(frame)
        if frame is None:
            return []

        height, width, _ = frame.shape

        # Update detector input size to match frame dimensions
        self.detector.setInputSize((width, height))

        # Run YuNet detection
        _, faces = self.detector.detect(frame)

        if faces is None:
            return []

        detections = []
        for face in faces:
            # YuNet output format: [x, y, w, h, x_re, y_re, x_le, y_le, x_nt, y_nt, x_rcm, y_rcm, x_lcm, y_lcm, score]
            # Where re=right_eye, le=left_eye, nt=nose_tip, rcm=right_corner_mouth, lcm=left_corner_mouth
            x, y, w, h = int(face[0]), int(face[1]), int(face[2]), int(face[3])
            confidence = float(face[-1])

            # Filter by minimum face size
            if w < self.min_face_size or h < self.min_face_size:
                continue

            # Clamp to frame boundaries
            x1 = max(0, x)
            y1 = max(0, y)
            x2 = min(width, x + w)
            y2 = min(height, y + h)

            if x2 <= x1 or y2 <= y1:
                continue

            # Pass the full YuNet face row so downstream code can do landmark alignment
            detections.append([x1, y1, x2, y2, confidence, face])

        return detections

    def detect_faces_with_landmarks(self, frame_data: Union[np.ndarray, bytes]) -> List[dict]:
        """
        Detect faces with landmark points (useful for face alignment).
        
        Returns:
            List of dicts with keys: bbox, confidence, landmarks
            landmarks: dict with right_eye, left_eye, nose, right_mouth, left_mouth
        """
        frame = decode_frame(frame_data)
        frame = validate_frame(frame)
        if frame is None:
            return []

        height, width, _ = frame.shape
        self.detector.setInputSize((width, height))

        _, faces = self.detector.detect(frame)

        if faces is None:
            return []

        results = []
        for face in faces:
            x, y, w, h = int(face[0]), int(face[1]), int(face[2]), int(face[3])
            confidence = float(face[-1])

            if w < self.min_face_size or h < self.min_face_size:
                continue

            x1 = max(0, x)
            y1 = max(0, y)
            x2 = min(width, x + w)
            y2 = min(height, y + h)

            if x2 <= x1 or y2 <= y1:
                continue

            # Extract landmark positions
            landmarks = {
                "right_eye": (float(face[4]), float(face[5])),
                "left_eye": (float(face[6]), float(face[7])),
                "nose": (float(face[8]), float(face[9])),
                "right_mouth": (float(face[10]), float(face[11])),
                "left_mouth": (float(face[12]), float(face[13])),
            }

            results.append({
                "bbox": [x1, y1, x2, y2],
                "confidence": confidence,
                "landmarks": landmarks,
            })

        return results


# ------------------- Detector Worker -------------------

async def detector_worker(
        frame_queue: asyncio.Queue,
        detector_queue: asyncio.Queue,
        stop_event: asyncio.Event,
        decode_width: int = 640,
        decode_height: int = 360
):
    """
    Async worker that consumes frames from frame_queue, runs face detection,
    and pushes results to detector_queue.
    OPTIMIZED: Batched stats logging instead of per-frame (for -15% CPU overhead).
    """
    detector = FaceDetector()
    logging.info(f"[Detector] Worker started (target size: {decode_width}x{decode_height}).")

    invalid_frame_count = 0
    frame_count = 0
    detection_sum = 0
    log_interval = 100  # Log aggregated stats every 100 frames

    try:
        while not stop_event.is_set():
            try:
                data = await frame_queue.get()
                frame_count += 1
            except asyncio.CancelledError:
                break

            if data is None:
                frame_queue.task_done()
                break

            frame_raw = data.get("frame")
            camera_id = data.get("camera_id", "unknown")
            timestamp = data.get("timestamp", 0)

            frame = decode_frame(frame_raw)
            if frame is None:
                invalid_frame_count += 1
                frame_queue.task_done()
                continue

            # ✅ Resize for consistent detector input (for performance)
            frame = cv2.resize(frame, (decode_width, decode_height), interpolation=cv2.INTER_LINEAR)

            detections = await asyncio.to_thread(detector.detect_faces, frame)
            detection_sum += len(detections)

            await detector_queue.put({
                "camera_id": camera_id,
                "frame": frame,
                "detections": detections,
                "timestamp": timestamp
            })
            
            # OPTIMIZED: Log aggregated stats every 100 frames instead of silently processing
            if frame_count % log_interval == 0:
                avg_detections = detection_sum / log_interval
                logging.info(f"[Detector] Processed {frame_count} frames | Avg {avg_detections:.1f} detections/frame")
                detection_sum = 0
            
            frame_queue.task_done()

    except asyncio.CancelledError:
        logging.info("[Detector] Cancelled.")
    except Exception as e:
        logging.error(f"[Detector] Unexpected error: {e}")
    finally:
        logging.info(f"[Detector] Worker stopped. Total: {frame_count} frames ({invalid_frame_count} invalid)")
