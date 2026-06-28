import axios from 'axios';
import { useState, useEffect, useMemo } from 'react';
import { PageHeader } from "../components/PageHeader";
import Card from "../components/Card";
import { BarChart2, Clock, Users, CalendarDays, Clock as ClockIcon, FileText } from "lucide-react";
import { toast } from 'sonner';
import EmptyState from '../components/EmptyState';
import { Line } from 'react-chartjs-2';
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

// small helper to parse dates similar to dashboard
function parseToDate(ev) {
  if (!ev) return null;
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

function hhmmToMinutes(t) {
  if (!t) return null;
  const parts = String(t).split(':');
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function minutesToPercent(mins) {
  return Math.max(0, Math.min(100, (mins / (24 * 60)) * 100));
}

export default function ShiftVisualization() {
  const [shifts, setShifts] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, lines: [] });
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyAssigned, setOnlyAssigned] = useState(false);
  const [attendanceEvents, setAttendanceEvents] = useState([]);

  // fetch recent attendance for chart (24 hours)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await axios.get(`${API_BASE}/api/dev/attendance/recent?hours=24&limit=2000`, { withCredentials: true });
        if (!mounted) return;
        if (res.status === 200) {
          const items = res.data;
          setAttendanceEvents(Array.isArray(items) ? items : []);
        }
      } catch (e) {
        // ignore
      }
    })();
    return () => { mounted = false };
  }, []);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const [sRes, aRes, eRes] = await Promise.all([
          axios.get(`${API_BASE}/api/shifts`),
          axios.get(`${API_BASE}/api/assignments`),
          axios.get(`${API_BASE}/api/employees`),
        ]);
        const s = sRes.status === 200 ? sRes.data : [];
        const a = aRes.status === 200 ? aRes.data : [];
        const e = eRes.status === 200 ? eRes.data : [];
        if (!mounted) return;
        setShifts(Array.isArray(s) ? s : []);
        setAssignments(Array.isArray(a) ? a : []);
        setEmployees(Array.isArray(e) ? e : []);
      } catch (err) {
        // ignore
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    const t = setInterval(load, 15_000);
    return () => { mounted = false; clearInterval(t); };
  }, []);

  const shiftsToday = shifts.map(s => ({
    id: s.id,
    name: s.name || s.shift_name || `#${s.id}`,
    color: s.color || '#3b82f6',
    start: s.start_time || s.startTime || s.start || null,
    end: s.end_time || s.endTime || s.end || null,
  }));

  const assignmentsForDate = assignments.filter(a => {
    const d = a.assigned_from || a.date || a.assigned_from || a.date;
    return String(d) === String(selectedDate);
  });

  const assignedCount = assignmentsForDate.length;
  const totalShiftHours = shiftsToday.reduce((sum, s) => {
    const start = hhmmToMinutes(s.start);
    const end = hhmmToMinutes(s.end);
    if (start == null || end == null) return sum;
    const hours = end > start ? (end - start) / 60 : (24 * 60 - start + end) / 60;
    return sum + hours;
  }, 0).toFixed(1);

  // build 24-hour counts for attendance chart
  const attendanceCounts = (() => {
    const now = Date.now();
    const buckets = new Array(24).fill(0);
    (attendanceEvents || []).forEach(ev => {
      const d = parseToDate(ev) || new Date(ev.time || ev.event_time || Date.now());
      const diff = Math.max(0, now - d.getTime());
      const idx = Math.floor(diff / (60 * 60 * 1000));
      if (idx < 24) buckets[Math.max(0, 23 - idx)] += 1;
    });
    return buckets;
  })();

  const attendanceChartData = {
    labels: attendanceCounts.map((_, i) => `${24 - i}h`),
    datasets: [{ label: 'Attendance', data: attendanceCounts, borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.12)', fill: true, tension: 0.3 }]
  };

  const attendanceChartOptions = { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#94a3b8' } }, y: { ticks: { color: '#94a3b8' }, beginAtZero: true } } };
  // Build coverage per hour: count how many shifts overlap each hour (0..23)
  const coverage = new Array(24).fill(0);
  const DAY_MINUTES = 24 * 60;
  shiftsToday.forEach(s => {
    const start = hhmmToMinutes(s.start);
    const end = hhmmToMinutes(s.end);
    if (start == null || end == null) return;
    const sMin = ((start % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
    const eMin = ((end % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
    const span = sMin <= eMin ? (eMin - sMin) : (DAY_MINUTES - sMin + eMin);
    for (let h = 0; h < 24; h++) {
      const hourStart = h * 60;
      const hourEnd = hourStart + 60;
      let overlap = 0;
      const addOverlap = (aStart, aEnd) => {
        const startMax = Math.max(aStart, hourStart);
        const endMin = Math.min(aEnd, hourEnd);
        if (endMin > startMax) overlap += (endMin - startMax);
      };
      if (sMin < eMin) {
        addOverlap(sMin, eMin);
      } else {
        // shift wraps past midnight -> two intervals
        addOverlap(sMin, DAY_MINUTES);
        addOverlap(0, eMin);
      }
      if (overlap > 0) coverage[h] += 1;
    }
  });

    const maxCoverage = Math.max(...coverage, 1);

  // helper: assignments counts for last N days for sparkline
  const getAssignmentsLastNDays = (n = 7) => {
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      out.push(assignments.filter(a => String(a.assigned_from || a.date || a.assigned_from || a.date) === key).length);
    }
    return out;
  };

  const sparkData = getAssignmentsLastNDays(7);

  const filteredShifts = useMemo(() => {
    const q = String(searchQuery || '').trim().toLowerCase();
    return shiftsToday.filter(s => {
      if (q && !String(s.name || '').toLowerCase().includes(q)) return false;
      if (onlyAssigned) {
        const has = assignmentsForDate.some(a => String(a.shiftId) === String(s.id));
        if (!has) return false;
      }
      return true;
    });
  }, [shiftsToday, searchQuery, onlyAssigned, assignmentsForDate]);

  function exportAssignmentsCSV() {
    const rows = assignmentsForDate.map(a => {
      const emp = employees.find(e => String(e.id) === String(a.employeeId)) || {};
      const shift = shiftsToday.find(s => String(s.id) === String(a.shiftId)) || {};
      const dept = emp.department || emp.departmentId || '';
      const site = emp.site || emp.siteId || '';
      return [`"${a.id}"`, `"${(emp.name || a.employeeId)}"`, `"${(shift.name || a.shiftId)}"`, `"${a.assigned_from || a.date || ''}"`, `"${dept}"`, `"${site}"`].join(',');
    });
    const csv = ["id,employee,shift,date,department,site", ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `assignments_${selectedDate}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success('Assignments exported successfully');
  }

  const { user, loading: authLoading } = useAuth();
  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-400" /></div>;
  if (!user) return null;

  return (
    <div className="p-6">
      <PageHeader title="Shift Visualization" subtitle="Visualize shifts, timelines, and coverage" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-slate-400">Total Shifts</div>
              <div className="text-2xl font-bold mt-1">{shiftsToday.length}</div>
            </div>
            <BarChart2 className="w-8 h-8 text-slate-400" />
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-slate-400">Assignments on {selectedDate}</div>
              <div className="text-2xl font-bold mt-1">{assignedCount}</div>
            </div>
            <Users className="w-8 h-8 text-slate-400" />
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-slate-400">Total Shift Hours</div>
              <div className="text-2xl font-bold mt-1">{totalShiftHours}h</div>
            </div>
            <Clock className="w-8 h-8 text-slate-400" />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
            <Card className="mb-6">
              <h3 className="text-lg font-semibold mb-3">Attendance (last 24h)</h3>
              <div className="h-48">
                <Line data={attendanceChartData} options={attendanceChartOptions} />
              </div>
            </Card>

          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">24-hour Shift Timeline</h3>
              <div className="flex items-center space-x-2">
                <label className="text-sm text-slate-400">Date</label>
                <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="px-4 py-2 rounded-xl bg-black/40 border border-glass-border text-foreground outline-none appearance-none" />
                <input placeholder="Search shifts..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="ml-3 px-4 py-2 rounded-xl bg-black/40 border border-glass-border text-foreground outline-none text-sm" />
                <label className="ml-2 text-sm text-slate-400 flex items-center"><input type="checkbox" className="mr-2 rounded border-glass-border bg-black/40" checked={onlyAssigned} onChange={(e) => setOnlyAssigned(e.target.checked)} />Only show assigned</label>
              </div>
            </div>

            <div className="mb-3 text-sm text-slate-400">Each row shows a shift positioned across the 24-hour grid. Colors indicate different shifts.</div>

            {/* Legend & Sparkline */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-4">
                {shiftsToday.slice(0,6).map(s => (
                  <div key={s.id} className="flex items-center space-x-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                    <div className="text-sm text-slate-300">{s.name}</div>
                  </div>
                ))}
              </div>
              <div className="flex items-center space-x-2">
                <div className="text-xs text-slate-400 mr-2">Assignments (7d)</div>
                <svg width="120" height="28" viewBox="0 0 120 28" className="inline-block">
                  {(() => {
                    const max = Math.max(...sparkData, 1);
                    return sparkData.map((v, i) => {
                      const x = (i / (sparkData.length - 1)) * 118 + 1;
                      const y = 26 - (v / max) * 20;
                      return <circle key={i} cx={x} cy={y} r="1.2" fill="#60a5fa" />;
                    });
                  })()}
                </svg>
              </div>
            </div>

            <div className="space-y-3">
              {loading ? (
                <div className="py-10 flex justify-center"><div className="w-6 h-6 border-2 border-brand-blue border-t-transparent rounded-full animate-spin"></div></div>
              ) : shiftsToday.length === 0 ? (
                <EmptyState icon={ClockIcon} title="No shifts defined" description="Create shift definitions to see them visualized here." />
                ) : (
                filteredShifts.map((s) => {
                  const startMin = hhmmToMinutes(s.start);
                  const endMin = hhmmToMinutes(s.end);
                  const left = startMin == null ? 0 : minutesToPercent(startMin);
                  const width = (startMin == null || endMin == null) ? 0 : ((endMin > startMin) ? minutesToPercent(endMin - startMin) : minutesToPercent((24*60 - startMin) + endMin));
                  return (
                    <div key={s.id} className="p-3 rounded border dark:border-slate-700 bg-transparent">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-3">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                          <div className="font-medium">{s.name}</div>
                        </div>
                        <div className="text-sm text-slate-400">{(s.start || '-') } — {(s.end || '-')}</div>
                      </div>

                      <div className="relative h-8 bg-slate-900 rounded overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.03)' }}>
                        <div className="absolute inset-0 grid grid-cols-24 text-[10px] text-slate-700 opacity-30">
                          {Array.from({ length: 24 }).map((_, i) => (
                            <div key={i} className="h-full border-r" style={{ borderRight: '1px solid rgba(255,255,255,0.03)' }}></div>
                          ))}
                        </div>
                        {width > 0 ? (
                          <div
                            onMouseMove={(e) => {
                              const assigned = assignmentsForDate.filter(a => String(a.shiftId) === String(s.id));
                              const names = assigned.map(a => {
                                const emp = employees.find(e => String(e.id) === String(a.employeeId)) || {};
                                return emp.name || String(a.employeeId);
                              });
                              const lines = [];
                              lines.push(`${s.name} — ${s.start || '-'}–${s.end || '-'} • ${names.length} assigned`);
                              const cap = 8;
                              names.slice(0, cap).forEach(n => lines.push(n));
                              if (names.length > cap) lines.push(`+${names.length - cap} more`);
                              setTooltip({ visible: true, x: e.clientX + 12, y: e.clientY + 6, lines });
                            }}
                            onMouseLeave={() => setTooltip({ visible: false, x: 0, y: 0, lines: [] })}
                            title={`${s.name} ${s.start || ''}–${s.end || ''}`}
                            style={{ left: `${left}%`, width: `${width}%` }}
                            className="absolute h-full rounded shift-bar cursor-pointer"
                          />
                        ) : (
                          <div className="absolute left-2 top-1 text-xs text-slate-500">Timing not defined</div>
                        )}
                      </div>

                      <style jsx>{`
                        .shift-bar { background: linear-gradient(90deg, ${s.color}22, ${s.color}); box-shadow: 0 1px 4px rgba(0,0,0,0.4); }
                      `}</style>
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          {tooltip.visible && (
            <div style={{ position: 'fixed', left: tooltip.x, top: tooltip.y, zIndex: 50 }} className="pointer-events-none">
              <div className="bg-slate-800 text-slate-100 px-3 py-2 rounded shadow-md text-sm space-y-0.5">
                {(tooltip.lines || []).map((l, i) => <div key={i}>{l}</div>)}
              </div>
            </div>
          )}

          <Card className="mt-4">
            <h3 className="text-lg font-semibold mb-3">Assignments (selected date)</h3>
            <div className="flex items-center justify-end mb-2 space-x-2">
              <button onClick={exportAssignmentsCSV} className="px-3 py-1 bg-slate-700 text-foreground rounded text-sm">Export CSV</button>
              <button onClick={() => window.print()} className="px-3 py-1 border rounded text-sm">Print</button>
            </div>
            {assignmentsForDate.length === 0 ? (
              <EmptyState icon={CalendarDays} title="No assignments" description="No assignments found for the selected date." />
            ) : (
              <div className="space-y-2">
                {assignmentsForDate.map(a => {
                  const emp = employees.find(e => String(e.id) === String(a.employeeId)) || {};
                  const shift = shiftsToday.find(s => String(s.id) === String(a.shiftId)) || {};
                  const start = shift.start || '-';
                  const end = shift.end || '-';
                  return (
                    <div key={a.id} className="p-3 border rounded flex items-center justify-between dark:border-slate-700">
                      <div>
                        <div className="font-medium">{emp.name || `#${a.employeeId}`}</div>
                        <div className="text-sm text-slate-400">{shift.name || `#${a.shiftId}`} • {start}–{end}</div>
                      </div>
                      <div className="text-sm text-slate-400">{new Date(a.assigned_from || a.date || Date.now()).toLocaleDateString()}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        <div>
          <Card>
            <h3 className="text-lg font-semibold mb-3">Coverage (per hour)</h3>
            <div className="flex items-center space-x-3">
              <div className="w-10 flex flex-col items-start justify-between h-36 mr-2">
                <div className="text-sm text-slate-400">{maxCoverage}</div>
                <div className="text-xs text-slate-500">0</div>
              </div>

              <div className="flex-1 h-36 flex items-end space-x-1 px-1">
                {coverage.map((c, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center" title={`${String(i).padStart(2, '0')}:00 — ${c} shift${c === 1 ? '' : 's'}`}>
                    <div className="w-full bg-gradient-to-t from-slate-700 to-slate-500 rounded-t transition-all" style={{ height: `${(c / maxCoverage) * 100}%` }} />
                    <div className="text-[10px] text-slate-400 mt-2">{i}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-3 text-sm text-slate-500">This chart shows how many shifts cover each hour of the day.</div>
          </Card>
        </div>
      </div>
    </div>
  );
}