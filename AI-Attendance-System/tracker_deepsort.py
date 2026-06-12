import asyncio
import logging
import time
import warnings
from collections import defaultdict
from typing import List, Dict, Any

import numpy as np
from filterpy.kalman import KalmanFilter
from scipy.optimize import linear_sum_assignment

# Suppress minor filterpy warnings related to NumPy array shapes
warnings.filterwarnings("ignore", category=RuntimeWarning)

logger = logging.getLogger("tracker_deepsort")
# Define a timeout for removing stale camera trackers (e.g., 30 seconds of no frames)
# This prevents track IDs from counting up indefinitely if a camera is permanently off.
STALE_TIMEOUT_SECONDS = 30.0


# ------------------- Data Structure for Camera State -------------------
class CameraTrackerState:
    """Holds the DeepSort object and the last time it was used."""

    def __init__(self, tracker):
        self.tracker = tracker
        self.last_update_time = time.time()

    def update_time(self):
        self.last_update_time = time.time()


# ------------------- Utility Functions - Vectorized IoU -------------------
def vectorized_iou(bboxes1: np.ndarray, bboxes2: np.ndarray) -> np.ndarray:
    """
    Computes IoU between two sets of bboxes in [x1, y1, x2, y2] format.
    Returns a matrix where element (i, j) is IoU between bboxes1[i] and bboxes2[j].
    """
    # Ensure all inputs are NumPy arrays for vectorized ops
    if bboxes1.size == 0 or bboxes2.size == 0:
        return np.zeros((bboxes1.shape[0] if bboxes1.ndim > 1 else 0,
                         bboxes2.shape[0] if bboxes2.ndim > 1 else 0), dtype=np.float32)

    # Convert to (N, 4) and (M, 4) where N is tracks and M is detections
    bboxes1 = np.asarray(bboxes1, dtype=np.float32).reshape(-1, 4)
    bboxes2 = np.asarray(bboxes2, dtype=np.float32).reshape(-1, 4)

    # Expand dims for broadcasting:
    # bboxes1: (N, 1, 4), bboxes2: (1, M, 4)

    # 1. Calculate intersection coordinates
    x1 = np.maximum(bboxes1[:, 0:1], bboxes2[:, 0])  # (N, M)
    y1 = np.maximum(bboxes1[:, 1:2], bboxes2[:, 1])  # (N, M)
    x2 = np.minimum(bboxes1[:, 2:3], bboxes2[:, 2])  # (N, M)
    y2 = np.minimum(bboxes1[:, 3:4], bboxes2[:, 3])  # (N, M)

    # 2. Calculate intersection area
    intersection_w = np.maximum(0.0, x2 - x1)
    intersection_h = np.maximum(0.0, y2 - y1)
    intersection_area = intersection_w * intersection_h

    # 3. Calculate area of both bounding boxes
    area1 = (bboxes1[:, 2] - bboxes1[:, 0]) * (bboxes1[:, 3] - bboxes1[:, 1])  # (N, 1)
    area2 = (bboxes2[:, 2] - bboxes2[:, 0]) * (bboxes2[:, 3] - bboxes2[:, 1])  # (M,)

    # 4. Calculate Union Area: Area1 + Area2 - Intersection
    union_area = area1[:, np.newaxis] + area2 - intersection_area

    # 5. Calculate IoU
    iou = intersection_area / (union_area + 1e-6)  # Added epsilon for stability
    return iou


