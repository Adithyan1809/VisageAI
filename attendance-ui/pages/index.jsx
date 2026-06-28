import axios from 'axios';
import { PageHeader } from "../components/PageHeader";
import Card from "../components/Card";
import Modal from "../components/Modal";
import { useEffect, useState, useRef } from "react";
import { Line } from 'react-chartjs-2';
import { Download, Users, Camera as CameraIcon, AlertCircle, CheckCircle2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '../lib/auth';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8080'

// small helper: build a sparkline SVG path from an array of numbers
function buildSparklinePath(values = [], w = 120, h = 28) {
  if (!values || values.length === 0) return '';
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const step = w / Math.max(1, values.length - 1);
  return values.map((v, i) => {
    const x = Math.round(i * step);
    const y = Math.round(h - ((v - min) / range) * h);
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');
}

export default function Home() {
  const [liveEvents, setLiveEvents] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [employeesMap, setEmployeesMap] = useState({});
  const [employeesDeptMap, setEmployeesDeptMap] = useState({});
  const [employeesDeptByName, setEmployeesDeptByName] = useState({});
  const employeesDeptRef = useRef({});
  const [totalEmployees, setTotalEmployees] = useState(null);
  const presentRef = useRef(new Set());
  const [, setTick] = useState(0); // simple force-update when present set changes
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    // On mount, fetch recent attendance for the last 24 hours so data persists across page navigations
    const fetchRecent = async () => {
      try {
        // Prefer dev reader when backend ORM mappings are unstable
        const res = await axios.get(`${API_BASE}/api/dev/attendance/recent?hours=24&limit=1000`, { withCredentials: true });
        if (res.status === 200) {
          const items = res.data;
          // Normalize DB attendance rows into the same shape we receive via SSE
          const normalized = (items || []).map((r) => ({
            employee_id: r.employee_id,
            employee_name: r.employee_name,
            camera_id: r.camera_id,
            similarity: r.similarity || 0.0,
            track_id: r.track_id || null,
            recognized: !!(r.employee_id || r.employee_name),
            attendance_marked: true,
            time: r.time || r.event_time || null,
            from_db: true,
          }));
          // Build a quick employee id -> name map if we haven't already
          try {
            // fetch departments and employees so we can show department names in the dashboard
            const [empsResp, depsResp] = await Promise.all([
              axios.get(`${API_BASE}/api/employees`, { withCredentials: true }).catch(() => ({ status: 0, data: null })),
              axios.get(`${API_BASE}/api/organization/departments`, { withCredentials: true }).catch(() => ({ status: 0, data: null })),
            ])

            const deptMap = {}
            if (depsResp && depsResp.status === 200) {
              try {
                const depsJson = depsResp.data;
                (depsJson || []).forEach(d => { if (d.id) deptMap[d.id] = d.name || d.department_name || d.name })
              } catch (e) {}
            }

            if (empsResp && empsResp.status === 200) {
              const empsJson = empsResp.data;
              const nameMap = {};
              const edMap = {};
              const edByName = {};
              (empsJson || []).forEach(e => {
                if (!e || !e.id) return
                const name = e.name || e.username || e.employee_code || null
                nameMap[e.id] = name
                // try department name from row, else lookup by department_id
                const deptName = e.department_name || (e.department_id ? (deptMap[e.department_id] || e.department_id) : (e.department || null))
                edMap[e.id] = deptName
                if (name) {
                  const key = String(name).trim().toLowerCase()
                  edByName[key] = deptName
                }
              })
              setEmployeesMap(nameMap);
              setEmployeesDeptMap(edMap);
              setEmployeesDeptByName(edByName);
              employeesDeptRef.current = edMap;
              // fill missing employee_name in normalized rows from map
              normalized.forEach(n => { if (!n.employee_name && n.employee_id && nameMap[n.employee_id]) n.employee_name = nameMap[n.employee_id]; });
            }
          } catch (e) {
            // ignore employee fetch failure — we'll still render ids
          }

          // Split normalized rows into recognized and unknowns
          const recognized = [];
          const unknowns = [];
          normalized.forEach((d) => {
            const name = d.employee_name || d.employee_id;
            if (!name || String(name).toLowerCase() === 'unknown') {
              unknowns.push(d);
            } else {
              recognized.push(d);
            }
          });

          if (recognized.length) {
            setLiveEvents((s) => recognized.concat(s).slice(0, 1000));
            recognized.forEach((ev) => {
              if (ev.employee_id) presentRef.current.add(ev.employee_id);
            });
            setTick((t) => t + 1);
          }
          if (unknowns.length) {
            setAlerts((a) => unknowns.concat(a).slice(0, 1000));
          }
        }
      } catch (e) {
        // ignore fetch failure
      }
    };
    fetchRecent();

    // fetch total employees for a KPI card (best-effort)
    (async () => {
      try {
        const r = await axios.get(`${API_BASE}/api/employees`, { withCredentials: true });
        if (r.status === 200) {
          const j = r.data;
          setTotalEmployees(Array.isArray(j) ? j.length : null);
        }
      } catch (e) {}
    })();

    let es;
    try {
      es = new EventSource(`${API_BASE}/api/attendance/stream`);
      
      es.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (!data) return;

          // normalize fields for consistency
          const ev = {
            employee_id: data.employee_id || data.employee || null,
            employee_name: data.employee_name || null,
            camera_id: data.camera_id || data.camera || null,
            similarity: data.similarity || 0.0,
            track_id: data.track_id || data.track || null,
            recognized: !!data.recognized,
            attendance_marked: !!data.attendance_marked,
            time: data.time || (data.timestamp ? new Date(data.timestamp * 1000).toISOString() : null),
            from_db: false,
          };

          // Enrich with employee name from map if available
          if ((!ev.employee_name || ev.employee_name === '') && ev.employee_id && employeesMap[ev.employee_id]) {
            ev.employee_name = employeesMap[ev.employee_id];
          }

          // Enrich department from incoming payload or from our employee->department lookup
          ev.department = data.department || data.department_name || employeesDeptRef.current[ev.employee_id] || null;

          // Route anonymous / unknown events to alerts, show recognized ones on dashboard
          const name = ev.employee_name || ev.employee_id;
          if (!name || String(name).toLowerCase() === 'unknown') {
            // push to alerts list
            setAlerts((a) => [ev].concat(a).slice(0, 1000));
            return;
          }

          // maintain a large recent-events list, newest first; do not drop duplicates
          setLiveEvents((s) => [ev].concat(s).slice(0, 1000));

          // mark present set only for recognized events with an id
          const id = ev.employee_id;
          if (id) {
            presentRef.current.add(id);
            setTick((t) => t + 1);
          }
        } catch (e) {
          // ignore invalid event
        }
      };
      es.onerror = () => {
        // ignore SSE errors
      };
    } catch (e) {
      // ignore EventSource not available
    }

    return () => {
      try { if (es) es.close(); } catch (e) {}
    };
  }, []);

  const presentCount = presentRef.current.size;

  // compute cameras seen in recent events
  const uniqueCameras = Array.from(new Set(liveEvents.map(e => e.camera_id || e.camera).filter(Boolean))).length;

  // build hourly counts for chart (last 24 hours)
  const counts = (() => {
    const now = Date.now();
    // bucket into 24 windows of 1 hour each
    const buckets = new Array(24).fill(0);
    liveEvents.forEach(ev => {
      const d = new Date(ev.time || ev.timestamp || Date.now());
      const diff = Math.max(0, now - d.getTime());
      const idx = Math.floor(diff / (60 * 60 * 1000));
      if (idx < 24) buckets[Math.max(0, 23 - idx)] += 1;
    });
    return buckets;
  })();

  // chart data for react-chartjs-2
  const chartLabels = counts.map((_, i) => `${24 - i}h`);
  const chartData = {
    labels: chartLabels,
    datasets: [
      {
        label: 'Attendance events',
        data: counts,
        fill: true,
        backgroundColor: 'rgba(56,189,248,0.12)',
        borderColor: '#38bdf8',
        tension: 0.3,
        pointRadius: 2,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { color: 'rgba(148,163,184,0.06)' }, ticks: { color: '#94a3b8' } },
      y: { beginAtZero: true, grid: { color: 'rgba(148,163,184,0.06)' }, ticks: { color: '#94a3b8' } },
    },
  };

  // Display timezone: default to India (Asia/Kolkata). Can be overridden with NEXT_PUBLIC_TIMEZONE.
  const DISPLAY_TIMEZONE = process.env.NEXT_PUBLIC_TIMEZONE || "Asia/Kolkata";

  function parseToDate(ev) {
    if (!ev) return null;
    // prefer ev.time (ISO string or timestamp), then ev.timestamp (unix seconds or ms)
    if (ev.time) {
      try {
        const t = typeof ev.time === 'number' ? (ev.time < 1e12 ? ev.time * 1000 : ev.time) : ev.time;
        const d = new Date(t);
        if (!isNaN(d.getTime())) return d;
      } catch (e) {}
    }
    if (ev.timestamp) {
      try {
        const ts = typeof ev.timestamp === 'number' ? (ev.timestamp < 1e12 ? ev.timestamp * 1000 : ev.timestamp) : Number(ev.timestamp);
        const d = new Date(ts);
        if (!isNaN(d.getTime())) return d;
      } catch (e) {}
    }
    return null;
  }

  function formatAbsolute(ev) {
    const d = parseToDate(ev);
    if (!d) return '-';
    try {
      const date = d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: DISPLAY_TIMEZONE });
      const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, timeZone: DISPLAY_TIMEZONE });
      return `${date}, ${time}`;
    } catch (e) {
      // fallback
      return d.toLocaleString();
    }
  }

  function timeAgoFromDate(d) {
    if (!d) return '';
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const days = Math.floor(h / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 4) return `${weeks}w ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    const years = Math.floor(days / 365);
    return `${years}y ago`;
  }

  function relativeTime(ev) {
    const d = parseToDate(ev);
    if (!d) return '';
    return timeAgoFromDate(d);
  }

  // helper: download blob
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  // export attendance utility (filter by date range and format)
  function exportAttendance({ format = 'csv', from = null, to = null } = {}) {
    // filter events by date range if provided
    let filtered = liveEvents.slice(0, 200);
    if (from || to) {
      const fromTs = from ? new Date(from + 'T00:00:00').getTime() : null;
      const toTs = to ? new Date(to + 'T23:59:59').getTime() : null;
      filtered = filtered.filter(ev => {
        const d = parseToDate(ev) || new Date(ev.time || Date.now());
        const t = d.getTime();
        if (fromTs && t < fromTs) return false;
        if (toTs && t > toTs) return false;
        return true;
      });
    }

    if (format === 'json') {
      const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `attendance_export_${Date.now()}.json`);
      return;
    }

    // default CSV
    const csvHeader = 'time,employee,camera,status';
    const rows = filtered.map(ev => `"${formatAbsolute(ev)}","${(ev.employee_name||ev.employee||ev.employee_id||'unknown')}","${(ev.camera_id||ev.camera||'')}","${ev.attendance_marked ? 'present' : ev.recognized ? 'recognized' : 'unknown'}"`);
    const csv = [csvHeader].concat(rows).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    downloadBlob(blob, `attendance_export_${Date.now()}.csv`);
  }

  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState('csv');
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');

  const { user, loading: authLoading } = useAuth();
  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-400" /></div>;
  if (!user) return null;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-[1600px] mx-auto space-y-8"
    >
      <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">Live Telemetry</h2>
          <p className="text-muted mt-1">Real-time attendance stream and system vitals.</p>
        </div>
        <button 
          onClick={() => setExportModalOpen(true)} 
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-blue hover:bg-blue-500 text-white rounded-xl text-sm font-semibold shadow-glow-brand transition-all hover:scale-105 active:scale-95"
        >
          <Download className="w-4 h-4" /> Export Report
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-brand-blue/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-center justify-between relative z-10">
            <div>
              <p className="text-sm font-medium text-brand-cyan">Total Enrolled</p>
              <div className="text-3xl font-bold text-white mt-1">{totalEmployees ?? '—'}</div>
            </div>
            <div className="w-12 h-12 rounded-xl bg-brand-blue/20 flex items-center justify-center text-brand-blue shadow-[0_0_15px_rgba(59,130,246,0.3)]">
              <Users className="w-6 h-6" />
            </div>
          </div>
        </Card>

        <Card className="relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-success/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-center justify-between relative z-10">
            <div>
              <p className="text-sm font-medium text-success">Present Today</p>
              <div className="text-3xl font-bold text-white mt-1">{presentCount}</div>
            </div>
            <div className="w-12 h-12 rounded-xl bg-success/20 flex items-center justify-center text-success shadow-[0_0_15px_rgba(16,185,129,0.3)]">
              <CheckCircle2 className="w-6 h-6" />
            </div>
          </div>
        </Card>

        <Card className="relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-center justify-between relative z-10">
            <div>
              <p className="text-sm font-medium text-purple-400">Active Cameras</p>
              <div className="text-3xl font-bold text-white mt-1">{uniqueCameras}</div>
            </div>
            <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center text-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.3)]">
              <CameraIcon className="w-6 h-6" />
            </div>
          </div>
        </Card>

        <Card className="relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-danger/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-center justify-between relative z-10">
            <div>
              <p className="text-sm font-medium text-danger">Unknown Faces</p>
              <div className="text-3xl font-bold text-white mt-1">{alerts.length}</div>
            </div>
            <div className="w-12 h-12 rounded-xl bg-danger/20 flex items-center justify-center text-danger shadow-[0_0_15px_rgba(239,68,68,0.3)]">
              <AlertCircle className="w-6 h-6" />
            </div>
          </div>
        </Card>
      </div>

      <Modal isOpen={exportModalOpen} onClose={() => setExportModalOpen(false)} title="Export Attendance Data">
        <div className="space-y-4 mt-4">
          <div>
            <label className="block text-sm font-medium text-muted mb-1.5">File Format</label>
            <select value={exportFormat} onChange={e => setExportFormat(e.target.value)} className="w-full px-4 py-2.5 rounded-xl bg-black/50 border border-glass-border text-white focus:ring-2 focus:ring-brand-blue outline-none transition-all">
              <option value="csv">CSV (Spreadsheet)</option>
              <option value="json">JSON (Raw Data)</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-muted mb-1.5">From Date</label>
              <input type="date" value={exportFrom} onChange={e => setExportFrom(e.target.value)} className="w-full px-4 py-2.5 rounded-xl bg-black/50 border border-glass-border text-white focus:ring-2 focus:ring-brand-blue outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted mb-1.5">To Date</label>
              <input type="date" value={exportTo} onChange={e => setExportTo(e.target.value)} className="w-full px-4 py-2.5 rounded-xl bg-black/50 border border-glass-border text-white focus:ring-2 focus:ring-brand-blue outline-none" />
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 mt-8">
            <button onClick={() => setExportModalOpen(false)} className="px-5 py-2.5 rounded-xl text-sm font-medium text-muted hover:text-white hover:bg-white/5 transition-colors">Cancel</button>
            <button onClick={() => { exportAttendance({ format: exportFormat, from: exportFrom || null, to: exportTo || null }); setExportModalOpen(false); }} className="px-5 py-2.5 bg-brand-blue hover:bg-blue-500 text-white rounded-xl text-sm font-semibold shadow-glow-brand transition-all hover:scale-105 active:scale-95">Download File</button>
          </div>
        </div>
      </Modal>

      {/* Main Feed */}
      <Card className="!p-0 overflow-hidden">
        <div className="p-6 border-b border-glass-border flex items-center justify-between">
          <h3 className="text-xl font-semibold text-white">Live Activity Stream</h3>
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-success"></span>
            </span>
            <span className="text-sm font-medium text-success">Live</span>
          </div>
        </div>
        
        <div className="overflow-x-auto max-h-[600px] custom-scrollbar">
          {liveEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-muted">
              <div className="w-16 h-16 mb-4 rounded-full bg-white/5 flex items-center justify-center border border-glass-border">
                <CameraIcon className="w-6 h-6 opacity-50" />
              </div>
              <p>No activity detected yet.</p>
              <p className="text-xs mt-1">Waiting for cameras to report detections...</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-glass-card/90 backdrop-blur-md z-10 border-b border-glass-border text-xs uppercase tracking-wider text-muted font-semibold">
                <tr>
                  <th className="px-6 py-4">Timestamp</th>
                  <th className="px-6 py-4">Subject</th>
                  <th className="px-6 py-4">Department</th>
                  <th className="px-6 py-4">Source Camera</th>
                  <th className="px-6 py-4 text-right">Match Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-glass-border/50">
                {liveEvents.map((ev, i) => {
                  const name = ev.employee_name || ev.employee || ev.employee_id || 'unknown';
                  const isUnknown = name === 'unknown';
                  const initials = isUnknown ? '?' : name.substring(0,2).toUpperCase();
                  const confidence = (ev.similarity * 100).toFixed(1);
                  
                  return (
                    <motion.tr 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3 }}
                      key={`${ev.track_id}-${i}`} 
                      className="hover:bg-white/[0.02] transition-colors group"
                    > 
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-white font-medium">{formatAbsolute(ev).split(', ')[1]}</div>
                        <div className="text-xs text-muted">{relativeTime(ev)}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${isUnknown ? 'bg-danger/20 text-danger border border-danger/30' : 'bg-brand-blue/20 text-brand-blue border border-brand-blue/30 group-hover:shadow-glow-brand transition-all'}`}>
                            {initials}
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-white">{name}</div>
                            <div className="text-xs text-muted flex items-center gap-1">
                              {ev.attendance_marked ? (
                                <span className="text-success flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> Marked Present</span>
                              ) : (
                                <span>Track #{ev.track_id}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex px-2.5 py-1 rounded-md bg-white/5 border border-glass-border text-xs text-slate-300">
                          {ev.department || employeesDeptMap[ev.employee_id] || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-muted">
                        <div className="flex items-center gap-1.5">
                          <CameraIcon className="w-3.5 h-3.5" /> {ev.camera_id || ev.camera || '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {ev.from_db || !ev.similarity ? (
                          <span className="text-sm text-slate-500">—</span>
                        ) : (
                          <div className="inline-flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.min(100, Math.max(0, confidence))}%` }}
                                transition={{ duration: 1, ease: "easeOut" }}
                                className={`h-full ${isUnknown ? 'bg-danger' : 'bg-success'}`}
                              />
                            </div>
                            <span className={`text-sm font-semibold ${isUnknown ? 'text-danger' : 'text-success'}`}>{confidence}%</span>
                          </div>
                        )}
                      </td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </motion.div>
  );
}
