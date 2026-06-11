# SMAP - Complete Architecture & Requirements Document

**Date**: March 5, 2026  
**Project**: Smart Monitoring & Attendance Platform  
**Scope**: Full system architecture, requirements, and development task breakdown

---

## 📋 Table of Contents

1. [Runtime Architecture & Pipeline](#runtime-architecture--pipeline)
2. [On-Premises Deployment Architecture](#on-premises-deployment-architecture)
3. [Process Layout & Components](#process-layout--components)
4. [Concurrency Model](#concurrency-model)
5. [Resource Scheduling](#resource-scheduling)
6. [Cache Mechanism & Deduplication](#cache-mechanism--deduplication)
7. [Failure Handling & Retry Policy](#failure-handling--retry-policy)
8. [Alert Classification & Actions](#alert-classification--actions)
9. [Policy Evaluation Flow (OPA Integration)](#policy-evaluation-flow-opa-integration)
10. [CPU Sizing Evaluation](#cpu-sizing-evaluation)
11. [Development Task Breakdown](#development-task-breakdown)

---

## Runtime Architecture & Pipeline

### Data Flow Pipeline

```
Camera → Frame Queue → Detector Pool → Face Tracker → Crop Extractor 
→ Recognition Queue → Recognition Worker Pool → Liveness Match 
→ Policy Engine (OPA) → Attendance Service
```

### Pipeline Components (Sequential Order)

1. **Camera (RTSP Input)**
   - Input: Video streams from network cameras
   - Output: Continuous video feeds
   - Protocol: RTSP or HTTP

2. **Frame Queue**
   - Input: Raw video frames from RTSP grabbers
   - Output: Encoded frame queue
   - Format: JPEG-encoded frames
   - Bounded queue: Configurable max size

3. **Camera Read Workers (RTSP Grabber)**
   - Process: Lightweight threads for RTSP decoding
   - Input: Network stream
   - Output: Frames pushed to bounded queue
   - Concurrency: 1 goroutine/thread per RTSP channel

4. **Detector Workers**
   - Process: Face detection on CPU
   - Input: Frames from queue
   - Output: Detection boxes + confidence scores
   - Model Options: Haar Cascades, MTCNN, BlazeFace, or MobileNet-SSD variants

5. **Face Tracker (Per Camera)**
   - Process: Single-threaded per camera
   - Algorithm: ByteTrack/DeepSORT with Kalman filtering
   - Input: Detection boxes
   - Output: Tracked object (track_id, bounding box)
   - Purpose: Maintains stable identity across frames

6. **Crop Extractor**
   - Process: Extracts face crops from tracked regions
   - Input: Tracked object with bounding box
   - Output: Cropped face image
   - Quality: Best frame selection based on Laplacian variance

7. **Recognition Queue**
   - Purpose: Buffers cropped faces for recognition
   - Bounded queue with timeout trigger for batching
   - Input: Face crops
   - Output: Batch of crops ready for embedding

8. **Recognition Worker Pool (Embedding Extraction)**
   - Process: CPU/GPU worker pool for embedding
   - Model: ArcFace/FaceNet with ONNX Runtime (CPU) or OpenVINO
   - Input: Face crops
   - Output: 512-dimensional face embeddings
   - Throughput: ~10-30 embeddings/sec per CPU core

9. **Candidate Match**
   - Process: Query FAISS vector DB for top-K matches
   - Input: Face embedding
   - Output: Matched user_id + confidence score
   - Fallback: Handle no-match scenarios

10. **Liveness Check**
    - Process: Lightweight anti-spoofing model
    - Models: MediaPipe, light CNN, or similar
    - Input: Face crop
    - Output: Pass/Fail/Unknown liveness status
    - Optimization: Only run on top-N matches (not every crop)

11. **Policy Engine (OPA - Open Policy Agent)**
    - Process: Evaluate access policies
    - Input: user_profile, camera_meta, time, confidence, liveness
    - Output: Decision {allow: true/false, reason, actions}
    - Rules: Time-based, location-based, blacklist, shift mapping

12. **Attendance Service**
    - Process: Log attendance event or deny access
    - Input: Policy decision
    - Output: Attendance event (if allowed) or alert (if denied)
    - Actions: Write to database, trigger alerts, send notifications

---

## On-Premises Deployment Architecture

### System Components (On-Premises Setup)

```
Multiple Cameras (RTSP/HTTP)
         ↓
   ┌─────────────────────┐
   │   Stream Ingestor   │
   │    Service          │
   └─────────────────────┘
         ↓
   ┌─────────────────────────────────────────┐
   │         Face Detection & Tracking       │
   │  (Detection Service | Tracker Service)  │
   └─────────────────────────────────────────┘
         ↓
   ┌─────────────────────────────────────────┐
   │     Recognition Service                 │
   │  (Embedding Extraction, FAISS Search)  │
   └─────────────────────────────────────────┘
         ↓
   ┌─────────────────────────────────────────┐
   │     Attendance Service                  │
   │  (Policy Engine, Event Logging)        │
   └─────────────────────────────────────────┘
         ↓
   ┌─────────────────────────────────────────┐
   │     Database & Caching Layer            │
   │  (PostgreSQL, Redis)                   │
   └─────────────────────────────────────────┘
         ↓
   ┌─────────────────────────────────────────┐
   │     Logging & Alerts                    │
   │  (Audit Logs, Notifications, SMS/Email)│
   └─────────────────────────────────────────┘
```

### Infrastructure Services

- **Stream Ingestor Service**: Manages RTSP connection pooling, frame decoding, throttling
- **Face Detection & Tracking**: Runs detection model, maintains per-camera trackers
- **Recognition Service**: Embedding extraction, FAISS vector search, liveness check
- **Attendance Service**: Event logging, policy evaluation, business rule application
- **Logging & Alerts**: Audit trails, alert routing, notification delivery
- **Database**: PostgreSQL for persistent storage
- **Cache**: Redis for ephemeral state, deduplication, rate limiting

---

## Process Layout & Components

### Service/Process Breakdown

#### **Stream Ingestor Manager** (Process)
- **Purpose**: Manage camera connections and frame ingestion
- **Responsibilities**:
  - Spawns lightweight RTSP grabber thread per channel
  - Maintains per-channel frame queue (bounded)
  - Adjusts FPS throttle based on downstream queue depth
  - Health checks for camera connectivity
- **Concurrency**: Main manager process + worker threads per camera
- **Configuration**: Per-camera FPS, resolution, timeout settings

#### **Detector Pool** (Process or Threadpool)
- **Purpose**: Run face detection inference on CPU
- **Models Supported**: 
  - Haar Cascades
  - MTCNN
  - BlazeFace
  - MobileNet-SSD variants
- **Concurrency**: N CPU threads (depends on CPU capacity, typically 4-8)
- **Non-blocking**: Uses worker pool pattern to avoid blocking main pipeline
- **Throughput**: ~5-10 FPS per core with light detectors

#### **Per-Camera Tracker** (In-process, single-threaded per camera)
- **Purpose**: Maintain stable track IDs across frames
- **Algorithm**: ByteTrack/DeepSORT with Kalman filtering
- **Input**: Detection boxes from detector
- **Output**: Stable track IDs and bounding boxes
- **Concurrency**: One instance per camera, single-threaded to avoid state mutation
- **Performance**: Minimal CPU overhead

#### **Recognition Service (Embedding Extraction)** (Process)
- **Purpose**: Extract face embeddings and search vector DB
- **Model**: ArcFace/FaceNet with ONNX Runtime (CPU) or OpenVINO
- **Concurrency**: Bounded GPU worker pool (e.g., 1 worker per GPU, or CPU-based)
- **Batching**: Small async queue with timeout trigger to batch crops
- **Throughput**: ~10-30 embeddings/sec per CPU core
- **Process**: One crop at a time, outputs embedding vector

#### **Vector Index (FAISS)** (Shared in-memory or separate process)
- **Purpose**: High-speed similarity search for face embeddings
- **Implementation**: FAISS (Facebook AI Similarity Search)
- **Index Type**: HNSW (Hierarchical Navigable Small World) or IVF
- **Query Pattern**: Top-K match lookup (e.g., top-10 candidates)
- **Performance**: <5ms per query with 10-20k templates
- **Access**: Exposed via match API to recognition service

#### **Liveness Service** (Process)
- **Purpose**: Anti-spoofing detection
- **Model**: MediaPipe, light CNN, or similar lightweight model
- **Execution**: CPU-based, very fast (<50ms)
- **Optimization**: Only called for top-N matches (not every crop)
- **Output**: Pass/Fail/Unknown liveness status

#### **OPA Policy Engine** (Sidecar / Service)
- **Purpose**: Evaluate access policies and business rules
- **Input Data**: 
  - user_profile (name, dept, access_level)
  - camera_meta (location, zone)
  - timestamp (time of day)
  - confidence (recognition confidence)
  - liveness (spoof detection result)
- **Policy Rules**:
  - Time-based access (shift hours)
  - Location-based rules (restricted zones)
  - Blacklist/whitelist checks
  - Department/role-based access
- **Output**: Decision {allow: true/false, reason, actions}

#### **Attendance Service** (API + DB)
- **Purpose**: Log attendance events and process alerts
- **Responsibilities**:
  - Define attendance event schema (IN/OUT, timestamp, camera, employee_id)
  - Implement deduplication (per employee within N-minute window)
  - Apply business rules (shift mapping, IN/OUT detection)
  - Integrate with OPA for policy evaluation
  - Persist events to PostgreSQL DB
  - Trigger alerts on policy denials

#### **Logging & Alerting Engine**
- **Purpose**: Track alerts, logs, and notifications
- **Alert Categories**: No face, No match, Spoof, Repeated attempts, DB down, etc.
- **Alert Severity**: Critical, High, Medium
- **Alert Sinks**:
  - Monitoring UI (real-time dashboard)
  - Security Dashboard (immediate incidents)
  - Audit Logs (append-only event store)
- **Notification Routes**: SMS/Email/UI notifications

#### **Redis** (Cache & Ephemeral State Store)
- **Purpose**: Fast read-through cache for user profiles, dedup state, retry queues
- **Use Cases**:
  - Cache recent embeddings (avoid recompute)
  - Store dedup window (employee recently seen)
  - Buffer failed events for retry
  - Rate limiting and feature flags
- **TTL**: Configurable per data type (10-120 seconds typical)

---

## Concurrency Model

### Threading & Concurrency Strategy

#### **RTSP Grabber** 
- **Type**: 1 goroutine/thread per RTSP channel
- **Work**: Minimal work—only decoding + pushing frames into queue
- **Non-blocking**: Uses bounded queue; if full, drop oldest frame or throttle

#### **Detector Workers**
- **Type**: N CPU threads (non-blocking worker pool)
- **Size**: Depends on CPU capacity
  - Small setup (≤10 cameras): 4-6 threads
  - Medium setup (25-30 cameras): 8-12 threads
  - Large setup (50+ cameras): 16-20 threads
- **Work**: CPU-intensive (face detection inference)
- **Queue**: Pull from shared detector input queue; push results to tracker queues

#### **Tracker (Per Camera)**
- **Type**: 1 single-threaded instance per camera (in-process)
- **Purpose**: Simplifies state management (no locking needed)
- **Work**: Kalman filter updates, IoU matching (very fast, <1ms per frame)

#### **Recognition Worker Pool**
- **Type**: Bounded GPU or CPU worker pool (e.g., 1-4 workers)
- **Size**: Depends on GPU/CPU capacity
  - Small: 1 worker (batch small crops)
  - Medium: 2-4 workers (parallel batches)
  - Large: 4-8 workers (GPU parallelism)
- **Work**: Embedding extraction (CPU or GPU-intensive, 50-200ms per crop in batch)
- **Queue**: Async queue with timeout (batch trigger after 50ms or 32 crops)

#### **Policy Engine**
- **Type**: Separate service/sidecar
- **Concurrency**: Stateless; can handle multiple concurrent policy queries
- **Latency**: <50ms per query (policy evaluation is very fast)

#### **Attendance Service**
- **Type**: API service with async write capability
- **Concurrency**: Handle concurrent POST requests from recognition service
- **Async Writing**: Use async DB drivers (asyncpg for Postgres)

---

## Resource Scheduling

### CPU Allocation & Performance Targets

#### **Each RTSP Decode (720p)**
- **Estimated CPU**: ~0.3-0.5 vCPU per stream
- **Rationale**: Hardware video decoding may reduce this further
- **Scaling**: 10 streams @ ~4 vCPU total

#### **Face Detection (BlazeFace/RetinaFace-CPU)**
- **Throughput**: ~5-10 FPS per core
- **Allocation**: Scales with frame rate and detector complexity
  - Light detector (BlazeFace): 1 vCPU → ~15 FPS
  - Heavy detector (RetinaFace): 1 vCPU → ~5-8 FPS
- **Recommendation**: Allocate based on frame rate target
  - 5 FPS × 30 cameras = 150 FPS needed → ~15-20 vCPU for detection

#### **Face Recognition (ArcFace CPU via ONNX)**
- **Throughput**: ~12-15 crops/sec per CPU core (batched)
- **Allocation**: Depends on number of faces detected per minute
  - ~2-3 crops per camera per minute (typical) → minimal recognition CPU
  - High-traffic: Scale horizontally with workers

#### **Liveness Check (lightweight CNN)**
- **Throughput**: ~12 crops/sec per vCPU
- **Allocation**: Small; only called for top-N matches
- **CPU Impact**: Negligible if properly gated

#### **Overall Deployment Sizing**

| Scale | Cameras | vCPU | RAM | GPU | Notes |
|-------|---------|------|-----|-----|-------|
| **Small** | ≤10 @ 5fps | 6-8 | 16GB | None | Saturday Demo config |
| **Medium** | 25-30 @ 5fps | 12-14 | 24-32GB | 1x GPU (optional) | Typical college |
| **Large** | 50+ @ 5fps | 20-24 | 32-48GB | 2x GPU (optional) | Enterprise |

---

## Cache Mechanism & Deduplication

### Design Rationale

**Problem**: Multiple frames of same person trigger duplicate attendance events  
**Solution**: Redis-based cache for recent-seen state + dedup window

### Cache Components

#### **Recent-Seen / Dedup Window**
- **Purpose**: Avoid multiple attendance events for same employee from repeated frames/tracks
- **Implementation**: Store `recent_seen:{camera_id}:{user_id}` with TTL (e.g., 10-120s)
- **Example**:
  ```
  recent_seen:camera_01:emp_42 = {last_seen_ts}  [TTL: 60s]
  ```
- **Presence**: If key exists → skip (log dedup); else → proceed to attendance logic

#### **Track → User Binding Cache**
- **Purpose**: While a track is active, cache the user_id to avoid re-recognizing same track
- **Implementation**: Store `track_user:{camera_id}:{track_id}` = {user_id, last_seen_ts}
- **TTL**: Until track times out (e.g., 30-60s inactivity)
- **Benefit**: Reduces embedding computation for same person in same track

#### **User Profile Cache (Fast Read Fallback)**
- **Purpose**: Cache user metadata for fast access if Postgres is slow/down
- **Implementation**: Read-through cache with async refresh
- **Cached Items**: user_id → {name, emp_code, dept, is_active, access_flags}
- **TTL**: Longer (e.g., 10-30 min, refreshed on write)
- **Fallback**: If Postgres down, use cached profile for basic attendance

#### **Retry Queue / Pending Events**
- **Purpose**: Temporary storage for failed uploads/events
- **Implementation**: Redis stream or list (`retry_queue`)
- **Behavior**: Background worker retries exponential backoff
- **Lifetime**: Stored until successful or max retries exceeded

#### **Alert Dedup / Suppression**
- **Purpose**: Avoid alert fatigue from repeated same alert
- **Implementation**: Store `alert_suppressed:{alert_key}` with TTL (e.g., 300s)
- **Example**:
  ```
  alert_suppressed:spoof:camera_01:emp_42 = True  [TTL: 300s]
  ```
- **Behavior**: If exists → do not send alert; else → send and set key

### Flow: Dedup & Track Binding

```
1. Tracker outputs track_id for detection.
2. Recognition returns user_id with confidence.
3. Worker checks recent_seen:{camera}:{user} — if exists → skip (log dedup).
4. Else write recent_seen:{camera}:{user} = now [TTL 60s] and proceed to attendance logic.
5. Also set track_user:{camera}:{track_id} = {user_id, now} [TTL 60s].
6. For same track, if recognized again within TTL → reuse cached user_id, skip recognition.
```

### Fallback When DB Down

- **Cache Hit Strategy**: If Postgres unreachable, fetch `user_profile:{user_id}` from Redis
- **Behavior**: Mark attendance event with `source=cached` and queue for retry
- **Recovery**: Background retry worker attempts upload when DB recovers

---

## Failure Handling & Retry Policy

### Failure Modes & Handling Mechanisms

#### **FAISS / Vector DB Unavailable**
- **Trigger**: Vector search fails; embedding extracted but no match possible
- **Handling**:
  - Fallback to degraded mode: run embedding match against in-memory fallback
  - Mark event with `no_index` → push to logging/alert service
  - Alert Deny Access Feature store or No match depending on logic
- **Recovery**: Retry embedding match on next recognition event

#### **PostgreSQL User DB Unavailable**
- **Trigger**: Cannot fetch user profile or write attendance event
- **Handling**:
  - **Immediate**: Use cached `user_profile:{user_id}` from Redis (if present)
  - If not cached → do not block recognition → create provisional attendance event with `status=DB_LOOKUP_FAIL`
  - Push event to Redis `retry_queue` for post-processing
  - **Alert**: Deny Access User DB and log Ops alert (high severity)
- **Recovery**: Background retry worker processes retry_queue when DB recovers
- **No Block Recognition**: Don't stop attendance pipeline; always attempt write

#### **Liveness Model Failures / Model Crashes**
- **Trigger**: Liveness inference errors or process crash
- **Handling**:
  - Mark liveness as `unknown` → policy engine decides based on fallback rule (default: deny)
  - Log error and alert Deny Access Spoof
  - Retry liveness for next frame of same track (if multiple crops available)
- **Recovery**: Model restarts automatically; next recognition event retries

#### **Network/IO Issues**
- **RTSP Disconnect**: Reconnect with exponential backoff (0.5s → 1s → 2s) up to max retries
- **Write to DB Fails**: Store in Redis retry_queue; background worker retries with exponential backoff
  - Attempt counts: 3 immediate retries (0.5s, 1s, 2s jitter)
  - Then queued for retry worker with longer backoff
  - Final failure: Permanent audit log + alert

### Retry Policy Details

#### **Immediate Retries** (Inline, <5 seconds)
- **Attempts**: 3 times with small jitter (0.5s → 1s → 2s)
- **Use Cases**: Temporary network hiccup, transient service unavailability
- **Non-blocking**: Move to next frame/crop if retries exhausted

#### **Queued Retries** (Background worker)
- **Mechanism**: Redis stream `retry_queue` with attempt_count field
- **Backoff**: Exponential backoff up to 5 retries
  - Attempt 1: Immediate
  - Attempt 2: Base delay (5-10s)
  - Attempt 3: 2x delay
  - Attempt 4: 4x delay
  - Attempt 5: Max delay (5 min)
- **On Final Failure**: Record permanent audit log and raise high-severity alert

#### **On DB Unavailability**
- **Create Provisional Event**: Write attendance event with `status=DB_LOOKUP_FAIL` and `source=cached`
- **Queue for Retry**: Push to `retry_queue` with mark for post-processing
- **Alert**: Alert Deny Access User DB (high severity) to Ops

---

## Alert Classification & Actions

### Alert Types & Severity Levels

| Alert Key | Trigger | Severity | Action | Destination |
|-----------|---------|----------|--------|-------------|
| **DenyAccess_NoFace** | No face crop found at checkpoint / repeated | Medium | Deny access, log, notify guard | Monitoring UI, Security Dashboard |
| **DenyAccess_FeatureStore** | FAISS/index failure | High | Deny or fallback; alert Ops | Security Dashboard, Ops Alert |
| **Alert_Security_Repeated** | Repeated failed matches or tampering attempts | High | Notify security + create incident | Security Dashboard, Incident Log |
| **DenyAccess_NoMatch** | Face matched below confidence & policy denies | Medium | Deny access, show message, log | Monitoring UI, Log |
| **Alert_Security_Spoof** | Liveness failed (spoof detection) | Critical | Immediate security alert, lock gate if integrated | Security Dashboard, SMS/Email |
| **DenyAccess_UserDB** | User DB unreachable, no cache | High | Deny/Quarantine, raise ops alert | Ops Dashboard, Alert |
| **DenyAccess_Timeout** | Decision timeout (pipeline stalled) | Medium/High | Deny, log, notify Ops | Monitoring UI, Ops Alert |

### Alert Sinks

- **Monitoring UI**: Show active alerts & status on real-time dashboard
- **Security Dashboard**: Immediate security incidents (spoof, repeated attempts)
- **Audit Logs**: Append-only event store for compliance & investigations
- **SMS/Email**: Critical alerts (spoof, repeated attacks)
- **Ops Alerts**: System-level failures (DB down, model crash)

---

## Policy Evaluation Flow (OPA Integration)

### Policy Decision Flow When Candidate is Recognized

#### **Step 1: Recognition & Liveness**
- Face recognition returns `{user_id, confidence}`
- Liveness result: `pass / fail / unknown`

#### **Step 2: Gather Policy Input**
Collect data for policy engine:
```json
{
  "user_profile": {
    "user_id": "emp_42",
    "name": "John Doe",
    "department": "Engineering",
    "access_level": "standard",
    "is_active": true
  },
  "camera_meta": {
    "camera_id": "cam_main_gate",
    "location": "main_entrance",
    "zone": "restricted"
  },
  "timestamp": 1645000000,
  "confidence": 0.95,
  "liveness": "pass"
}
```

#### **Step 3: Query OPA Policy Engine**
```
OPA.Eval(
  policy="attendance/access_policy",
  input=policy_input
)
```

#### **Step 4: OPA Returns Decision**
```json
{
  "allow": true/false,
  "reason": "User has valid access during shift hours",
  "actions": ["log_attendance", "notify_dashboard"]
}
```

#### **Step 5: Attendance Service Acts on Decision**

**If `allow: true`**:
- Create attendance event with status `IN` or `OUT`
- Write to PostgreSQL
- Push event to Redis for dashboard
- Notify success

**If `allow: false`**:
- Send denial alert to security/monitoring
- Log reason for audit trail
- Optionally lock gate (if integrated)
- Do NOT create attendance event

#### **Key Points for Auditability**
- **Log OPA Input & Output**: Store in audit log for incident investigations
- **Decision Trace**: Include policy rule that triggered decision
- **Timestamping**: Precise timestamp for every decision
- **Reason Field**: Human-readable explanation for audit team

---

## CPU Sizing Evaluation

### Workload Assumptions

| Parameter | Value |
|-----------|-------|
| **Video Resolution** | 720p (or 640p low priority) |
| **Frame Rate Processed** | ~5 FPS (not full 30 FPS) |
| **Face Density** | 1-3 faces per frame (typical entrance scenario) |
| **Detection Model** | BlazeFace / RetinaFace-CPU |
| **Recognition Model** | ArcFace/FaceNet CPU via ONNX/OpenVINO |
| **Vector DB** | FAISS (in-memory, CPU) |
| **Liveness Model** | MediaPipe / small CNN |
| **Tracker** | ByteTrack/DeepSORT (minimal CPU) |

### Deployment Sizing

#### **Small (≤10 cameras @ 5 fps) - Saturday Demo Config**
- **vCPU**: 6-8 cores
- **RAM**: 16 GB
- **GPU**: None required (all CPU)
- **Breakdown**:
  - RTSP Decode: ~2-3 vCPU (10 streams)
  - Detection: ~3-4 vCPU (light detector, 5 fps)
  - Recognition: ~1-2 vCPU (low volume, ~20 crops/min)
  - Misc (tracker, policy, API): ~1 vCPU
- **Headroom**: 20% for spikes and overhead

#### **Medium (25-30 cameras @ 5 fps) - Typical College**
- **vCPU**: 12-14 cores
- **RAM**: 24-32 GB
- **GPU**: 1x optional (offload recognition for lower CPU usage)
- **Breakdown**:
  - RTSP Decode: ~7-9 vCPU (30 streams)
  - Detection: ~4-5 vCPU (light detector, 150 FPS total)
  - Recognition: ~1-2 vCPU (batched, ~1-2 crops/cam/min = 30-60 crops/min)
  - Misc: ~1 vCPU
- **GPU Option**: 1x GPU (RTX 4060 or A100) can offload recognition entirely, free up ~2 vCPU

#### **Large (50+ cameras @ 5 fps) - Enterprise**
- **vCPU**: 20-24 cores (or 16 cores + 1x GPU)
- **RAM**: 32-48 GB
- **GPU**: 2x optional (recognition + fallback)
- **Breakdown**:
  - RTSP Decode: ~15-18 vCPU (50+ streams)
  - Detection: ~5-6 vCPU (light detector, ~250 FPS)
  - Recognition: ~2-3 vCPU (with GPU, much less)
  - Misc: ~1-2 vCPU

### Rough CPU Performance Metrics

| Component | Model | Throughput | CPU Cost |
|-----------|-------|-----------|----------|
| **RTSP Decode (720p)** | H.264 | 0.3 vCPU / stream | ~3 vCPU / 10 streams |
| **Face Detection** | BlazeFace | 15 FPS / core | 1 vCPU → 15 FPS |
| **Face Detection** | RetinaFace | 5 FPS / core | 1 vCPU → 5 FPS |
| **Recognition** | ArcFace CPU (ONNX) | 12-15 crops/sec | 1 vCPU → 12-15 crops/sec |
| **Liveness** | MediaPipe CNN | 12 crops/sec | ~0.5 vCPU (only top-N) |
| **FAISS Search** | In-memory HNSW | <5ms / query | <1% vCPU |

---

## Development Task Breakdown

### Epic 1 — Camera & Stream Handling

**Team**: Video + AI/ML  
**Priority**: High (foundation)

#### **Story 1.1: NVR Integration (RTSP Pull)**
- [ ] Implement RTSP connection pooling (per camera config)
- [ ] Fetch camera config from database (name, location, RTSP URL)
- [ ] Handle camera online/offline status
- [ ] Graceful reconnect with exponential backoff

#### **Story 1.2: Camera Handling Service (Threaded Workers)**
- [ ] Implement lightweight RTSP grabber threads
- [ ] Per-stream frame queue (bounded, configurable max size)
- [ ] JPEG encoding of frames for efficient queueing
- [ ] Frame throttling (configurable FPS per camera)

#### **Story 1.3: Frame Throttling & Backpressure**
- [ ] Add dynamic FPS throttling based on detector queue depth
- [ ] Implement queue size monitoring
- [ ] Drop frames if queue full (configurable strategy)
- [ ] Metrics collection (frames dropped, queue depth)

#### **Story 1.4: Frame Queue & Retry Mechanism**
- [ ] Bounded queue implementation (FIFO)
- [ ] Retry logic for failed frame processing
- [ ] Local buffering if downstream is slow

#### **Story 1.5: Health Check API**
- [ ] Expose camera online/offline status endpoint
- [ ] Track last-seen timestamp per camera
- [ ] Dashboard visibility for camera health

---

### Epic 2 — Stream Ingestion (Detection + Tracking)

**Team**: Video + AI/ML  
**Priority**: High (core pipeline)

#### **Story 2.1: Face Detection Integration**
- [ ] Integrate face detection model (BlazeFace/RetinaFace-CPU)
- [ ] Load model in detector worker pool
- [ ] Inference pipeline on frames from queue
- [ ] Output: detection boxes + confidence scores

#### **Story 2.2: Multi-Object Tracker Implementation**
- [ ] Implement tracker (DeepSORT or ByteTrack)
- [ ] Per-camera tracker instance (single-threaded)
- [ ] Kalman filter + IoU matching for stable IDs
- [ ] Output: track_id + bounding box

#### **Story 2.3: Face Deduplication (Per-Camera Time Window)**
- [ ] Detect same face across multiple frames/tracks
- [ ] Implement dedup window (time-based, e.g., 10-120s)
- [ ] Avoid duplicate recognition for same person in short window
- [ ] Cache recent-seen in Redis

#### **Story 2.4: Best Frame Selection & Crop Extraction**
- [ ] Extract face crops from tracked regions
- [ ] Quality scoring (Laplacian variance for sharpness)
- [ ] Select best crop per track
- [ ] Send to recognition queue

#### **Story 2.5: Redis Integration for Detection Output**
- [ ] Buffer detection results in Redis (ephemeral cache)
- [ ] Retry mechanism for failed uploads
- [ ] Integration point with recognition service

---

### Epic 3 — Recognition Service

**Team**: Video + AI/ML  
**Priority**: High (core recognition)

#### **Story 3.1: Embedding Extraction (ArcFace/FaceNet)**
- [ ] Integrate ArcFace/FaceNet with ONNX Runtime (CPU) or OpenVINO
- [ ] Load pre-trained model weights
- [ ] Extract 512D face embeddings from crops
- [ ] Batching support for efficient inference

#### **Story 3.2: FAISS Vector DB Integration**
- [ ] Build FAISS index (HNSW or IVF) with student embeddings
- [ ] In-memory index loading at startup
- [ ] Periodic index updates on new enrollments
- [ ] Expose match API to recognition service

#### **Story 3.3: Top-K Similarity Search**
- [ ] Query FAISS for top-10 matches per embedding
- [ ] Return matched user_id + confidence score
- [ ] Handle no-match scenario (threshold below cutoff)

#### **Story 3.4: Redis Cache for Recent Embeddings**
- [ ] Cache recently extracted embeddings (avoid recompute)
- [ ] TTL-based expiry (e.g., 10-30 seconds)
- [ ] Hit rate monitoring

#### **Story 3.5: Low-Confidence / No-Match Alert**
- [ ] Handle recognition failures (confidence < threshold)
- [ ] Log unidentified face event
- [ ] Alert security team for manual verification

---

### Epic 4 — Liveness Detection

**Team**: Video + AI/ML  
**Priority**: Medium (anti-spoofing)

#### **Story 4.1: Lightweight Liveness Model Integration**
- [ ] Integrate MediaPipe or small CNN for anti-spoofing
- [ ] CPU-based inference (fast, <50ms per crop)
- [ ] Output: pass/fail/unknown

#### **Story 4.2: Liveness Gating (Top-N Matches Only)**
- [ ] Run liveness only on top-K recognized candidates (not all crops)
- [ ] Optimize CPU usage (liveness is expensive)

#### **Story 4.3: Spoof Alert**
- [ ] Trigger high-severity alert on liveness failure
- [ ] Log spoof attempt for security review
- [ ] Push immediate notification (SMS/Email if configured)

---

### Epic 5 — Attendance Service

**Team**: Core Server Logic  
**Priority**: High (business logic)

#### **Story 5.1: Attendance Event Schema**
- [ ] Define schema: IN/OUT, timestamp, camera_id, employee_id, confidence
- [ ] Implement event creation logic
- [ ] Validate schema before DB write

#### **Story 5.2: Deduplication Logic (N-Minute Window)**
- [ ] Implement per-employee dedup window (e.g., 120 seconds)
- [ ] Check recent_seen cache before logging new event
- [ ] Skip duplicate if found within window

#### **Story 5.3: Business Rules (Shift Mapping, IN/OUT Detection)**
- [ ] Map attendance to employee shift schedules
- [ ] Detect IN vs OUT based on time and history
- [ ] Handle multiple IN/OUT events per day

#### **Story 5.4: OPA / Keycloak Integration for Policy Evaluation**
- [ ] Integration with Open Policy Agent (OPA) for access policies
- [ ] Query policy with user + camera + time context
- [ ] Apply policy decision (allow/deny) before logging

#### **Story 5.5: PostgreSQL Event Persistence**
- [ ] Write attendance events to Postgres DB
- [ ] Async writes (non-blocking recognition pipeline)
- [ ] Fallback to Redis retry queue on DB failure

---

### Epic 6 — Alerts & Logging

**Team**: Core Server Logic  
**Priority**: High (compliance & ops)

#### **Story 6.1: Alert Categories**
- [ ] Define alert types: NoFace, NoMatch, Spoof, RepeatedAttempts, DBDown, Timeout, etc.
- [ ] Assign severity levels (Critical, High, Medium)

#### **Story 6.2: Alert Service (Publish/Subscribe Model)**
- [ ] Build alert pub/sub service
- [ ] Route alerts to appropriate destinations (UI, Security, Email, SMS)

#### **Story 6.3: Audit Log Database**
- [ ] Append-only audit log in Postgres
- [ ] Store all attendance events + policy decisions + alerts
- [ ] Enable compliance audits and incident investigations

#### **Story 6.4: Monitoring Integration**
- [ ] Export metrics to Prometheus
- [ ] Grafana dashboards for pipeline health
- [ ] Alert on bottlenecks (queue depth, latency, error rate)

#### **Story 6.5: Dashboard Notifications API**
- [ ] Expose API for real-time alerts to UI
- [ ] WebSocket or SSE for live updates
- [ ] Alert dedup/suppression (avoid alert fatigue)

---

### Epic 7 — Caching & Reliability

**Team**: Core Server Logic  
**Priority**: High (production readiness)

#### **Story 7.1: Redis Cache Layer**
- [ ] Use Redis for:
  - Recent embeddings (avoid recompute)
  - Dedup state (employee recently seen)
  - Frame queue (temporary if recognition is slow)
  - User profile cache (fallback if DB down)

#### **Story 7.2: Retry Queue for Failed DB Writes**
- [ ] Implement Redis stream / list for failed events
- [ ] Background retry worker with exponential backoff
- [ ] Mark events on successful retry

#### **Story 7.3: Agent-to-Server Message Buffering (Outages)**
- [ ] Local buffering on edge devices during network outages
- [ ] Reconnect and flush buffer when network recovers
- [ ] Dedup on flush to avoid double-counting

---

### Epic 8 — Admin & Configuration Management

**Team**: Frontend  
**Priority**: Medium (operational)

#### **Story 8.1: Camera Configuration UI**
- [ ] Add/edit/delete cameras in admin panel
- [ ] Assign camera to location/zone
- [ ] Implement ONVIF discovery (auto-detect cameras)

#### **Story 8.2: Employee CRUD Operations**
- [ ] Add/edit/delete employees
- [ ] Upload enrollment images for embedding generation
- [ ] Bulk import (CSV)

#### **Story 8.3: Sync Embeddings into FAISS Index**
- [ ] Trigger embedding extraction on enrollment
- [ ] Update FAISS index with new embeddings
- [ ] Delete embeddings on employee removal

#### **Story 8.4: Shift & Policy Management UI**
- [ ] Define shifts (start/end times)
- [ ] Assign employees to shifts
- [ ] Configure access policies (zones, blacklist, etc.)

---

### Epic 9 — Deployment & Operations

**Team**: DevOps/Combined  
**Priority**: Low (after MVP)

#### **Story 9.1: Dockerization**
- [ ] Create Docker images for each service
- [ ] Multi-stage builds for smaller images
- [ ] Health checks for liveness/readiness probes

#### **Story 9.2: Docker Compose Orchestration**
- [ ] Single-server deployment via docker-compose
- [ ] Network isolation, volume management
- [ ] Environment config (database, Redis, etc.)

#### **Story 9.3: Monitoring Stack (Prometheus + Grafana)**
- [ ] Prometheus scrape targets for each service
- [ ] Custom dashboards for pipeline health
- [ ] Alert rules for critical issues

#### **Story 9.4: Automated Backups**
- [ ] Postgres backup strategy
- [ ] Redis persistence
- [ ] FAISS index snapshots

---

### Epic 10 — Testing & Simulation (Optional / Later)

**Team**: Test/Combined  
**Priority**: Medium (post-MVP)

#### **Story 10.1: RTSP Camera Simulator**
- [ ] Implement mock RTSP server using prerecorded video files
- [ ] Stream looped video as RTSP feed
- [ ] Configurable for multiple virtual cameras

#### **Story 10.2: Synthetic Face Generation**
- [ ] Generate synthetic face images (random variations)
- [ ] Simulate different lighting, angles, expressions
- [ ] Shuffle enrolled employees for realistic scenarios

#### **Story 10.3: No-Face Scenario Simulation**
- [ ] Empty corridor/scene (no faces)
- [ ] Test detection/tracking robustness on empty frames

#### **Story 10.4: Spoof Scenario Simulation**
- [ ] Printout/photo attack clips
- [ ] Validate liveness detection effectiveness

#### **Story 10.5: Event Playback & Time Simulation**
- [ ] Replay recorded camera streams
- [ ] Simulate shift changes, crowd entry
- [ ] Validate dedup logic

#### **Story 10.6: CI/CD Pipeline Integration**
- [ ] Auto-run simulator on each build
- [ ] Test detection/tracking/recognition on synthetic data
- [ ] Report performance metrics (FPS, latency, accuracy)

#### **Story 10.7: Web UI Toggle for Simulator**
- [ ] Allow selection between live NVR camera vs simulated camera
- [ ] Config option to switch seamlessly (for testing)

#### **Story 10.8: Load Testing & Performance Benchmarking**
- [ ] Simulate 50+ concurrent camera streams
- [ ] Measure CPU/memory/latency under load
- [ ] Document performance envelope

---

## Summary

This document consolidates all SMAP architectural requirements, covering:

✅ **Runtime Architecture**: Complete pipeline from camera → attendance service  
✅ **On-Premises Deployment**: Modular service architecture  
✅ **Process Layout**: Detailed component responsibilities and concurrency  
✅ **Concurrency Model**: Threading strategy for each component  
✅ **Resource Scheduling**: CPU/RAM sizing for different deployment scales  
✅ **Cache Mechanism**: Redis-based dedup and ephemeral state management  
✅ **Failure Handling**: Retry policies and fallback mechanisms  
✅ **Alert Classification**: Alert types, severity levels, and actions  
✅ **Policy Evaluation**: OPA integration for access control decisions  
✅ **CPU Sizing**: Specific sizing guidance for small/medium/large deployments  
✅ **Development Tasks**: 10 epics with 50+ stories for implementation  

---

**Document Version**: 1.0  
**Last Updated**: March 5, 2026  
**Status**: Ready for Development