# ------------------- Track Class -------------------
class Track:
    """Represents a single tracked object using a Kalman Filter."""

    def __init__(self, track_id: int, bbox: List[float], confidence: float):
        self.track_id = track_id
        self.bbox = bbox
        self.confidence = confidence
        self.kf = self._init_kalman_filter(bbox)
        self.hits = 1
        self.no_losses = 0

    def _init_kalman_filter(self, bbox: List[float]):
        x1, y1, x2, y2 = bbox
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        w, h = x2 - x1, y2 - y1

        kf = KalmanFilter(dim_x=7, dim_z=4)

        # Initial state [cx, cy, w, h, dx, dy, dw] (dx, dy, dw are velocities)
        kf.x[:4] = np.array([cx, cy, w, h]).reshape(4, 1)

        # State transition matrix (F)
        kf.F = np.array([
            [1, 0, 0, 0, 1, 0, 0], [0, 1, 0, 0, 0, 1, 0], [0, 0, 1, 0, 0, 0, 1], [0, 0, 0, 1, 0, 0, 0],
            [0, 0, 0, 0, 1, 0, 0], [0, 0, 0, 0, 0, 1, 0], [0, 0, 0, 0, 0, 0, 1]
        ])

        # Measurement function (H): Maps state to measurement [cx, cy, w, h]
        kf.H = np.array([
            [1, 0, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0, 0], [0, 0, 0, 1, 0, 0, 0]
        ])

        # Covariance Matrix (P): uncertainty, adjusted for stability
        kf.P *= 10.0
        kf.P[4:, 4:] *= 1000.0  # High uncertainty for velocities

        # Process Noise (Q) and Measurement Noise (R) can be tuned here for performance/accuracy
        # Default Q is identity, R is identity. Using slightly adjusted Q/R for typical tracking use.
        kf.R = np.diag([10.0, 10.0, 10.0, 10.0])  # Measurement noise (higher means trusting prediction more)
        kf.Q = np.diag([1.0, 1.0, 1.0, 1.0, 0.01, 0.01, 0.001])  # Process noise

        return kf

    def predict(self) -> List[int]:
        """Predicts the next state using the Kalman Filter."""
        self.kf.predict()
        cx, cy, w, h = self.kf.x[:4].flatten()
        # Convert state [cx, cy, w, h] back to bbox [x1, y1, x2, y2]
        self.bbox = [int(cx - w / 2), int(cy - h / 2), int(cx + w / 2), int(cy + h / 2)]
        return self.bbox

    def update(self, bbox: List[float], confidence: float):
        """Updates the state using a new measurement (detection)."""
        x1, y1, x2, y2 = bbox
        cx, cy, w, h = (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1

        # Update Kalman Filter with the new measurement
        self.kf.update(np.array([cx, cy, w, h]))

        self.bbox = bbox
        self.confidence = confidence
        self.hits += 1
        self.no_losses = 0


# ------------------- DeepSORT-like Tracker -------------------
class DeepSortLike:
    """Manages all active tracks for a single camera."""

    def __init__(self, max_age: int = 30, min_hits: int = 3, iou_threshold: float = 0.3):
        self.tracks: List[Track] = []
        self.next_id = 1
        self.max_age = max_age
        self.min_hits = min_hits
        self.iou_threshold = iou_threshold

    def update(self, detections: np.ndarray, frame_width: int, frame_height: int) -> List[Dict[str, Any]]:
        """
        Updates tracks with current detections using Hungarian algorithm (Munkres) for assignment.
        detections: NumPy array of shape (N, 5) -> [x1, y1, x2, y2, confidence]
        """
        # 1. Prediction (propagate tracks forward)
        # Note: Bbox prediction is done inside the predict method
        predicted_bboxes = np.array([t.predict() for t in self.tracks], dtype=np.float32).reshape(-1, 4)

        if detections.size == 0 and len(predicted_bboxes) == 0:
            return []

        # 2. Association (cost matrix calculation)
        if len(predicted_bboxes) > 0 and detections.size > 0:
            # Use vectorized IoU for speed
            iou_matrix = vectorized_iou(predicted_bboxes, detections[:, :4])
            cost_matrix = -iou_matrix  # Maximize IoU (minimize negative IoU)

            row_ind, col_ind = linear_sum_assignment(cost_matrix)
            matched_indices = np.column_stack((row_ind, col_ind))
        else:
            matched_indices = np.empty((0, 2), dtype=int)

        # Flags for matched/unmatched tracks/detections
        is_matched_track = np.zeros(len(self.tracks), dtype=bool)
        is_matched_detection = np.zeros(detections.shape[0], dtype=bool)

        results = []

        # 3. Handle Matched Assignments
        for t_idx, d_idx in matched_indices:
            if iou_matrix[t_idx, d_idx] < self.iou_threshold:
                continue

            # Update flags
            is_matched_track[t_idx] = True
            is_matched_detection[d_idx] = True

            # Update the track with new detection
            self.tracks[t_idx].update(detections[d_idx][:4].tolist(), detections[d_idx][4])

        # 4. Handle Unmatched Detections (Create New Tracks)
        unmatched_detections_indices = np.where(~is_matched_detection)[0]
        for d_idx in unmatched_detections_indices:
            bbox = detections[d_idx][:4].tolist()
            confidence = detections[d_idx][4]
            new_track = Track(self.next_id, bbox, confidence)
            self.tracks.append(new_track)
            self.next_id += 1

        # 5. Handle Unmatched Tracks (Increment loss count)
        unmatched_tracks_indices = np.where(~is_matched_track)[0]
        # Use reversed order for indices to avoid list indexing issues if tracks were manipulated here
        for t_idx in reversed(unmatched_tracks_indices):
            self.tracks[t_idx].no_losses += 1

        # 6. Track Cleanup (Remove expired tracks)
        self.tracks = [t for t in self.tracks if t.no_losses <= self.max_age]

        # 7. Collect Results (Output only confirmed tracks)
        for t in self.tracks:
            # Only output confirmed tracks (min_hits reached or recently observed)
            if t.hits >= self.min_hits or t.no_losses == 0:

                # Clamp the final predicted bbox to be inside the frame (essential optimization)
                x1, y1, x2, y2 = t.bbox

                # Use np.clip for fast boundary checks
                x1_clamped = int(np.clip(x1, 0, frame_width - 1))
                y1_clamped = int(np.clip(y1, 0, frame_height - 1))
                x2_clamped = int(np.clip(x2, 1, frame_width))
                y2_clamped = int(np.clip(y2, 1, frame_height))

                # Check if the box is still valid after clamping
                if x1_clamped >= x2_clamped or y1_clamped >= y2_clamped:
                    continue

                clamped_bbox = [x1_clamped, y1_clamped, x2_clamped, y2_clamped]

                results.append({
                    "track_id": t.track_id,
                    "bbox": clamped_bbox,
                    "confidence": t.confidence
                })
        return results


# ------------------- Tracker Worker Functions -------------------

async def cleanup_stale_trackers(trackers: Dict[str, CameraTrackerState], stop_event: asyncio.Event):
    """
    Background task to periodically remove trackers that haven't received frames
    for longer than STALE_TIMEOUT_SECONDS.
    """
    logger.info("[Tracker Cleanup] Stale tracker cleanup task started.")
    try:
        while not stop_event.is_set():
            await asyncio.sleep(10)  # Check every 10 seconds

            now = time.time()
            stale_camera_ids = []

            # Find stale trackers
            for cam_id, state in trackers.items():
                if (now - state.last_update_time) > STALE_TIMEOUT_SECONDS:
                    stale_camera_ids.append(cam_id)

            # Remove them
            for cam_id in stale_camera_ids:
                del trackers[cam_id]
                logger.info(f"[Tracker Cleanup] Removed stale tracker for camera: {cam_id}. ID counter reset.")

    except asyncio.CancelledError:
        logger.info("[Tracker Cleanup] Task cancelled.")
    except Exception as e:
        logger.error(f"[Tracker Cleanup] Error during cleanup: {e}", exc_info=True)


async def tracker_worker(detector_queue: asyncio.Queue, tracker_output_queue: asyncio.Queue, stop_event: asyncio.Event):
    """
    Main worker loop for tracking detections from one or more cameras.
    """
    # Trackers holds the state for each camera ID
    trackers: Dict[str, CameraTrackerState] = defaultdict(lambda: CameraTrackerState(DeepSortLike()))
    logger.info("[Tracker-DeepSORT] Worker started.")

    # Start the background cleanup task
    cleanup_task = asyncio.create_task(cleanup_stale_trackers(trackers, stop_event))

    try:
        while not stop_event.is_set():
            try:
                # Optimized timeout for responsiveness
                data = await asyncio.wait_for(detector_queue.get(), timeout=0.1)
            except asyncio.TimeoutError:
                continue

            if data is None:
                detector_queue.task_done()
                continue

            try:
                camera_id = data["camera_id"]
                frame = data["frame"]
                detections = data["detections"]
                timestamp = data.get("timestamp", 0)

                # Input validation
                if frame is None or frame.size == 0 or detections is None:
                    logger.warning(f"Tracker received invalid data for camera {camera_id}")
                    detector_queue.task_done()
                    continue

                frame_height, frame_width = frame.shape[:2]

                # The face detector returns [x1, y1, x2, y2, conf, face_row]
                # where face_row is a 15-element numpy array (YuNet landmarks).
                # The tracker only needs [x1, y1, x2, y2, conf], so strip each
                # detection to its first 5 scalar elements before conversion.
                detections_stripped = [d[:5] for d in detections] if detections else []
                detections_np = np.asarray(detections_stripped, dtype=np.float32).reshape(-1, 5)

                # Get or create tracker state and update last seen time
                tracker_state = trackers[camera_id]
                tracker_state.update_time()

                # Run tracker update
                tracked_results = tracker_state.tracker.update(detections_np, frame_width, frame_height)

                # Output results to the BestFrameSelector queue
                for t in tracked_results:
                    det_dict = {
                        "camera_id": camera_id,
                        "track_id": t["track_id"],
                        "bbox": t["bbox"],
                        "confidence": t.get("confidence", 0.0),
                        "timestamp": timestamp,
                        "frame": frame
                    }
                    await tracker_output_queue.put(det_dict)

            except Exception as e:
                logger.error(f"Error in tracker worker main loop for camera {camera_id}: {e}", exc_info=True)

            detector_queue.task_done()

    except asyncio.CancelledError:
        logger.info("[Tracker-DeepSORT] Cancelled.")
    finally:
        logger.info("[Tracker-DeepSORT] Worker stopped. Cancelling cleanup task.")
        cleanup_task.cancel()
        # Wait for cleanup task to actually stop
        await asyncio.gather(cleanup_task, return_exceptions=True)
