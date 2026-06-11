import { PageHeader } from "../../components/PageHeader";
import Card from "../../components/Card";
import Button from "../../components/Button";
import { Camera, X, CheckCircle, Play, StopCircle, Loader2, AlertCircle, ScanFace } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { enrollFaceFromCamera, listEmployees, detectFaceRealtime } from "../../lib/api";

const CAPTURE_INTERVAL = 150; // ms between frames

// The 5 mandatory poses for a complete 3D-like facial template
const POSES = [
  { id: 'center', label: 'Look Straight', prompt: 'Position face in the center', check: (dx, dy) => Math.abs(dx) < 0.12 && Math.abs(dy) < 0.12 },
  { id: 'left', label: 'Turn Left', prompt: 'Move head slightly Left', check: (dx, dy) => dx < -0.12 && Math.abs(dy) < 0.15 },
  { id: 'right', label: 'Turn Right', prompt: 'Move head slightly Right', check: (dx, dy) => dx > 0.12 && Math.abs(dy) < 0.15 },
  { id: 'up', label: 'Look Up', prompt: 'Move head slightly Up', check: (dx, dy) => dy < -0.12 && Math.abs(dx) < 0.15 },
  { id: 'down', label: 'Look Down', prompt: 'Move head slightly Down', check: (dx, dy) => dy > 0.12 && Math.abs(dx) < 0.15 }
];

