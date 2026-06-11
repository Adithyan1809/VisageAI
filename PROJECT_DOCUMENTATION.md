# SMAP: SMART MONITORING & ATTENDANCE PLATFORM
**Project Overview & Technical Documentation**

---

## 1. WHAT IS SMAP?

**SMAP** = Smart Monitoring & Attendance Platform - an AI-powered student attendance system using real-time face recognition.

### Core Capabilities
- **Real-time facial recognition** with 99%+ accuracy
- **Liveness detection** to prevent spoofing (photos, videos, masks)
- **Automatic attendance capture** in <500ms per student
- **On-premises deployment** for privacy and security
- **Scalable architecture** supporting 50-500 students per classroom
- **Teacher & admin dashboards** for monitoring and reporting

---

## 2. THE PROBLEM WE'RE SOLVING

### Current Manual Attendance Issues
- Roll call takes 5-10 minutes (wasting 50+ hours per semester per class)
- Paper records are lost, damaged, or falsified
- No real-time data for intervention
- Manual entries prone to errors (spelling, duplicates)
- Proxy attendance possible (friends marking each other)
- Time-consuming for teachers and administrators

### Business Impact
- Teachers frustrated with attendance overhead
- Students gaming the system
- Administrators lack real-time attendance insights
- No automated early-warning system for at-risk students

---

## 3. HOW SMAP WORKS

### The Complete Pipeline

```
Camera Stream 
    ↓
Face Detection (Find faces in frame)
    ↓
Face Tracking (Follow student across frames)
    ↓
Face Recognition (Match to student database)
    ↓
Liveness Check (Verify it's a real person)
    ↓
Policy Engine (Apply rules: lecture hours? course? status?)
    ↓
Attendance Logging (Save to database)
    ↓
Dashboard Display (Teacher/Admin view)
```

### Technical Breakdown

| Stage | Component | Purpose | Technology |
|-------|-----------|---------|-----------|
| 1 | **Stream Ingestor** | Capture RTSP video feeds from cameras | FFMPEG + OpenCV |
| 2 | **Face Detector** | Locate faces in video frames | RetinaFace + ONNX |
| 3 | **Tracker** | Follow individual students across frames | DeepSORT algorithm |
| 4 | **Face Recognition** | Identify who each student is | ArcFace embeddings + FAISS vector search |
| 5 | **Liveness Detector** | Verify real person (anti-spoofing) | Liveness neural network + eye-movement analysis |
| 6 | **Policy Engine** | Apply attendance rules based on context | Open Policy Agent (OPA) |
| 7 | **Attendance Service** | Log attendance events and metadata | PostgreSQL database |
| 8 | **Cache Layer** | Speed up repeated lookups (embeddings, policies) | Redis in-memory cache |
| 9 | **Web Dashboard** | UI for teachers and administrators | Next.js + React + Tailwind CSS |

---

## 4. STUDENT EXPERIENCE

### Day-to-Day Workflow

**When student arrives:**
1. Walks into classroom with SMAP camera installed
2. Camera detects face automatically
3. System recognizes student instantly
4. Attendance marked automatically
5. Optional: Confirmation displayed on classroom screen ("✓ Attendance Marked - 9:15 AM")
6. Student proceeds to seat—no interruption to class

**Timeline:** < 1 second from entering room to attendance recorded

**No manual interaction required** from student

---

## 5. TEACHER EXPERIENCE

### Classroom Dashboard Features

**Real-time Monitoring:**
- View live attendance as students arrive
- See which students are present/absent
- List of late arrivals

**Post-Class Actions:**
- Manually override attendance (sick leave, late entry, excused absence)
- Download attendance report as Excel file
- View historical attendance records
- Set custom policies for the class

**Benefits for Teachers:**
- No manual attendance register needed
- Instant reports for department head
- Data-backed insights on student attendance patterns
- Quick identification of chronic absentees

---

## 6. ADMINISTRATOR EXPERIENCE

### Campus-wide Admin Dashboard

