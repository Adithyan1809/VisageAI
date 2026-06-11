# backend/app/ml_pipeline/inference.py
import os
import tempfile
import traceback

# Try to import your real modules — adapt names if your repo uses different functions.
try:
    # these imports are optional — only if you have them in your repo
    import face_detector     # top-level file face_detector.py
    import embedding_utils   # top-level file embedding_utils.py
    import core_recognizer   # top-level file core_recognizer.py
    _HAS_ML = True
except Exception:
    _HAS_ML = False

def _save_tmp(image_bytes: bytes, suffix=".jpg"):
    fd, path = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    with open(path, "wb") as f:
        f.write(image_bytes)
    return path

def run_inference(image_bytes: bytes, camera_id: str | None = None):
    """
    Run the inference pipeline.
    Returns a dict like:
    {
      "success": True,
      "matches": [ {"employee_id": "...", "similarity": 0.87, "template_id": "..."} ],
      "debug": "..."
    }
    """
    try:
        tmp = _save_tmp(image_bytes)
        if not _HAS_ML:
            # ML modules not available — return a stub.
            return {"success": True, "matches": [], "debug": "ML modules not found — stub run"}
        # Example flow if your modules provide these functions.
        # Adapt function names below to match your code.
        dets = face_detector.detect_faces(tmp)  # expected: list of boxes or detections
        if not dets:
            return {"success": True, "matches": [], "debug": "no faces detected"}
        all_matches = []
        for d in dets:
            # Suppose face_detector can crop/return an image or bounding box; adapt as needed.
            crop_path = d.get("crop_path") if isinstance(d, dict) and d.get("crop_path") else tmp
            emb = embedding_utils.get_embedding(crop_path)  # expected: vector (list/np.array)
            # core_recognizer should accept embedding and return list of matches
            matches = core_recognizer.find_matches(emb, top_k=3)
            # matches example: [{"employee_id": "...", "score": 0.92, "template_id": "..."}]
            for m in matches:
                all_matches.append({"employee_id": m.get("employee_id"), "similarity": m.get("score"), "template_id": m.get("template_id")})
        return {"success": True, "matches": all_matches}
    except Exception as e:
        return {"success": False, "error": str(e), "trace": traceback.format_exc()}
    finally:
        try:
            os.remove(tmp)
        except Exception:
            pass
