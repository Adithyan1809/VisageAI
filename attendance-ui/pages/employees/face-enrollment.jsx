import { PageHeader } from "../../components/PageHeader";
import Card from "../../components/Card";
import Button from "../../components/Button";
import { Camera, X, CheckCircle, Play, Loader2, ScanFace, User } from "lucide-react";
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

  const videoRef     = useRef(null);
  const canvasRef    = useRef(null);
  const streamRef    = useRef(null);
  const framesRef    = useRef([]);
  const loopRef      = useRef(null);   // interval id for detect loop
  const countRef     = useRef(COUNTDOWN_START);
  const activeRef    = useRef(false);

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

  // ── Detection + auto-capture loop ─────────────────────────────────────────
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
          const f = res.faces[0];
          const sizeRatio = f.width / 320;
          if (sizeRatio >= 0.05 && sizeRatio <= 0.95) {
            detected = true;
          } else {
            faceStatus = sizeRatio < 0.05 ? "Face too far — move closer" : "Face too close — move back";
          }
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
              // All frames collected — stop the loop and process
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
  const isRunning  = ["detecting", "countdown", "capturing"].includes(stage);
  const cameraOn   = stage !== "idle" && stage !== "loading" && stage !== "error";
  const ringColor  = stage === "complete" ? "#22c55e"
                   : faceDetected         ? "#a855f7"
                   : "#475569";
  const ringBg     = stage === "complete" ? "#dcfce7"
                   : faceDetected         ? "#f3e8ff"
                   : "#1e293b";

  // Progress ring maths (SVG)
  const R   = 130;
  const C   = 2 * Math.PI * R;
  const strokeDash = `${(progressPct / 100) * C} ${C}`;

  return (
    <>
      <PageHeader
        title="Face ID Setup"
        subtitle="Secure facial registration for high-accuracy attendance"
      />

      <div className="max-w-2xl mx-auto px-4 pb-12">
        <Card className="bg-white dark:bg-slate-900 border-none shadow-2xl rounded-3xl overflow-hidden">

          {/* Header */}
          <div className="p-8 pb-4 text-center">
            <ScanFace className="w-12 h-12 mx-auto text-purple-600 dark:text-purple-400 mb-4" />
            <h2 className="text-2xl font-extrabold text-gray-900 dark:text-white">Face ID Setup</h2>
            <p className="text-gray-500 dark:text-slate-400 mt-2 max-w-sm mx-auto text-sm">
              Look straight at the camera. The system will automatically capture {TOTAL_FRAMES} frames to build your facial signature.
            </p>
          </div>

          {/* Employee picker */}
          <div className="px-8 py-4">
            <label className="block text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">
              Select Employee
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <select
                value={selectedEmployeeId}
                onChange={e => setSelected(e.target.value)}
                disabled={isRunning || stage === "processing"}
                className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-slate-800 border-2 border-gray-200 dark:border-slate-700 rounded-xl font-medium focus:ring-4 focus:ring-purple-500/20 focus:border-purple-500 transition-all"
              >
                <option value="">-- Select Employee --</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name || emp.employee_code || emp.id}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Camera + Ring */}
          <div className="relative p-8 flex flex-col items-center justify-center">

            {/* Progress ring + video */}
            <div className="relative w-[300px] h-[300px]">

              {/* SVG progress ring */}
              <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none z-20" viewBox="0 0 300 300">
                {/* Track */}
                <circle cx="150" cy="150" r={R} fill="none" stroke="#e2e8f0" strokeWidth="8" className="dark:opacity-20" />
                {/* Progress */}
                <circle
                  cx="150" cy="150" r={R}
                  fill="none"
                  stroke={ringColor}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={strokeDash}
                  strokeDashoffset="0"
                  className="transition-all duration-300"
                />
              </svg>

              {/* Countdown badge */}
              {stage === "countdown" && faceDetected && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 bg-purple-600 text-white rounded-full w-10 h-10 flex items-center justify-center font-black text-lg shadow-lg animate-pulse">
                  {countdown}
                </div>
              )}

              {/* Circular video */}
              <div
                className="absolute inset-3 rounded-full overflow-hidden shadow-inner z-10 transition-all duration-500"
                style={{ background: ringBg, border: `4px solid ${ringColor}` }}
              >
                <video
                  ref={videoRef}
                  autoPlay playsInline muted
                  className={`w-full h-full object-cover transition-opacity duration-500 ${cameraOn ? "opacity-100" : "opacity-0"}`}
                  style={{ transform: "scaleX(-1)" }}
                />

                {/* Idle placeholder */}
                {!cameraOn && stage !== "processing" && stage !== "complete" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                    <Camera className="w-12 h-12 mb-2 opacity-40" />
                    <span className="text-sm font-medium opacity-60">Camera off</span>
                  </div>
                )}

                {/* Processing overlay */}
                {stage === "processing" && (
                  <div className="absolute inset-0 bg-purple-900/85 backdrop-blur-md flex flex-col items-center justify-center">
                    <Loader2 className="w-12 h-12 text-white animate-spin mb-2" />
                    <span className="text-white font-bold text-sm tracking-widest">PROCESSING</span>
                  </div>
                )}

                {/* Success overlay */}
                {stage === "complete" && (
                  <div className="absolute inset-0 bg-green-500/90 backdrop-blur-md flex flex-col items-center justify-center">
                    <CheckCircle className="w-16 h-16 text-white mb-2" />
                    <span className="text-white font-black text-base">REGISTERED</span>
                  </div>
                )}
              </div>
            </div>

            {/* Frame counter dots */}
            {isRunning && (
              <div className="flex gap-2 mt-6">
                {Array.from({ length: TOTAL_FRAMES }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-3 h-3 rounded-full transition-all duration-300 ${
                      i < capturedCount ? "bg-purple-500 scale-110" : "bg-gray-300 dark:bg-slate-600"
                    }`}
                  />
                ))}
              </div>
            )}

            {/* Status message */}
            <div className="mt-5 h-14 text-center flex flex-col items-center justify-center">
              {stage === "ready" && (
                <p className="text-gray-500 dark:text-slate-400 font-medium">
                  Ready. Press <strong>Start Face ID</strong> to begin.
                </p>
              )}
              {isRunning && (
                <>
                  <p className={`text-base font-bold transition-colors ${faceDetected ? "text-purple-600 dark:text-purple-400" : "text-gray-400"}`}>
                    {faceDetected ? "✅ Face detected" : "👀 No face — look at the camera"}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">{statusMsg}</p>
                </>
              )}
              {(stage === "complete" || stage === "error") && (
                <p className={`text-sm font-semibold ${stage === "complete" ? "text-green-600" : "text-red-500"}`}>
                  {statusMsg}
                </p>
              )}
              {stage === "idle" && statusMsg && (
                <p className="text-sm text-gray-500">{statusMsg}</p>
              )}
            </div>

            {/* Buttons */}
            <div className="mt-6 w-full max-w-xs space-y-3">
              {stage === "idle" && (
                <Button
                  className="w-full py-4 text-base rounded-full bg-purple-600 hover:bg-purple-700 text-white font-bold shadow-lg shadow-purple-500/30 transition-transform hover:scale-[1.02] active:scale-95"
                  onClick={startCamera}
                >
                  <Play className="w-5 h-5 mr-2" /> Turn On Camera
                </Button>
              )}

              {stage === "loading" && (
                <Button className="w-full py-4 text-base rounded-full bg-purple-400 text-white font-bold" disabled>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Initialising…
                </Button>
              )}

              {stage === "ready" && (
                <>
                  <Button
                    className="w-full py-4 text-base rounded-full bg-green-500 hover:bg-green-600 text-white font-bold shadow-lg shadow-green-500/30 transition-transform hover:scale-[1.02] active:scale-95"
                    onClick={startEnrollment}
                    disabled={!selectedEmployeeId}
                  >
                    <ScanFace className="w-5 h-5 mr-2" /> Start Face ID
                  </Button>
                  <Button
                    variant="secondary"
                    className="w-full py-3 rounded-full font-semibold border-2"
                    onClick={stopCamera}
                  >
                    Turn Off Camera
                  </Button>
                </>
              )}

              {isRunning && (
                <Button
                  variant="secondary"
                  className="w-full py-3 rounded-full font-semibold border-2 border-red-300 text-red-500 hover:bg-red-50"
                  onClick={cancelEnrollment}
                >
                  <X className="w-4 h-4 mr-2" /> Cancel
                </Button>
              )}

              {(stage === "complete" || stage === "error") && (
                <Button
                  className="w-full py-4 text-base rounded-full bg-purple-600 hover:bg-purple-700 text-white font-bold"
                  onClick={stopCamera}
                >
                  {stage === "complete" ? "Done" : "Try Again"}
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>

      <canvas ref={canvasRef} style={{ display: "none" }} />
    </>
  );
}