**Real-time Insights:**
- View attendance across all classrooms and departments
- Monitor which classes have high/low attendance
- Identify chronically absent students (early-warning system)
- Compare attendance trends across time periods

**Reporting & Compliance:**
- Generate institutional attendance reports
- Track compliance metrics for accreditation (NBA, AICTE)
- Export data in multiple formats
- Create analytics dashboards for management

**System Management:**
- Manage user permissions and roles
- Assign cameras to classrooms
- Configure policies and rules
- Monitor system health and uptime

---

## 7. ARCHITECTURE OVERVIEW

### System Components

**Video Processing Layer:**
- Stream Ingestor: Handles multiple RTSP camera feeds concurrently
- Face Detector: Processes frames at 15-30 FPS
- Tracker: Maintains student identities across frames
- Recognition: Matches detected faces against student embeddings database

**Intelligence Layer:**
- Liveness Detector: Prevents spoofing attempts
- Policy Engine: Applies complex rules (time-based, course-based, event-based)
- Embedding Database: FAISS index for fast facial search

**Persistence Layer:**
- PostgreSQL: Permanent attendance records, user data, configurations
- Redis: Ephemeral cache for embeddings, policies, session data
- File Storage: Backup of enrollment photos, clips

**Interface Layer:**
- FastAPI Backend: REST APIs for dashboard and integrations
- Next.js Frontend: Web UI for teachers and admins
- WebSocket: Real-time attendance updates

### Data Flow Architecture

```
Cameras (RTSP)
    ↓
Edge Server / GPU
├─ Frame Processing (CPU)
├─ Detection (GPU)
├─ Tracking (CPU)
└─ Recognition (GPU)
    ↓
Policy Engine (OPA)
    ↓
PostgreSQL (Persistent) + Redis (Cache)
    ↓
Web Dashboard (Teacher/Admin)
```

### Deployment Model

**On-Premises:**
- All processing happens inside college IT infrastructure
- No cloud dependencies
- No data leaves college network
- Complete control over data and security

**Network Architecture:**
- All cameras on college internal network (wired Ethernet preferred)
- Server can be on same network or separate management network
- Optional: VPN access for off-campus teacher dashboard
- Encrypted connections between components

---

## 8. TEAM STRUCTURE & ROLES

### Team Members

| Role | Name | Responsibility | Key Skills |
|------|------|-----------------|-----------|
| **Project Lead** | [Name] | Overall vision, roadmap, stakeholder management | Product strategy, ML systems, leadership |
| **Video + ML Lead** | [Name] | Camera pipelines, face detection, recognition, liveness | Computer vision, ONNX, PyTorch, optimization |
| **Backend Lead** | [Name] | APIs, database, policy engine, integrations | Python, FastAPI, PostgreSQL, OPA |
| **Frontend Lead** | [Name] | Web dashboard, UI/UX, reporting | React, Next.js, Tailwind CSS, UX design |
| **DevOps Lead** | [Name] | Deployment, infrastructure, monitoring, security | Docker, Linux, monitoring, security |

### Team Responsibilities

**Video + ML Team:**
- Camera stream ingestion and processing
- Face detection (RetinaFace model optimization)
- Multi-object tracking (DeepSORT)
- Face recognition (ArcFace embeddings + FAISS)
- Liveness detection (anti-spoofing)
- Model optimization for real-time performance

**Backend Team:**
- REST API development (FastAPI)
- Database design and optimization (PostgreSQL)
- Policy engine implementation (OPA)
- Authentication and authorization
- Event logging and queuing
- Integration with college systems

**Frontend Team:**
- Teacher dashboard (attendance view, overrides, reports)
- Admin analytics dashboard (campus-wide insights)
- User management interface
- Real-time updates (WebSocket integration)
- Report generation and export

**DevOps Team:**
- Docker containerization
- Deployment automation
- Server setup and configuration
- Monitoring and alerting
- Backup and disaster recovery
- Security hardening

---

## 9. TECHNICAL REQUIREMENTS

### Per-Classroom Setup

