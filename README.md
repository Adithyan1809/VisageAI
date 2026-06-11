# VisageAI 🧠

<div align="center">

![VisageAI Banner](https://img.shields.io/badge/VisageAI-AI%20Attendance%20System-6366f1?style=for-the-badge&logo=opencv&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-14-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pgvector-336791?style=for-the-badge&logo=postgresql&logoColor=white)

**A real-time, AI-powered face recognition attendance system built for enterprise environments.**

</div>

---

## ✨ Features

- 🎭 **Apple Face ID–Style Enrollment** — Guided 5-pose capture (Center, Left, Right, Up, Down) for 3D-quality coverage
- 🧠 **ArcFace R100 Recognition** — State-of-the-art deep learning face embeddings
- ⚡ **Real-Time Pipeline** — YuNet face detection → DeepSORT tracking → ArcFace recognition at 30 FPS
- 🛡️ **Anti-False-Positive Engine** — Multi-stage verification: cosine threshold + majority voting + margin check
- 🗄️ **pgvector Database** — PostgreSQL with vector similarity search for blazing-fast face lookups
- 📡 **Live Events via Redis** — Real-time attendance events pushed to the frontend via pub/sub
- 📊 **Premium Dashboard** — Live attendance feed, employee management, and zone monitoring
- 🎥 **Multi-Camera Support** — ONVIF-compatible IP cameras + laptop webcam via RTSP/FFmpeg

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        VisageAI Pipeline                      │
│                                                              │
│  Camera Feed (RTSP/Webcam)                                   │
│       │                                                      │
│       ▼                                                      │
│  FFmpeg Ingestor ──► YuNet Face Detector ──► DeepSORT Tracker│
│                                                    │         │
│                                           Best Frame Selector│
│                                                    │         │
│                                        ArcFace R100 Embedder │
│                                                    │         │
│                                   pgvector Similarity Search │
│                                                    │         │
│                          Majority Vote + Margin Verification │
│                                                    │         │
│                              Redis Pub/Sub ──► Frontend UI   │
└──────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+
- PostgreSQL 14+ with `pgvector` extension
- Redis

### 1. Clone the Repository

```bash
git clone https://github.com/Adithyan1809/VisageAI.git
cd VisageAI
```

### 2. Set Up the AI Pipeline

```bash
cd AI-Attendance-System
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Download models (not included — too large for GitHub):
```bash
# ArcFace R100 — place in AI-Attendance-System/Models/arcface_r100.onnx
# YuNet        — place in AI-Attendance-System/Models/face_detection_yunet_2023mar.onnx
```

### 3. Set Up the Backend API

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8080
```

### 4. Set Up the Frontend

```bash
cd attendance-ui
npm install
npm run dev
```

### 5. Run with Start Script

```bash
chmod +x AI-Attendance-System/start.sh
./AI-Attendance-System/start.sh
```

---

## ⚙️ Configuration

Edit `AI-Attendance-System/config.yaml`:

```yaml
recognition:
  cosine_threshold: 0.78   # Minimum similarity to accept a match
  majority_threshold: 3    # Minimum votes required (out of N frames)
  margin_threshold: 0.15   # Required gap between top match and runner-up

selector:
  top_k: 7                 # Best frames to send for recognition per track
  track_timeout_seconds: 3.0
```

---

## 📁 Project Structure

```
VisageAI/
├── AI-Attendance-System/     # Core AI recognition pipeline
│   ├── main.py               # Pipeline entry point
│   ├── pipeline_worker.py    # Recognition orchestrator
│   ├── core_recognizer.py    # ArcFace matching engine
│   ├── face_detector.py      # YuNet face detection
│   ├── tracker_deepsort.py   # DeepSORT face tracker
│   ├── best_frame_selector.py# Quality-based frame selector
│   ├── embedding_utils.py    # ArcFace embedding extraction
│   ├── db_utils.py           # PostgreSQL/pgvector interface
│   ├── config.yaml           # System configuration
│   └── cameras.json          # Camera registry
│
├── backend/                  # FastAPI REST API
│   └── app/
│       ├── api/
│       │   └── face_enrollment.py  # Face enrollment endpoint
│       └── ML/
│           └── pipeline_event_sender.py
│
├── attendance-ui/            # Next.js frontend
│   └── pages/
│       ├── index.js          # Dashboard
│       └── employees/
│           └── face-enrollment.jsx  # Apple Face ID–style enrollment
│
└── README.md
```

---

## 🔐 Security

- Bearer token authentication on all pipeline API endpoints
- Multi-stage false-positive rejection (cosine + majority + margin)
- No face templates updated from live feed (prevents template poisoning)
- CORS configured per environment

---

## 🧪 Recognition Accuracy

| Scenario | Result |
|----------|--------|
| Enrolled person (frontal) | ✅ ~0.92–0.97 similarity |
| Enrolled person (side angle) | ✅ ~0.80–0.88 similarity |
| Different person | ❌ ~0.05–0.12 similarity |
| Threshold | `0.78` |

---

## 📜 License

MIT License — feel free to fork, build, and ship.

---

<div align="center">
Built with ❤️ using ArcFace, YuNet, DeepSORT, FastAPI, and Next.js
</div>
