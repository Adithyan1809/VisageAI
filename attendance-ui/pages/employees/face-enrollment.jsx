import { PageHeader } from "../../components/PageHeader";
import Card from "../../components/Card";
import Button from "../../components/Button";
import { Camera, X, CheckCircle, Play, Loader2, ScanFace, User, Users } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useEffect, useCallback } from "react";
import { enrollFaceFromCamera, listEmployees, detectFaceRealtime } from "../../lib/api";

// ─── Config ───────────────────────────────────────────────────────────────────
const DETECT_INTERVAL_MS = 200;   // how often we ping the backend detector
const TOTAL_FRAMES = 5;           // frames to capture for enrollment
const COUNTDOWN_START = 3;        // seconds of face-detected countdown before capture

export default function FaceEnrollment() {
  const [employees, setEmployees]           = useState([]);
  const [selectedEmployeeId, setSelected]   = useState("");
  const [stage, setStage]                   = useState("idle");
  // idle | loading | ready | detecting | countdown | capturing | processing | complete | error

  const [faceDetected, setFaceDetected]     = useState(false);
  const [countdown, setCountdown]           = useState(COUNTDOWN_START);
  const [capturedCount, setCapturedCount]   = useState(0);
  const [statusMsg, setStatusMsg]           = useState("");
  const [progressPct, setProgressPct]       = useState(0);
  // ROI: all faces detected in the latest tick
  const [detectedFaces, setDetectedFaces]   = useState([]);

  const videoRef        = useRef(null);
  const canvasRef       = useRef(null);
  const overlayCanvasRef = useRef(null);  // ROI overlay drawn on top of video
  const streamRef       = useRef(null);
  const framesRef       = useRef([]);
  const loopRef         = useRef(null);   // interval id for detect loop
  const countRef        = useRef(COUNTDOWN_START);
  const activeRef       = useRef(false);
  const facesRef        = useRef([]);     // latest faces for overlay animation frame

  // ── Camera ──────────────────────────────────────────────────────────────────
  async function startCamera() {
    setStage("loading");
    setStatusMsg("Initialising camera…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      });
      videoRef.current.srcObject = stream;
      streamRef.current = stream;
      await videoRef.current.play();
      setStage("ready");
      setStatusMsg("");
    } catch (err) {
      setStage("error");
      setStatusMsg(`❌ Camera access denied: ${err.message}`);
    }
  }

  function stopCamera() {
    clearTimeout(loopRef.current);
    activeRef.current = false;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    framesRef.current = [];
    countRef.current  = COUNTDOWN_START;
    setStage("idle");
    setFaceDetected(false);
    setCountdown(COUNTDOWN_START);
    setCapturedCount(0);
    setProgressPct(0);
    setStatusMsg("");
    setDetectedFaces([]);
  }

  // ── Capture one full-res JPEG blob ─────────────────────────────────────────
  function captureFrame() {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d").drawImage(video, 0, 0);
    return new Promise(res => canvas.toBlob(res, "image/jpeg", 0.92));
  }

  // ── ROI overlay — draw face boxes on the overlay canvas ───────────────────
  // Called whenever detectedFaces changes so the canvas stays in sync with
  // the video element dimensions (which may differ from the capture canvas).
  useEffect(() => {
    const oc = overlayCanvasRef.current;
    const video = videoRef.current;
    if (!oc || !video) return;

    const vw = video.videoWidth  || 640;
    const vh = video.videoHeight || 480;
    oc.width  = vw;
    oc.height = vh;
    const ctx = oc.getContext("2d");
    ctx.clearRect(0, 0, vw, vh);

    // The video is mirrored (scaleX(-1)), so we mirror x coords too
    detectedFaces.forEach(face => {
      // Mirror x-axis: mirrored_x = videoWidth - (x + width)
      const mx = vw - (face.x + face.width);
      const { y, width, height, is_nearest } = face;

      if (is_nearest) {
        // Bright cyan solid box for nearest person
        ctx.strokeStyle = "#06b6d4";
        ctx.lineWidth   = 3;
        ctx.setLineDash([]);
        ctx.shadowColor = "#06b6d4";
        ctx.shadowBlur  = 12;
        ctx.strokeRect(mx, y, width, height);
        ctx.shadowBlur = 0;

        // Label
        ctx.fillStyle = "rgba(6, 182, 212, 0.85)";
        const label = "NEAREST";
        ctx.font = `bold ${Math.max(11, Math.round(width * 0.12))}px monospace`;
        const tw = ctx.measureText(label).width;
        const lh = Math.max(11, Math.round(width * 0.12)) + 6;
        ctx.fillRect(mx, y - lh, tw + 8, lh);
        ctx.fillStyle = "#000";
        ctx.fillText(label, mx + 4, y - 4);
      } else {
        // Dim gray dashed box for secondary faces
        ctx.strokeStyle = "rgba(148, 163, 184, 0.6)";
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.shadowBlur  = 0;
        ctx.strokeRect(mx, y, width, height);
        ctx.setLineDash([]);

        // Label
        ctx.fillStyle = "rgba(148, 163, 184, 0.7)";
        const label = "BYSTANDER";
        ctx.font = `${Math.max(10, Math.round(width * 0.10))}px monospace`;
        ctx.fillText(label, mx + 4, y - 4);
      }
    });
  }, [detectedFaces]);

  // Uses a sequential detect→wait→detect pattern (recursive setTimeout) so
  // only ONE detection request is in-flight at a time. The old setInterval
  // approach fired overlapping async callbacks that corrupted the countdown.
  async function startEnrollment() {
    if (!selectedEmployeeId) { setStatusMsg("⚠️ Select an employee first."); return; }
    framesRef.current = [];
    countRef.current  = COUNTDOWN_START;
    activeRef.current = true;
    setStage("detecting");
    setFaceDetected(false);
    setCountdown(COUNTDOWN_START);
    setCapturedCount(0);
    setProgressPct(0);
    setDetectedFaces([]);
    setStatusMsg("Position your face in the circle.");

    // Track elapsed real time between ticks for accurate countdown
    let lastTickTime = Date.now();

    async function detectTick() {
      if (!activeRef.current) return;               // enrollment was cancelled

      // ── Grab a small frame for fast detection ────────────────────────────
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        loopRef.current = setTimeout(detectTick, DETECT_INTERVAL_MS);
        return;
      }

      const det = document.createElement("canvas");
      det.width = 320; det.height = 240;
      det.getContext("2d").drawImage(video, 0, 0, 320, 240);
      const blob = await new Promise(r => det.toBlob(r, "image/jpeg", 0.6));
      if (!blob || !activeRef.current) return;

      let detected = false;
      let faceStatus = "";

      try {
        const res = await detectFaceRealtime(blob);
        if (res.faces && res.faces.length > 0) {
          // ── ROI: find the nearest face (is_nearest flag from backend) ──────
          const nearest = res.faces.find(f => f.is_nearest) || res.faces[0];

          // Scale bboxes from detection resolution (320×240) to video resolution
          const scaleX = (video.videoWidth  || 640) / 320;
          const scaleY = (video.videoHeight || 480) / 240;
          const scaledFaces = res.faces.map(f => ({
            ...f,
            x: Math.round(f.x * scaleX),
            y: Math.round(f.y * scaleY),
            width:  Math.round(f.width  * scaleX),
            height: Math.round(f.height * scaleY),
          }));
          setDetectedFaces(scaledFaces);

          // Use nearest face for proximity check
          const sizeRatio = nearest.width / 320;
          if (sizeRatio >= 0.05 && sizeRatio <= 0.95) {
            detected = true;
          } else {
            faceStatus = sizeRatio < 0.05 ? "Face too far — move closer" : "Face too close — move back";
          }
        } else {
          setDetectedFaces([]);
        }
      } catch { /* network blip — ignore */ }

      if (!activeRef.current) return;                // check again after await

      setFaceDetected(detected);

      if (!detected) {
        // Reset countdown if face lost
        countRef.current = COUNTDOWN_START;
        setCountdown(COUNTDOWN_START);
        lastTickTime = Date.now();                   // reset timer baseline
        if (framesRef.current.length === 0) {
          setStatusMsg(faceStatus || "Position your face in the circle.");
        }
        loopRef.current = setTimeout(detectTick, DETECT_INTERVAL_MS);
        return;
      }
      // Face found — count down using real elapsed time (not a fixed decrement)
      if (framesRef.current.length < TOTAL_FRAMES) {
        const now = Date.now();
        const elapsed = (now - lastTickTime) / 1000;  // actual seconds elapsed
        lastTickTime = now;

        const newCount = countRef.current - elapsed;
        countRef.current = newCount;
        setCountdown(Math.ceil(Math.max(0, newCount)));
        setStage("countdown");
        setStatusMsg(`Hold still — capturing in ${Math.ceil(Math.max(1, newCount))}s…`);

        if (newCount <= 0) {
          // Capture a frame
          countRef.current = COUNTDOWN_START;        // reset for next frame
          lastTickTime = Date.now();
          setStage("capturing");
          const full = await captureFrame();
          if (full && activeRef.current) {
            framesRef.current.push(full);
            const n = framesRef.current.length;
            setCapturedCount(n);
            setProgressPct(Math.round((n / TOTAL_FRAMES) * 100));
            setStatusMsg(`Captured ${n} / ${TOTAL_FRAMES} — ${n < TOTAL_FRAMES ? "keep looking at camera" : "processing…"}`);
            setStage("detecting");

            if (n >= TOTAL_FRAMES) {
              // All frames collected — clear overlay and process
              setDetectedFaces([]);
              activeRef.current = false;
              await processEnrollment(framesRef.current.slice());
              return;                                // don't schedule another tick
            }
          }
        }
      }

      // Schedule next tick only after current one fully completes
      loopRef.current = setTimeout(detectTick, DETECT_INTERVAL_MS);
    }

    // Kick off the first tick
    loopRef.current = setTimeout(detectTick, DETECT_INTERVAL_MS);
  }

  function cancelEnrollment() {
    clearTimeout(loopRef.current);
    activeRef.current = false;
    framesRef.current = [];
    countRef.current  = COUNTDOWN_START;
    setStage("ready");
    setFaceDetected(false);
    setCountdown(COUNTDOWN_START);
    setCapturedCount(0);
    setProgressPct(0);
    setDetectedFaces([]);
    setStatusMsg("Cancelled. Press Start to try again.");
  }

  // ── Submit frames to backend ───────────────────────────────────────────────
  async function processEnrollment(frames) {
    setStage("processing");
    setStatusMsg("Mapping your facial signature…");
    try {
      const emp    = employees.find(e => e.id === selectedEmployeeId) || {};
      const result = await enrollFaceFromCamera(selectedEmployeeId, emp.name || "", frames);
      setStage("complete");
      setStatusMsg(`✅ Face ID registered! ${result.templates_saved || result.frames_processed} templates saved.`);
      setTimeout(() => stopCamera(), 5000);
    } catch (err) {
      setStage("error");
      setStatusMsg(`❌ Enrollment failed: ${err.response?.data?.detail || err.message}`);
    }
  }

  // ── Employees list ─────────────────────────────────────────────────────────
  useEffect(() => {
    listEmployees()
      .then(data => {
        const list = Array.isArray(data) ? data : [];
        setEmployees(list);
        if (list.length > 0) setSelected(list[0].id);
      })
      .catch(() => {});
    return () => stopCamera();
  }, []);

  // ── Derived UI values ──────────────────────────────────────────────────────
  const isRunning      = ["detecting", "countdown", "capturing"].includes(stage);
  const cameraOn       = stage !== "idle" && stage !== "loading" && stage !== "error";
  const multiPerson    = detectedFaces.length > 1;
  const ringColor      = stage === "complete" ? "#22c55e"
                       : faceDetected         ? "#a855f7"
                       : "#475569";
  const ringBg         = stage === "complete" ? "#dcfce7"
                       : faceDetected         ? "#f3e8ff"
                       : "#1e293b";

  // Progress ring maths (SVG)
  const R   = 130;
  const C   = 2 * Math.PI * R;
  const strokeDash = `${(progressPct / 100) * C} ${C}`;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-[1600px] mx-auto space-y-8"
    >
      <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">Biometric Setup</h2>
          <p className="text-muted mt-1">Secure facial registration for high-accuracy attendance.</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pb-12 mt-8">
        <Card className="!p-0 border-none overflow-hidden relative">
          {/* Subtle animated background for the card */}
          <div className="absolute top-[-50%] left-[-50%] w-[200%] h-[200%] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-brand-blue/5 via-transparent to-transparent animate-spin-slow pointer-events-none" />

          {/* Header */}
          <div className="p-8 pb-4 text-center relative z-10 border-b border-glass-border">
            <div className="w-16 h-16 mx-auto bg-brand-blue/10 rounded-2xl flex items-center justify-center mb-6 shadow-glow-brand">
              <ScanFace className="w-8 h-8 text-brand-cyan" />
            </div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Identity Enrollment</h2>
            <p className="text-muted mt-2 max-w-sm mx-auto text-sm">
              Center your face in the HUD. The system will auto-capture {TOTAL_FRAMES} distinct signatures.
            </p>
          </div>

          {/* Employee picker */}
          <div className="px-8 py-6 border-b border-glass-border relative z-10 bg-black/20">
            <label className="block text-xs font-semibold text-brand-cyan uppercase tracking-wider mb-3">
              Target Profile
            </label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted pointer-events-none" />
              <select
                value={selectedEmployeeId}
                onChange={e => setSelected(e.target.value)}
                disabled={isRunning || stage === "processing"}
                className="w-full pl-12 pr-4 py-3.5 bg-glass-card border border-glass-border rounded-xl text-white font-medium focus:ring-2 focus:ring-brand-blue outline-none transition-all appearance-none"
              >
                <option value="">-- Select Employee --</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name || emp.employee_code || emp.id}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Camera + Ring */}
          <div className="relative p-10 flex flex-col items-center justify-center bg-black/40 z-10">

            {/* Progress ring + video */}
            <div className="relative w-[340px] h-[340px]">

              {/* High-tech HUD Brackets */}
              {cameraOn && (
                <>
                  <div className={`absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 ${faceDetected ? 'border-brand-cyan' : 'border-muted'} rounded-tl-xl transition-colors duration-300`} />
                  <div className={`absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 ${faceDetected ? 'border-brand-cyan' : 'border-muted'} rounded-tr-xl transition-colors duration-300`} />
                  <div className={`absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 ${faceDetected ? 'border-brand-cyan' : 'border-muted'} rounded-bl-xl transition-colors duration-300`} />
                  <div className={`absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 ${faceDetected ? 'border-brand-cyan' : 'border-muted'} rounded-br-xl transition-colors duration-300`} />
                </>
              )}

              {/* Scanning Laser */}
              {isRunning && faceDetected && stage !== 'countdown' && (
                <div className="absolute inset-x-8 top-1/2 h-[1px] bg-brand-cyan shadow-[0_0_15px_rgba(6,182,212,1)] animate-scanline z-30 pointer-events-none" />
              )}

              {/* SVG progress ring */}
              <svg className="absolute inset-2 w-[calc(100%-16px)] h-[calc(100%-16px)] -rotate-90 pointer-events-none z-20" viewBox="0 0 300 300">
                <circle cx="150" cy="150" r={R} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="4" />
                <circle
                  cx="150" cy="150" r={R}
                  fill="none"
                  stroke={ringColor === '#a855f7' ? '#06b6d4' : ringColor}
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={strokeDash}
                  strokeDashoffset="0"
                  className="transition-all duration-300 shadow-[0_0_10px_currentColor]"
                />
              </svg>

              {/* Countdown badge */}
              <AnimatePresence>
                {stage === "countdown" && faceDetected && (
                  <motion.div 
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    className="absolute top-6 left-1/2 -translate-x-1/2 z-40 bg-brand-cyan text-black rounded-full w-12 h-12 flex items-center justify-center font-black text-xl shadow-[0_0_20px_rgba(6,182,212,0.8)]"
                  >
                    {countdown}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Circular video + ROI overlay */}
              <div
                className="absolute inset-8 rounded-full overflow-hidden z-10 transition-all duration-500 shadow-2xl bg-black"
                style={{ border: `2px solid ${ringColor === '#a855f7' ? '#06b6d4' : ringColor}` }}
              >
                <video
                  ref={videoRef}
                  autoPlay playsInline muted
                  className={`w-full h-full object-cover transition-opacity duration-500 ${cameraOn ? "opacity-100" : "opacity-0"}`}
                  style={{ transform: "scaleX(-1)" }}
                />

                {/* ROI overlay canvas — same dimensions as video, drawn on top */}
                {isRunning && (
                  <canvas
                    ref={overlayCanvasRef}
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    style={{ transform: "scaleX(-1)" }}
                  />
                )}

                {/* Idle placeholder */}
                {!cameraOn && stage !== "processing" && stage !== "complete" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-muted bg-glass-card backdrop-blur-sm">
                    <Camera className="w-12 h-12 mb-3 opacity-40" />
                    <span className="text-sm font-semibold tracking-wider">SENSOR OFFLINE</span>
                  </div>
                )}

                {/* Processing overlay */}
                {stage === "processing" && (
                  <div className="absolute inset-0 bg-brand-blue/80 backdrop-blur-xl flex flex-col items-center justify-center">
                    <Loader2 className="w-12 h-12 text-white animate-spin mb-3" />
                    <span className="text-white font-bold text-xs tracking-[0.2em]">ANALYZING...</span>
                  </div>
                )}

                {/* Success overlay */}
                {stage === "complete" && (
                  <div className="absolute inset-0 bg-success/80 backdrop-blur-xl flex flex-col items-center justify-center">
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring" }}>
                      <CheckCircle className="w-16 h-16 text-white mb-3" />
                    </motion.div>
                    <span className="text-white font-black text-sm tracking-[0.2em]">ENROLLED</span>
                  </div>
                )}
              </div>
            </div>

            {/* Frame counter dots */}
            {isRunning && (
              <div className="flex gap-3 mt-8">
                {Array.from({ length: TOTAL_FRAMES }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-2 h-2 rounded-full transition-all duration-300 ${
                      i < capturedCount ? "bg-brand-cyan shadow-[0_0_10px_rgba(6,182,212,1)] scale-150" : "bg-white/20"
                    }`}
                  />
                ))}
              </div>
            )}

            {/* ── Multi-person ROI warning banner ── */}
            <AnimatePresence>
              {isRunning && multiPerson && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="mt-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-400 text-xs font-semibold backdrop-blur-sm"
                >
                  <Users className="w-4 h-4 flex-shrink-0 animate-pulse" />
                  <span>
                    Multiple people detected — enrolling <span className="text-amber-300 font-bold">nearest person</span> only
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Status message */}
            <div className="mt-8 h-16 text-center flex flex-col items-center justify-center">
              {stage === "ready" && (
                <p className="text-muted font-medium text-lg">
                  System ready. Initiate scan sequence.
                </p>
              )}
              {isRunning && (
                <>
                  <p className={`text-lg font-bold transition-colors ${faceDetected ? "text-brand-cyan shadow-glow-brand" : "text-danger"}`}>
                    {faceDetected ? "TARGET LOCKED" : "AWAITING TARGET"}
                  </p>
                  <p className="text-sm text-muted mt-2 font-mono">{statusMsg}</p>
                </>
              )}
              {(stage === "complete" || stage === "error") && (
                <p className={`text-base font-bold ${stage === "complete" ? "text-success" : "text-danger"}`}>
                  {statusMsg}
                </p>
              )}
              {stage === "idle" && statusMsg && (
                <p className="text-sm text-muted font-mono">{statusMsg}</p>
              )}
            </div>

            {/* Buttons */}
            <div className="mt-8 w-full max-w-sm space-y-4">
              {stage === "idle" && (
                <Button
                  className="w-full py-4 text-base rounded-xl bg-brand-blue hover:bg-blue-500 text-white font-bold shadow-glow-brand"
                  onClick={startCamera}
                >
                  <Play className="w-5 h-5 mr-2" /> Initialise Sensor
                </Button>
              )}

              {stage === "loading" && (
                <Button className="w-full py-4 text-base rounded-xl bg-brand-blue/50 text-white font-bold cursor-not-allowed">
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Booting...
                </Button>
              )}

              {stage === "ready" && (
                <>
                  <Button
                    className="w-full py-4 text-base rounded-xl bg-success hover:bg-green-500 text-white font-bold shadow-glow-success"
                    onClick={startEnrollment}
                    disabled={!selectedEmployeeId}
                  >
                    <ScanFace className="w-5 h-5 mr-2" /> Start Scan Sequence
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full py-3 rounded-xl font-semibold text-muted hover:text-white hover:bg-white/5"
                    onClick={stopCamera}
                  >
                    Power Down
                  </Button>
                </>
              )}

              {isRunning && (
                <Button
                  variant="danger"
                  className="w-full py-4 rounded-xl font-bold shadow-glow-danger"
                  onClick={cancelEnrollment}
                >
                  <X className="w-5 h-5 mr-2" /> Abort Sequence
                </Button>
              )}

              {(stage === "complete" || stage === "error") && (
                <Button
                  className="w-full py-4 text-base rounded-xl bg-brand-blue hover:bg-blue-500 text-white font-bold shadow-glow-brand"
                  onClick={stopCamera}
                >
                  {stage === "complete" ? "Return to Base" : "Retry Sequence"}
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>

      <canvas ref={canvasRef} style={{ display: "none" }} />
    </motion.div>
  );
}