**Hardware:**
- 1 IP camera with RTSP support (₹8,000-15,000 range)
- Network: Wired Ethernet connection (PoE preferred)
- Power: PoE injector or camera power adapter

**Server Infrastructure:**
- Processing server: 4-core CPU, 16GB RAM minimum
- GPU (optional): NVIDIA GPU for faster face detection
- Storage: 500GB-2TB for video clips and embeddings backup

### Network Requirements
- All cameras on internal network (no internet requirement)
- Latency: <100ms between camera and processing server (optional)
- Bandwidth: ~5 Mbps per camera stream (varies by resolution)

### Scalability Profile

| Campus Size | Students | Classrooms | Cameras | Servers | Storage |
|-------------|----------|-----------|---------|---------|---------|
| **Small** | 1,000 | 25 | 5-10 | 1 | 500GB |
| **Medium** | 5,000 | 100 | 20-30 | 2-3 | 2TB |
| **Large** | 10,000+ | 200+ | 50+ | 4-5 | 5TB+ |

---

## 10. STUDENT ENROLLMENT PROCESS

### Getting Students into the System

**Step 1: Photo Capture**
- Method A: Students submit ID card photos (existing)
- Method B: Live classroom camera capture (first-time setup)
- Method C: Dedicated enrollment kiosk

**Step 2: Face Processing**
- Extract facial features from photos using ArcFace
- Create unique facial embeddings (mathematical fingerprints)
- Store embeddings in FAISS index for fast matching

**Step 3: Metadata Association**
- Link embeddings to student ID, name, department
- Store in PostgreSQL with enrollment date
- Mark as "active" for attendance tracking

**Step 4: Quality Verification**
- System checks enrollment quality (good lighting, frontal face, clear features)
- Rejects blurry or partial face captures
- Requires retake for failed enrollments

**Step 5: Ready for Recognition**
- System can now recognize student in real-time camera feeds
- Continuously updates embeddings as system learns student's variations

---

## 11. SECURITY & PRIVACY SAFEGUARDS

### Data Protection

**No Cloud Storage:**
- All processing on-premises
- No data sent to external services
- No third-party face recognition vendors

**Database Encryption:**
- PostgreSQL with encryption at rest
- Encrypted backups
- Secure key management

**Access Control:**
- Role-based access (teachers see own class, admins see all)
- User authentication via college credentials (LDAP/SSO integration)
- Audit logging of all data access

### Anti-Spoofing Technology

**Multiple Layers:**
1. **Liveness Detection** - Detects photos, videos, 3D masks
2. **Multi-frame Matching** - Requires consistent face across 5+ frames
3. **Eye-Movement Detection** - Optional: Verifies eye movement (impossible with static photo)
4. **Quality Checks** - Rejects low-quality, blurry, or unusual angle captures

**Spoofing Prevention Results:**
- Cannot fool with printed photos
- Cannot fool with video playback
- Cannot fool with masks or prosthetics
- Requires real human face

### Privacy Compliance

**Data Minimization:**
- Only facial embeddings stored (not raw photos)
- Enrollment photos kept minimal (can be deleted after processing)
- No behavioral tracking or surveillance

**Regulatory Compliance:**
- GDPR-ready: Can delete student data on request
- FERPA-compliant: US education privacy standards
- AICTE/NBA: Supports attendance tracking for accreditation
- Local regulations: Customizable per college requirements

---

## 12. INTEGRATION CAPABILITIES

### Connecting with Existing Systems

**Student Database Integration:**
- Sync student list from college ERP
- Automatic enrollment of new students
- Deactivation of graduating/transferred students

**ERP System Integration:**
- Post attendance data to college ERP
- Automated absence notifications
- Integration with academic standing calculations

**Email System Integration:**
- Send absence notifications to parents
- Generate attendance reports automatically
- Schedule bulk communications

**Learning Management System:**
- Push attendance data to LMS (Canvas, Moodle, Blackboard)
- Trigger automated interventions for low attendance
- Compliance reports for accreditation