export default function FaceEnrollment() {
  const [employees, setEmployees] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraMessage, setCameraMessage] = useState("");
  
  const [enrollmentStage, setEnrollmentStage] = useState("idle");
  
  // Guided Capture State
  const [currentPoseIndex, setCurrentPoseIndex] = useState(0);
  const [capturedPoses, setCapturedPoses] = useState({});
  const [consecutiveGood, setConsecutiveGood] = useState(0);
  const REQUIRED_CONSECUTIVE = 3; // Must hold the pose for a few frames
  const [facePrompt, setFacePrompt] = useState("");

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  
  const isCapturingRef = useRef(false);
  const framesRef = useRef([]);
  const currentPoseIndexRef = useRef(0);
  const consecutiveGoodRef = useRef(0);

  // Start camera
  async function startCamera() {
    setEnrollmentStage("loading");
    setCameraMessage("🎥 Initializing camera...");
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" } 
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        await videoRef.current.play();
        
        setCameraActive(true);
        setCameraMessage("");
        setEnrollmentStage('ready');
        resetCaptureState();
      }
    } catch (err) {
      setEnrollmentStage("error");
      setCameraMessage(`❌ Camera access denied. ${err.message}`);
    }
  }

  // Stop camera
  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    isCapturingRef.current = false;
    resetCaptureState();
    setCameraMessage("");
    setEnrollmentStage("idle");
  }

  function resetCaptureState() {
    framesRef.current = [];
    currentPoseIndexRef.current = 0;
    consecutiveGoodRef.current = 0;
    setCurrentPoseIndex(0);
    setCapturedPoses({});
    setConsecutiveGood(0);
    setFacePrompt("");
  }

  // Capture frames automatically with Real AI tracking!
  async function startFrameCapture() {
    if (!selectedEmployeeId) {
      setCameraMessage("⚠️ Please select an employee before capturing");
      return;
    }
    if (!cameraActive) {
      setCameraMessage("⚠️ Please start the camera first");
      return;
    }

    setEnrollmentStage("capturing");
    setCameraMessage("");
    resetCaptureState();
    isCapturingRef.current = true;

    (async function captureLoop() {
      while (isCapturingRef.current && currentPoseIndexRef.current < POSES.length) {
        const canvas = canvasRef.current;
        const video = videoRef.current;
        if (!canvas || !video) {
          await new Promise((r) => setTimeout(r, CAPTURE_INTERVAL));
          continue;
        }

        const pose = POSES[currentPoseIndexRef.current];
        let isPoseValid = false;
        
        // Grab a small frame for fast detection
        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 480;
        
        // Use a smaller canvas specifically for detection to save bandwidth
        const detCanvas = document.createElement('canvas');
        detCanvas.width = 320;
        detCanvas.height = 240;
        const detCtx = detCanvas.getContext('2d');
        detCtx.drawImage(video, 0, 0, 320, 240);
        
        try {
          const blob = await new Promise(res => detCanvas.toBlob(res, "image/jpeg", 0.6));
          if (!blob) throw new Error("Canvas error");
          
          // Ask the highly accurate backend YuNet detector!
          const result = await detectFaceRealtime(blob);
          
          if (!result.faces || result.faces.length === 0) {
            setFacePrompt("Face not detected. Look at the camera.");
            consecutiveGoodRef.current = 0;
            setConsecutiveGood(0);
          } else {
            // Get the primary face
            const bbox = result.faces[0];
            
            // Map the coordinates back to percentages [-0.5, 0.5]
            // detCanvas is 320x240
            const centerX = bbox.x + bbox.width / 2;
            const centerY = bbox.y + bbox.height / 2;
            
            const dx = (centerX - 160) / 320;
            const dy = (centerY - 120) / 240;
            const sizeRatio = bbox.width / 320;

            if (sizeRatio < 0.20) {
              setFacePrompt("Move closer");
              consecutiveGoodRef.current = 0;
              setConsecutiveGood(0);
            } else if (sizeRatio > 0.8) {
              setFacePrompt("Move away");
              consecutiveGoodRef.current = 0;
              setConsecutiveGood(0);
            } else {
              // Check if they are doing the correct pose
              isPoseValid = pose.check(dx, dy);
              if (isPoseValid) {
                setFacePrompt("Good! Hold still...");
                consecutiveGoodRef.current += 1;
                setConsecutiveGood(consecutiveGoodRef.current);
              } else {
                setFacePrompt(pose.prompt);
                consecutiveGoodRef.current = 0;
                setConsecutiveGood(0);
              }
            }
          }
        } catch (err) {
          console.error("Detection ping failed:", err);
          setFacePrompt("Tracking network error... retrying");
          consecutiveGoodRef.current = 0;
        }

        // If they held the pose long enough
        if (isPoseValid && consecutiveGoodRef.current >= REQUIRED_CONSECUTIVE) {
          // Success! Capture a FULL quality frame for the template
          canvas.width = vw;
          canvas.height = vh;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(video, 0, 0, vw, vh);
          const fullBlob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.95));
          
          if (fullBlob) {
            framesRef.current.push(fullBlob);
            setCapturedPoses(prev => ({ ...prev, [pose.id]: true }));
            currentPoseIndexRef.current += 1;
            setCurrentPoseIndex(currentPoseIndexRef.current);
            consecutiveGoodRef.current = 0;
            setConsecutiveGood(0);
            
            if (currentPoseIndexRef.current >= POSES.length) {
              isCapturingRef.current = false;
              setFacePrompt("Perfect! Processing...");
              await processEnrollment(framesRef.current.slice());
              break;
            }
          }
        }

        await new Promise((r) => setTimeout(r, CAPTURE_INTERVAL));
      }
    })();
  }

  // Process enrollment with captured frames
  async function processEnrollment(frames) {
    setEnrollmentStage("processing");
    setCameraLoading(true);

    try {
      const sel = employees.find((e) => e.id === selectedEmployeeId) || {};
      const result = await enrollFaceFromCamera(selectedEmployeeId, sel.name || "", frames);
      setEnrollmentStage("complete");
      setCameraMessage(`✅ Face ID Registration Complete! Successfully mapped ${result.frames_processed} distinct facial angles.`);
      
      setTimeout(() => { stopCamera(); }, 4000);
    } catch (err) {
      setEnrollmentStage("error");
      setCameraMessage(`❌ Enrollment failed: ${err.response?.data?.detail || err.message}`);
    } finally {
      setCameraLoading(false);
    }
  }

  // Cancel frame capture
  function cancelCapture() {
    isCapturingRef.current = false;
    resetCaptureState();
    setEnrollmentStage("ready");
    setCameraMessage("Capture cancelled");
  }

  useEffect(() => {
    let mounted = true;
    listEmployees().then((data) => {
      if (!mounted) return;
      setEmployees(Array.isArray(data) ? data : []);
      if (Array.isArray(data) && data.length > 0) setSelectedEmployeeId(data[0].id);
    }).catch(() => {});

    return () => {
      mounted = false;
      stopCamera();
    };
  }, []);

  // --- SVG Ring Drawing Math ---
  const ringRadius = 140;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const segmentLength = ringCircumference / POSES.length;
  // Gap between segments
  const gap = 8; 
  const dashArray = `${segmentLength - gap} ${gap + ringCircumference - segmentLength}`;

  return (
    <>
      <PageHeader
        title="Face ID Setup"
        subtitle="Secure 3D facial mapping for high-accuracy attendance"
      />

      <div className="max-w-3xl mx-auto px-4 pb-12">
        <Card className="bg-white dark:bg-slate-900 border-none shadow-2xl rounded-3xl overflow-hidden">
          
          <div className="p-8 pb-4 text-center">
            <ScanFace className="w-12 h-12 mx-auto text-purple-600 dark:text-purple-400 mb-4" />
            <h2 className="text-2xl font-extrabold text-gray-900 dark:text-white tracking-tight">How to Set Up Face ID</h2>
            <p className="text-gray-500 dark:text-slate-400 mt-2 max-w-md mx-auto">
              First, position your face in the camera frame. Then slowly move your head following the on-screen prompts to show all angles of your face.
            </p>
          </div>

          <div className="px-8 py-4">
            <select
              value={selectedEmployeeId}
              onChange={(e) => setSelectedEmployeeId(e.target.value)}
              disabled={cameraActive || cameraLoading}
              className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border-2 border-gray-200 dark:border-slate-700 rounded-xl font-medium focus:ring-4 focus:ring-purple-500/20 focus:border-purple-500 transition-all"
            >
              <option value="">-- Select Employee Account --</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>{emp.name || emp.employee_code || emp.id}</option>
              ))}
            </select>
          </div>

          <div className="relative p-8 flex flex-col items-center justify-center min-h-[500px]">
            {/* The Camera Viewport */}
            <div className="relative w-[320px] h-[320px] rounded-full flex items-center justify-center">
              
              {/* Outer Animated SVG Ring */}
              <svg 
                className="absolute inset-0 w-full h-full transform -rotate-90 pointer-events-none z-20" 
                viewBox="0 0 320 320"
              >
                {POSES.map((pose, i) => {
                  const isCaptured = capturedPoses[pose.id];
                  const isActive = currentPoseIndex === i && enrollmentStage === 'capturing';
                  // Calculate rotation for each segment
                  const rotation = (360 / POSES.length) * i;
                  
                  return (
                    <circle
                      key={pose.id}
                      cx="160"
                      cy="160"
                      r={ringRadius}
                      fill="transparent"
                      stroke={isCaptured ? "#22c55e" : isActive ? "#a855f7" : "#e2e8f0"}
                      strokeWidth={isActive ? "10" : "8"}
                      strokeDasharray={dashArray}
                      strokeDashoffset={isActive && consecutiveGood > 0 ? (gap - (segmentLength * (consecutiveGood/REQUIRED_CONSECUTIVE))) : gap}
                      className={`transition-all duration-300 ${isCaptured ? 'opacity-100' : 'opacity-40'} ${isActive && 'animate-pulse'}`}
                      style={{ transformOrigin: 'center', transform: `rotate(${rotation}deg)` }}
                    />
                  );
                })}
              </svg>

              {/* Masked Video Element */}
              <div className="absolute inset-4 rounded-full overflow-hidden bg-gray-900 border-4 border-white dark:border-slate-800 shadow-inner z-10">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${cameraActive ? 'opacity-100' : 'opacity-0'} transition-opacity duration-700`}
                  style={{ transform: 'scaleX(-1)' }} // Mirror mode
                />
                
                {/* Idle Placeholder */}
                {!cameraActive && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-800 text-white">
                    <Camera className="w-12 h-12 opacity-50 mb-2" />
                    <span className="text-sm font-medium opacity-70">Camera Off</span>
                  </div>
                )}
                
                {/* Processing/Success Overlays inside the circle */}
                {enrollmentStage === "processing" && (
                  <div className="absolute inset-0 bg-purple-900/80 backdrop-blur-md flex flex-col items-center justify-center">
                    <Loader2 className="w-12 h-12 text-white animate-spin mb-2" />
                    <span className="text-white font-bold tracking-wider">MAPPING 3D FACE</span>
                  </div>
                )}
                
                {enrollmentStage === "complete" && (
                  <div className="absolute inset-0 bg-green-500/90 backdrop-blur-md flex flex-col items-center justify-center">
                    <CheckCircle className="w-16 h-16 text-white mb-2" />
                    <span className="text-white font-bold text-lg">FACE ID ADDED</span>
                  </div>
                )}
              </div>
            </div>

            {/* Prompts and Instructions */}
            <div className="mt-8 h-16 text-center">
              {enrollmentStage === 'capturing' ? (
                <>
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-white transition-colors">
                    {facePrompt || "Position your face"}
                  </h3>
                  <p className="text-purple-600 dark:text-purple-400 font-medium mt-1">
                    Step {currentPoseIndex + 1} of 5 — {POSES[currentPoseIndex]?.label}
                  </p>
                </>
              ) : enrollmentStage === 'ready' ? (
                <p className="text-lg text-gray-500 dark:text-slate-400 font-medium">
                  Ready. Click "Start Face ID Setup" to begin.
                </p>
              ) : enrollmentStage === 'complete' ? (
                <p className="text-lg text-green-600 dark:text-green-400 font-bold">
                  Registration Successful!
                </p>
              ) : (
                <p className="text-gray-400 dark:text-slate-500 text-sm">
                  Waiting for camera...
                </p>
              )}
            </div>
            
            {/* Action Buttons */}
            <div className="mt-8 w-full max-w-sm space-y-3">
              {!cameraActive ? (
                <Button 
                  className="w-full py-4 text-lg rounded-full shadow-lg shadow-purple-500/30 bg-purple-600 hover:bg-purple-700 text-white font-bold transition-transform hover:scale-[1.02] active:scale-95"
                  onClick={startCamera}
                  disabled={enrollmentStage === "loading"}
                >
                  {enrollmentStage === "loading" ? <Loader2 className="w-6 h-6 animate-spin mr-2" /> : <Play className="w-6 h-6 mr-2" />}
                  Turn On Camera
                </Button>
              ) : (
                <>
                  {enrollmentStage === "ready" && (
                    <Button 
                      className="w-full py-4 text-lg rounded-full shadow-lg shadow-green-500/30 bg-green-500 hover:bg-green-600 text-white font-bold transition-transform hover:scale-[1.02] active:scale-95"
                      onClick={startFrameCapture}
                      disabled={!selectedEmployeeId}
                    >
                      <ScanFace className="w-6 h-6 mr-2" />
                      Start Face ID Setup
                    </Button>
                  )}
                  
                  {(enrollmentStage === "ready" || isCapturingRef.current) && (
                    <Button 
                      variant="secondary"
                      className="w-full py-3 rounded-full font-semibold border-2"
                      onClick={isCapturingRef.current ? cancelCapture : stopCamera}
                    >
                      {isCapturingRef.current ? "Cancel Setup" : "Turn Off Camera"}
                    </Button>
                  )}
                </>
              )}
            </div>

            {/* Status Message Footer */}
            {cameraMessage && (
              <div className="mt-6 text-center max-w-sm">
                <p className={`text-sm font-medium ${cameraMessage.startsWith('❌') ? 'text-red-500' : 'text-slate-500'}`}>
                  {cameraMessage}
                </p>
              </div>
            )}
          </div>
        </Card>
      </div>
      
      {/* Hidden canvas for capture buffer */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </>
  );
}
