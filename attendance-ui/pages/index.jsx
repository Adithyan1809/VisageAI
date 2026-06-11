import { PageHeader } from "../components/PageHeader";
import Card from "../components/Card";
import Modal from "../components/Modal";
import { useEffect, useState, useRef } from "react";
import { Line } from 'react-chartjs-2';
import { Download } from 'lucide-react';
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

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8081'

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
        const res = await fetch(`${API_BASE}/api/dev/attendance/recent?hours=24&limit=1000`, { credentials: 'include' });
        if (res.ok) {
          const items = await res.json();
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
              fetch(`${API_BASE}/api/employees`, { credentials: 'include' }).catch(() => ({ ok: false })),
              fetch(`${API_BASE}/api/organization/departments`, { credentials: 'include' }).catch(() => ({ ok: false })),
            ])

            const deptMap = {}
            if (depsResp && depsResp.ok) {
              try {
                const depsJson = await depsResp.json()
                (depsJson || []).forEach(d => { if (d.id) deptMap[d.id] = d.name || d.department_name || d.name })
              } catch (e) {}
            }

            if (empsResp && empsResp.ok) {
              const empsJson = await empsResp.json();
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
        console.warn('Failed to fetch recent attendance', e);
      }
    };
    fetchRecent();

    // fetch total employees for a KPI card (best-effort)
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/employees`, { credentials: 'include' });
        if (r.ok) {
          const j = await r.json();
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
          console.warn('Invalid attendance event', e);
        }
      };
      es.onerror = (err) => {
        console.warn('SSE error', err);
      };
    } catch (e) {
      console.warn('EventSource not available', e);
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

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Real-time Updates Active" />

      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <div className="text-sm text-slate-400">Total Employees</div>
          <div className="flex items-end justify-between mt-2">
            <div>
              <div className="text-2xl font-semibold text-slate-100">{totalEmployees ?? '—'}</div>
                <div className="text-xs text-slate-400">Registered</div>
              </div>
          </div>
        </Card>

        <Card>
          <div className="text-sm text-slate-400">Present Now</div>
          <div className="text-2xl mt-2 text-slate-100">{presentCount}</div>
        </Card>

        <Card>
          <div className="text-sm text-slate-400">Cameras Active</div>
          <div className="text-2xl mt-2 text-slate-100">{uniqueCameras}</div>
        </Card>

        <Card>
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm text-slate-400">Alerts</div>
              <div className="text-2xl mt-2 text-amber-300">{alerts.length}</div>
            </div>
          </div>
          <div className="text-xs text-slate-500 mt-2">Auto-refresh:</div>
          <div className="mt-1">
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} /> Enable</label>
          </div>
        </Card>
      </div>
    </div>

        <div className="w-48 flex items-start justify-end">
          <div className="flex flex-col items-end">
            <div className="text-sm text-slate-400 mb-2">Export Attendance</div>
            <button title="Export Attendance" onClick={() => setExportModalOpen(true)} className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-lg">
              <Download className="w-4 h-4 mr-2" /> Export
            </button>
            <div className="text-xs text-slate-500 mt-2">CSV / JSON · choose range</div>
          </div>
        </div>
      </div>

      <Modal isOpen={exportModalOpen} onClose={() => setExportModalOpen(false)} title="Export Attendance">
        <div className="space-y-3">
          <div>
            <div className="text-sm text-slate-400 mb-1">Format</div>
            <select value={exportFormat} onChange={e => setExportFormat(e.target.value)} className="w-full px-2 py-1 rounded border dark:bg-slate-800">
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </select>
          </div>

          <div>
            <div className="text-sm text-slate-400 mb-1">Date Range (optional)</div>
            <div className="flex items-center gap-2">
              <input type="date" value={exportFrom} onChange={e => setExportFrom(e.target.value)} className="px-2 py-1 rounded border dark:bg-slate-800" />
              <span className="text-slate-400">to</span>
              <input type="date" value={exportTo} onChange={e => setExportTo(e.target.value)} className="px-2 py-1 rounded border dark:bg-slate-800" />
            </div>
            <div className="text-xs text-slate-500 mt-1">Leave blank to export recent events.</div>
          </div>

          <div className="flex items-center justify-end space-x-2 mt-4">
            <button onClick={() => setExportModalOpen(false)} className="px-3 py-1 border rounded text-sm">Cancel</button>
            <button onClick={() => { exportAttendance({ format: exportFormat, from: exportFrom || null, to: exportTo || null }); setExportModalOpen(false); }} className="px-3 py-1 bg-blue-600 text-white rounded text-sm">Export</button>
          </div>
        </div>
      </Modal>

      <div className="w-full px-6 mt-6">
        
        <Card>
          <h3 className="text-lg font-bold mb-4">Recent Attendance</h3>
          <div className="overflow-x-auto">
            {liveEvents.length === 0 ? (
              <div className="text-sm text-slate-500 p-6">No recent attendance events.</div>
            ) : (
              <table className="min-w-full table-auto text-sm">
                <thead>
                    <tr className="text-left text-slate-400 sticky top-0 bg-slate-900">
                      <th className="px-4 py-2">Time</th>
                      <th className="px-4 py-2">Department</th>
                      <th className="px-4 py-2">Employee</th>
                      <th className="px-4 py-2">Camera</th>
                      <th className="px-4 py-2">Status</th>
                    </tr>
                </thead>
                <tbody>
                  {liveEvents.map((ev, i) => {
                    const isEven = i % 2 === 0;
                    const name = ev.employee_name || ev.employee || ev.employee_id || 'unknown';
                    const initials = (name && name !== 'unknown') ? name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase() : 'UN';
                    return (
                      <tr key={i} className={`${isEven ? 'bg-slate-800' : 'bg-transparent'} border-t border-slate-700 hover:bg-slate-800`}> 
                        <td className="px-4 py-3 text-slate-400 w-44">
                          <div className="flex flex-col">
                            <span className="whitespace-nowrap">{formatAbsolute(ev)}</span>
                            <span className="text-xs muted mt-0.5">{relativeTime(ev)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm text-slate-200">
                            {(() => {
                              // prefer event-provided department, then department_name, then lookup by employee id, then lookup by employee name
                              const nameKey = ev.employee_name ? String(ev.employee_name).trim().toLowerCase() : null
                              const dept = ev.department || ev.department_name || employeesDeptMap[ev.employee_id] || (nameKey ? employeesDeptByName[nameKey] : null) || '-'
                              return dept || '-'
                            })()}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-medium">{name}</td>
                        <td className="px-4 py-3 text-slate-400">{ev.camera_id || ev.camera || '-'}</td>
                        <td className="px-4 py-3">
                          {ev.attendance_marked ? (
                            <span className="inline-block bg-green-800 text-green-200 px-2 py-0.5 rounded text-xs">Present</span>
                          ) : ev.recognized ? (
                            <span className="inline-block bg-yellow-800 text-yellow-200 px-2 py-0.5 rounded text-xs">Recognized</span>
                          ) : (
                            <span className="inline-block bg-red-800 text-red-200 px-2 py-0.5 rounded text-xs">Unknown</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Card>
        {/* Alerts: unknown faces */}
       
      </div>
    </>
  );
}
