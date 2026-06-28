import { useState, useEffect, useRef, useCallback } from "react";
import Card from "../components/Card";
import Button from "../components/Button";
import {
  Plus, Settings, Video, Trash2, Edit, WifiOff, X,
  Wifi, Loader2, CheckCircle, AlertTriangle, Eye, EyeOff,
  Signal, MapPin, Server, ChevronRight, LinkIcon, Camera
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  listCameras, addCamera, updateCamera, deleteCamera,
  listZones, listNvr, testRtspConnection
} from "../lib/api";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";

// ── Constants ────────────────────────────────────────────────────────────────
const CAMERA_TYPES = ["IP Camera", "PTZ Camera", "Dome Camera", "Bullet Camera", "Fisheye Camera"];

const EMPTY_FORM = {
  name: "",
  ip_address: "",
  rtsp_url: "",
  camera_type: "IP Camera",
  status: "active",
  zone_id: "",
  nvr_dvr_id: "",
  username: "admin",
  password: "",
};

// ── Camera Form Drawer ────────────────────────────────────────────────────────
function CameraDrawer({ open, onClose, onSaved, editCamera, zones, nvrs }) {
  const [form, setForm]             = useState(EMPTY_FORM);
  const [showPass, setShowPass]     = useState(false);
  const [saving, setSaving]         = useState(false);
  const [testing, setTesting]       = useState(false);
  const [testResult, setTestResult] = useState(null);  // null | {ok,message,resolution?,fps?}

  // populate form when editing
  useEffect(() => {
    if (open) {
      setForm(editCamera
        ? { ...EMPTY_FORM, ...editCamera }
        : EMPTY_FORM
      );
      setTestResult(null);
    }
  }, [open, editCamera]);

  // auto-build RTSP from ip + username + password when fields change
  function handleIpChange(e) {
    const ip = e.target.value;
    setForm(f => ({
      ...f,
      ip_address: ip,
      rtsp_url: f.rtsp_url || buildRtsp(ip, f.username, f.password),
    }));
  }

  function buildRtsp(ip, user, pass) {
    if (!ip) return "";
    const auth = user ? (pass ? `${user}:${pass}@` : `${user}@`) : "";
    return `rtsp://${auth}${ip}:554/stream1`;
  }

  function set(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function handleTest() {
    if (!form.rtsp_url) { toast.error("Enter an RTSP URL first"); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testRtspConnection(form.rtsp_url);
      setTestResult(result);
      if (result.ok) toast.success(`Stream OK — ${result.resolution}`);
      else toast.error("Connection failed");
    } catch {
      setTestResult({ ok: false, message: "Request timed out or backend unreachable." });
    } finally {
      setTesting(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name) { toast.error("Camera name is required"); return; }
    setSaving(true);
    try {
      if (editCamera?.id) {
        await updateCamera(editCamera.id, form);
        toast.success(`Camera "${form.name}" updated`);
      } else {
        await addCamera(form);
        toast.success(`Camera "${form.name}" added`);
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error("Save failed: " + (err?.response?.data?.detail || err.message));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
            className="fixed right-0 top-0 h-full w-full max-w-lg z-50 flex flex-col bg-[#0d1117] border-l border-white/10 shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/10 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-brand-blue/15 flex items-center justify-center">
                  <Camera className="w-5 h-5 text-brand-cyan" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">
                    {editCamera ? "Edit Camera" : "Add IP Camera"}
                  </h2>
                  <p className="text-xs text-slate-400">
                    {editCamera ? `Editing: ${editCamera.name}` : "Connect a new RTSP camera"}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-white hover:bg-white/10 p-2 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form body */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-6 space-y-6">

              {/* Basic Info */}
              <section>
                <label className="block text-xs font-semibold text-brand-cyan uppercase tracking-wider mb-3">
                  Basic Info
                </label>
                <div className="space-y-3">
                  <div>
                    <label className="text-sm text-slate-400 mb-1 block">Camera Name *</label>
                    <input
                      id="cam-name"
                      value={form.name}
                      onChange={set("name")}
                      placeholder="e.g. Gate A — Main Entrance"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan/40 transition-all"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm text-slate-400 mb-1 block">Camera Type</label>
                      <select
                        id="cam-type"
                        value={form.camera_type}
                        onChange={set("camera_type")}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-brand-cyan transition-all appearance-none"
                      >
                        {CAMERA_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-sm text-slate-400 mb-1 block">Status</label>
                      <select
                        id="cam-status"
                        value={form.status}
                        onChange={set("status")}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-brand-cyan transition-all appearance-none"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="maintenance">Maintenance</option>
                      </select>
                    </div>
                  </div>
                </div>
              </section>

              {/* Network */}
              <section>
                <label className="block text-xs font-semibold text-brand-cyan uppercase tracking-wider mb-3">
                  Network
                </label>
                <div className="space-y-3">
                  <div>
                    <label className="text-sm text-slate-400 mb-1 block">Camera IP Address</label>
                    <input
                      id="cam-ip"
                      value={form.ip_address}
                      onChange={handleIpChange}
                      placeholder="192.168.1.64"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white font-mono placeholder-slate-500 focus:outline-none focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan/40 transition-all"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm text-slate-400 mb-1 block">Username</label>
                      <input
                        id="cam-user"
                        value={form.username}
                        onChange={set("username")}
                        placeholder="admin"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white font-mono placeholder-slate-500 focus:outline-none focus:border-brand-cyan transition-all"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-slate-400 mb-1 block">Password</label>
                      <div className="relative">
                        <input
                          id="cam-pass"
                          type={showPass ? "text" : "password"}
                          value={form.password}
                          onChange={set("password")}
                          placeholder="••••••••"
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-11 text-white font-mono placeholder-slate-500 focus:outline-none focus:border-brand-cyan transition-all"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPass(v => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                        >
                          {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* RTSP URL */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-sm text-slate-400">RTSP Stream URL</label>
                      <button
                        type="button"
                        onClick={() => setForm(f => ({ ...f, rtsp_url: buildRtsp(f.ip_address, f.username, f.password) }))}
                        className="text-xs text-brand-cyan hover:underline"
                      >
                        Auto-fill
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <input
                        id="cam-rtsp"
                        value={form.rtsp_url}
                        onChange={set("rtsp_url")}
                        placeholder="rtsp://admin:pass@192.168.1.64:554/stream1"
                        className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white font-mono text-sm placeholder-slate-500 focus:outline-none focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan/40 transition-all"
                      />
                      <button
                        type="button"
                        id="btn-test-rtsp"
                        onClick={handleTest}
                        disabled={testing || !form.rtsp_url}
                        className="flex items-center gap-1.5 px-4 py-3 rounded-xl bg-brand-blue/20 border border-brand-blue/30 text-brand-cyan hover:bg-brand-blue/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm font-semibold whitespace-nowrap"
                      >
                        {testing
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <Wifi className="w-4 h-4" />}
                        {testing ? "Testing…" : "Test"}
                      </button>
                    </div>

                    {/* Test result */}
                    <AnimatePresence>
                      {testResult && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          className={`mt-2 flex items-start gap-2 p-3 rounded-xl text-sm font-medium ${
                            testResult.ok
                              ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
                              : "bg-red-500/10 border border-red-500/30 text-red-400"
                          }`}
                        >
                          {testResult.ok
                            ? <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                            : <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
                          <span>
                            {testResult.message}
                            {testResult.fps ? <span className="text-xs ml-2 opacity-70">({testResult.fps} fps)</span> : null}
                          </span>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </section>

              {/* Assignment */}
              <section>
                <label className="block text-xs font-semibold text-brand-cyan uppercase tracking-wider mb-3">
                  Assignment
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm text-slate-400 mb-1 block flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5" /> Zone
                    </label>
                    <select
                      id="cam-zone"
                      value={form.zone_id}
                      onChange={set("zone_id")}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-brand-cyan transition-all appearance-none"
                    >
                      <option value="">Unassigned</option>
                      {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm text-slate-400 mb-1 block flex items-center gap-1">
                      <Server className="w-3.5 h-3.5" /> NVR / DVR
                    </label>
                    <select
                      id="cam-nvr"
                      value={form.nvr_dvr_id}
                      onChange={set("nvr_dvr_id")}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-brand-cyan transition-all appearance-none"
                    >
                      <option value="">None (Direct IP)</option>
                      {nvrs.map(n => <option key={n.id} value={n.id}>{n.name} ({n.ip_address})</option>)}
                    </select>
                  </div>
                </div>
              </section>

              {/* RTSP hint */}
              <div className="rounded-xl bg-brand-blue/5 border border-brand-blue/15 p-4">
                <p className="text-xs text-slate-400 leading-relaxed">
                  <span className="text-brand-cyan font-semibold">RTSP URL format:</span>{" "}
                  <code className="font-mono text-slate-300">rtsp://user:pass@IP:554/stream1</code>
                  <br />
                  Most factory cameras use port <code className="font-mono">554</code>. Try{" "}
                  <code className="font-mono">/stream</code>, <code className="font-mono">/h264Preview_01_main</code>, or{" "}
                  <code className="font-mono">/cam/realmonitor?channel=1&subtype=0</code> if <code className="font-mono">/stream1</code> fails.
                </p>
              </div>
            </form>

            {/* Footer */}
            <div className="px-6 py-5 border-t border-white/10 flex-shrink-0 flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 rounded-xl border border-white/10 text-slate-300 font-semibold hover:bg-white/5 transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="camera-form-internal"
                onClick={handleSubmit}
                disabled={saving}
                id="btn-save-camera"
                className="flex-1 py-3 rounded-xl bg-brand-blue hover:bg-blue-500 text-white font-bold shadow-[0_0_20px_rgba(59,130,246,0.35)] hover:shadow-[0_0_25px_rgba(59,130,246,0.5)] transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {saving ? "Saving…" : (editCamera ? "Update Camera" : "Add Camera")}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Camera Card ───────────────────────────────────────────────────────────────
function CameraCard({ cam, onEdit, onDelete, index }) {
  const isActive = cam.status === "active" || cam.status === "online";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.92, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.88 }}
      transition={{ duration: 0.25, delay: index * 0.04 }}
    >
      <Card className="relative overflow-hidden group h-full flex flex-col justify-between !p-0">
        {/* Glow bg on hover */}
        <div className="absolute inset-0 bg-gradient-to-br from-brand-blue/8 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none rounded-2xl" />

        {/* Status stripe at top */}
        <div className={`absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl ${isActive ? "bg-emerald-500" : "bg-red-500/60"}`} />

        <div className="p-5">
          {/* Header row */}
          <div className="flex items-start justify-between mb-4">
            <div className={`p-3 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
              isActive
                ? "bg-emerald-500/15 text-emerald-400 shadow-[0_0_18px_rgba(16,185,129,0.2)]"
                : "bg-red-500/15 text-red-400"
            }`}>
              {isActive ? <Video className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
            </div>
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold uppercase tracking-wide ${
              isActive
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : "bg-red-500/10 border-red-500/30 text-red-400"
            }`}>
              {isActive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
              {cam.status || "Unknown"}
            </div>
          </div>

          {/* Name */}
          <h3 className="text-base font-bold text-white mb-0.5 truncate" title={cam.name}>{cam.name}</h3>
          <p className="text-xs font-mono text-slate-400 mb-4 truncate">{cam.id}</p>

          {/* Meta */}
          <div className="space-y-2">
            <InfoRow icon={<Signal className="w-3.5 h-3.5" />} label="Type" value={cam.camera_type || "IP Camera"} />
            {cam.ip_address && (
              <InfoRow icon={<Wifi className="w-3.5 h-3.5" />} label="IP" value={cam.ip_address} mono />
            )}
            {cam.zone_name && (
              <InfoRow icon={<MapPin className="w-3.5 h-3.5" />} label="Zone" value={cam.zone_name} />
            )}
            {cam.nvr_name && (
              <InfoRow icon={<Server className="w-3.5 h-3.5" />} label="NVR" value={cam.nvr_name} />
            )}
            {cam.rtsp_url && (
              <div className="flex items-start gap-2 text-xs mt-1">
                <LinkIcon className="w-3.5 h-3.5 text-slate-500 mt-0.5 flex-shrink-0" />
                <span className="text-slate-500 font-mono truncate" title={cam.rtsp_url}>
                  {cam.rtsp_url.replace(/:[^@]+@/, ":••••@")}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Action footer */}
        <div className="flex items-center gap-2 px-5 py-4 border-t border-white/5">
          <button
            id={`btn-edit-cam-${cam.id}`}
            onClick={() => onEdit(cam)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold text-slate-300 border border-white/10 hover:bg-white/5 hover:text-white transition-all"
          >
            <Edit className="w-3.5 h-3.5" /> Edit
          </button>
          <button
            id={`btn-del-cam-${cam.id}`}
            onClick={() => onDelete(cam)}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-red-400 border border-red-500/20 hover:bg-red-500/10 hover:border-red-500/40 transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </Card>
    </motion.div>
  );
}

function InfoRow({ icon, label, value, mono }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <div className="flex items-center gap-1.5 text-slate-500">
        {icon}
        <span>{label}</span>
      </div>
      <span className={`text-slate-300 font-medium truncate max-w-[140px] ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

// ── Delete Confirm Modal ──────────────────────────────────────────────────────
function DeleteModal({ camera, onConfirm, onCancel }) {
  if (!camera) return null;
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          className="bg-[#0d1117] border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
        >
          <div className="w-12 h-12 rounded-xl bg-red-500/15 flex items-center justify-center mx-auto mb-4">
            <Trash2 className="w-6 h-6 text-red-400" />
          </div>
          <h3 className="text-lg font-bold text-white text-center mb-1">Delete Camera?</h3>
          <p className="text-sm text-slate-400 text-center mb-6">
            This will permanently remove <span className="text-white font-semibold">{camera.name}</span> from the system.
          </p>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 py-3 rounded-xl border border-white/10 text-slate-300 font-semibold hover:bg-white/5 transition-all"
            >
              Cancel
            </button>
            <button
              id="btn-confirm-delete"
              onClick={() => onConfirm(camera.id)}
              className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold transition-all"
            >
              Delete
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Cameras() {
  const { user, accessToken, loading: authLoading } = useAuth();
  const [cameras, setCameras]           = useState([]);
  const [zones, setZones]               = useState([]);
  const [nvrs, setNvrs]                 = useState([]);
  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [editCamera, setEditCamera]     = useState(null);   // null = add mode
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [loading, setLoading]           = useState(true);
  const [filter, setFilter]             = useState("all"); // all | active | inactive
  const wsRef = useRef(null);

  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-400" /></div>;
  if (!user) return null;

  const fetchAll = useCallback(async () => {
    try {
      const [cams, zList, nList] = await Promise.all([listCameras(), listZones(), listNvr()]);
      setCameras(cams || []);
      setZones(zList || []);
      setNvrs(nList || []);
    } catch { /* silently ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    fetchAll();

    // WebSocket live refresh
    function setupWs() {
      try {
        const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080";
        const ws = new WebSocket(`${API_BASE.replace("http", "ws")}/api/employees/ws?token=${accessToken || ''}`);
        ws.onmessage = () => { if (mounted) fetchAll(); };
        ws.onclose = () => { if (mounted) setTimeout(setupWs, 3000); };
        ws.onerror = () => ws.close();
        wsRef.current = ws;
      } catch { }
    }
    setupWs();

    const interval = setInterval(fetchAll, 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
      wsRef.current?.close();
    };
  }, [fetchAll, accessToken]);

  function openAdd() { setEditCamera(null); setDrawerOpen(true); }
  function openEdit(cam) { setEditCamera(cam); setDrawerOpen(true); }

  async function handleDelete(id) {
    try {
      await deleteCamera(id);
      toast.success("Camera removed");
      setDeleteTarget(null);
      fetchAll();
    } catch {
      toast.error("Failed to delete camera");
    }
  }

  // Stats
  const activeCount   = cameras.filter(c => c.status === "active" || c.status === "online").length;
  const inactiveCount = cameras.length - activeCount;

  const filtered = cameras.filter(c => {
    if (filter === "active")   return c.status === "active" || c.status === "online";
    if (filter === "inactive") return c.status !== "active" && c.status !== "online";
    return true;
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      className="max-w-[1600px] mx-auto space-y-8"
    >
      {/* Page header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
            Camera Fleet
          </h2>
          <p className="text-slate-400 mt-1 text-sm">Manage IP cameras across factory zones via RTSP / ONVIF.</p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/onvif-discover"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 font-semibold text-sm transition-all"
          >
            <Wifi className="w-4 h-4" /> Auto-Discover
          </a>
          <button
            id="btn-add-camera"
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-blue hover:bg-blue-500 text-white font-bold text-sm shadow-[0_0_18px_rgba(59,130,246,0.35)] hover:shadow-[0_0_25px_rgba(59,130,246,0.5)] transition-all"
          >
            <Plus className="w-4 h-4" /> Add Camera
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total",    value: cameras.length, color: "text-white",         bg: "bg-white/5" },
          { label: "Online",   value: activeCount,    color: "text-emerald-400",   bg: "bg-emerald-500/10" },
          { label: "Offline",  value: inactiveCount,  color: "text-red-400",       bg: "bg-red-500/10" },
        ].map(s => (
          <Card key={s.label} className={`!py-4 !px-5 ${s.bg} border border-white/5`}>
            <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">{s.label}</p>
            <p className={`text-3xl font-black mt-1 ${s.color}`}>{s.value}</p>
          </Card>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2">
        {["all", "active", "inactive"].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold capitalize transition-all ${
              filter === f
                ? "bg-brand-blue text-white shadow-[0_0_12px_rgba(59,130,246,0.4)]"
                : "text-slate-400 hover:text-white hover:bg-white/5"
            }`}
          >
            {f === "all" ? `All (${cameras.length})` : f === "active" ? `Online (${activeCount})` : `Offline (${inactiveCount})`}
          </button>
        ))}
      </div>

      {/* Camera grid */}
      {loading ? (
        <div className="flex items-center justify-center py-24 gap-3 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-sm font-medium">Loading cameras…</span>
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border border-dashed border-white/10">
          <div className="flex flex-col items-center py-16 text-slate-500">
            <Camera className="w-14 h-14 mb-4 opacity-30" />
            <p className="text-lg font-semibold text-slate-300 mb-1">
              {cameras.length === 0 ? "No Cameras Connected" : "No cameras match this filter"}
            </p>
            <p className="text-sm mb-6 text-center max-w-xs">
              {cameras.length === 0
                ? "Add your first IP camera or use Auto-Discover to find cameras on the network."
                : "Try a different filter or add more cameras."}
            </p>
            {cameras.length === 0 && (
              <div className="flex gap-3">
                <a href="/onvif-discover" className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 font-semibold text-sm transition-all">
                  <Wifi className="w-4 h-4" /> Auto-Discover
                </a>
                <button
                  onClick={openAdd}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-blue text-white font-bold text-sm"
                >
                  <Plus className="w-4 h-4" /> Add Manually
                </button>
              </div>
            )}
          </div>
        </Card>
      ) : (
        <motion.div layout className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          <AnimatePresence>
            {filtered.map((cam, i) => (
              <CameraCard
                key={cam.id}
                cam={cam}
                index={i}
                onEdit={openEdit}
                onDelete={setDeleteTarget}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Add/Edit Drawer */}
      <CameraDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSaved={fetchAll}
        editCamera={editCamera}
        zones={zones}
        nvrs={nvrs}
      />

      {/* Delete confirm modal */}
      {deleteTarget && (
        <DeleteModal
          camera={deleteTarget}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </motion.div>
  );
}
