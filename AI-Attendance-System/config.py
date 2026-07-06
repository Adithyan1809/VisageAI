import os

# --- Load environment variables if .env is present (optional for local testing) ---
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass  # dotenv not required, will use system env vars if available

# ============================================================
# MODEL & RECOGNITION SETTINGS
# ============================================================

# Base directory (project root)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Model path (relative to project root)
ARCFACE_MODEL_PATH = os.path.join(BASE_DIR, "Models", "arcface_r100.onnx")

EMBEDDING_DIM = 512  # Embedding vector size
INPUT_SIZE = (112, 112)  # Expected model input size (width, height)

# ============================================================
# DATABASE CONFIGURATION
# ============================================================

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", 5432))
DB_NAME = os.getenv("DB_NAME", "")
DB_USER = os.getenv("DB_USER", "")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")

# Unified database connection string (PostgreSQL)
DB_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

# Connection pool size
MAX_DB_CONNECTIONS = int(os.getenv("MAX_DB_CONNECTIONS", 10))

# ============================================================
# PIPELINE & SYSTEM SETTINGS
# ============================================================

# Attendance cooldown: prevents duplicate entries for the same employee
# (default = 60 seconds for testing; increase to 300+ for production)
ATTENDANCE_COOLDOWN_SECONDS = int(os.getenv("ATTENDANCE_COOLDOWN_SECONDS", 120))

# Logging level
LOGLEVEL = os.getenv("LOGLEVEL", "INFO")