### API Architecture

**REST Endpoints Available:**
- `/api/attendance/mark` - Mark attendance for a student
- `/api/attendance/get` - Retrieve attendance records
- `/api/students/enroll` - Enroll new student
- `/api/policies/apply` - Get policy decision for attendance
- `/api/dashboard/stats` - Get analytics data
- `/api/system/health` - System status

---

## 13. IMPLEMENTATION ROADMAP

### Phase 1: Pilot (1-2 Weeks)
**Goal:** Validate system in controlled environment

- Install cameras in 2-3 classrooms
- Enroll student photos
- Run live attendance tracking
- Compare SMAP vs. manual roll call
- Gather teacher feedback
- Validate accuracy (target: 99%+)

**Success Metrics:**
- ✅ >99% accuracy vs. manual attendance
- ✅ <500ms recognition time per student
- ✅ 100% liveness detection (no spoofing)
- ✅ Teachers rate satisfaction >4/5
- ✅ Zero system outages during pilot

### Phase 2: Rollout (4-6 Weeks)
**Goal:** Expand to all classrooms

- Install cameras in all classrooms
- Bulk enrollment of all students
- Train all teachers on dashboard
- Establish IT support procedures
- Monitor system performance at scale

### Phase 3: Optimization (Ongoing)
**Goal:** Improve accuracy and user experience

- Gather usage feedback
- Optimize recognition models
- Add requested features
- Integrate with other systems
- Expand to other use cases (lab attendance, event check-in)

---

## 14. KEY FEATURES & CAPABILITIES

### Real-Time Features
- ✅ Live attendance capture as students appear
- ✅ Instant dashboard updates (WebSocket)
- ✅ Real-time accuracy metrics
- ✅ Live system health monitoring

### Reporting Features
- ✅ Daily, weekly, monthly attendance reports
- ✅ Per-student attendance history
- ✅ Department/branch level rollups
- ✅ Custom date range queries
- ✅ Excel/PDF export

### Policy Features
- ✅ Time-based policies (lecture hours only)
- ✅ Course-based policies (specific to each subject)
- ✅ Event-based policies (exams, labs, special lectures)
- ✅ Custom rules engine (OPA for flexibility)
- ✅ Manual overrides (sick leave, late entry)

### Safety & Reliability
- ✅ Automatic fallback to manual attendance if system fails
- ✅ Daily backup of all data
- ✅ System health monitoring with alerts
- ✅ Redundant components for high availability
- ✅ Graceful degradation under load

---

## 15. DEVELOPMENT ROADMAP

### Epic 1: Core Face Recognition Pipeline ✅ 
- Stream ingestion and processing
- Face detection optimization
- Tracking and recognition
- Liveness detection

### Epic 2: Web Dashboard 🚀
- Teacher attendance interface
- Admin analytics dashboard
- Real-time WebSocket updates
- Report generation

### Epic 3: Policy Engine
- Open Policy Agent integration
- Custom rule evaluation
- Time-based and event-based policies
- Policy testing and validation

### Epic 4: Integrations
- College ERP integration
- LMS integration
- Email notification system
- API documentation and SDKs

### Epic 5: Deployment & Ops
- Docker containerization
- Kubernetes orchestration
- Monitoring and alerting
- Deployment automation

### Epic 6: Security & Compliance
- Authentication (LDAP/SSO)
- Data encryption
- Access control
- Audit logging

---

## 16. TEAM CONTACTS

### Support Channels

**For Deployment Questions:**
Contact: DevOps Lead  
Topics: Server setup, camera installation, network configuration

**For Technical Architecture Questions:**
Contact: Backend Lead or Video+ML Lead  
Topics: How the system works, API details, integration options

**For Dashboard & Usage Questions:**
Contact: Frontend Lead  
Topics: Dashboard features, report generation, user management

**For Project & Timeline Questions:**
Contact: Project Lead  
Topics: Roadmap, pilot scope, full rollout planning

---

**Last Updated:** March 5, 2026
