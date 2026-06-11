import logging
import cv2
import numpy as np
import onnxruntime as ort

logger = logging.getLogger(__name__)


class ArcFaceExtractor:
    def __init__(self, model_path, input_size, embedding_dim):
        self.model_path = model_path
        self.input_size = input_size
        self.embedding_dim = embedding_dim

        self.session = ort.InferenceSession(
            model_path,
            providers=['CPUExecutionProvider']
        )
        self.input_name = self.session.get_inputs()[0].name

        # CLAHE for adaptive histogram equalization (handles variable lighting)
        self._clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))

        logger.info("✅ ArcFace model loaded (with CLAHE preprocessing)")

    # --------------------------------------------------
    # PREPROCESS (IMPROVED with CLAHE)
    # --------------------------------------------------
    def preprocess_face(self, face):
        """
        Preprocess a face crop for ArcFace embedding extraction.
        
        Steps:
        1. Resize to model input size (112x112)
        2. Apply CLAHE for lighting normalization
        3. Convert BGR → RGB
        4. Normalize pixel values to [-1, 1]
        """
        img = cv2.resize(face, self.input_size)

        # Apply CLAHE to the L channel of LAB color space
        # This normalizes lighting without affecting color balance
        try:
            lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
            l_channel, a_channel, b_channel = cv2.split(lab)
            l_channel = self._clahe.apply(l_channel)
            lab = cv2.merge([l_channel, a_channel, b_channel])
            img = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
        except Exception as e:
            logger.debug(f"CLAHE preprocessing failed, using raw image: {e}")

        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        # BUGFIX: This specific model expects raw [0, 255] float32 pixels. 
        # Scaling to [-1, 1] was blinding the model and causing 0.97+ false positives for everyone.
        img = img.astype(np.float32)
        return np.expand_dims(img, axis=0)

    # --------------------------------------------------
    # ONLY EMBEDDING (CLEAN DESIGN)
    # --------------------------------------------------
    def extract_embedding(self, face_crop):
        """
        IMPORTANT:
        - Input MUST be a cropped face
        - Detection happens outside (in the pipeline)
        """

        if face_crop is None or face_crop.size == 0:
            return None

        # Reject face crops that are too small for reliable embedding
        h, w = face_crop.shape[:2]
        if h < 20 or w < 20:
            logger.debug(f"Face crop too small ({w}x{h}), skipping")
            return None

        input_blob = self.preprocess_face(face_crop)

        emb = self.session.run(None, {self.input_name: input_blob})[0]
        emb = emb.reshape((self.embedding_dim,))

        norm = np.linalg.norm(emb)
        if norm == 0:
            return None

        return emb / norm


# KEEP SAME INTERFACE
def get_extractor():
    from config import ARCFACE_MODEL_PATH, INPUT_SIZE, EMBEDDING_DIM
    return ArcFaceExtractor(ARCFACE_MODEL_PATH, INPUT_SIZE, EMBEDDING_DIM)


def embedding_to_pgvector_str(embedding: np.ndarray) -> str:
    return "[" + ",".join(str(float(x)) for x in embedding) + "]"