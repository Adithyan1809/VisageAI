import axios from 'axios';
import { useState, useEffect, useMemo } from "react";
import { PageHeader } from "../components/PageHeader";
import Card from "../components/Card";
import Button from "../components/Button";
import { FileText, BarChart2, Download, Trash2, Clock, PlusCircle, Calendar } from "lucide-react";
import { toast } from 'sonner';
import EmptyState from '../components/EmptyState';
import { useAuth } from '../lib/auth';

function isoDate(d = null) {
  const dt = d ? new Date(d) : new Date();
  return dt.toISOString().split('T')[0];
}

export default function Reports() {
  const [startDate, setStartDate] = useState(isoDate());
  const [endDate, setEndDate] = useState(isoDate());
  const [template, setTemplate] = useState('attendance_summary');
  const [format, setFormat] = useState('csv');
  const [recentReports, setRecentReports] = useState([]);
  const [scheduled, setScheduled] = useState([]);
  const [scheduleRecurrence, setScheduleRecurrence] = useState('daily');
  const [scheduleTime, setScheduleTime] = useState('08:00');
  const [totalEmployees, setTotalEmployees] = useState(0);
  const [presentCount, setPresentCount] = useState(0);
  const [absentCount, setAbsentCount] = useState(0);
  const [departmentsMap, setDepartmentsMap] = useState({});
  const [chartData, setChartData] = useState([]);

  useEffect(() => {
    try { const r = localStorage.getItem('smap_recent_reports'); if (r) setRecentReports(JSON.parse(r)); } catch (e) {}
    try { const s = localStorage.getItem('smap_scheduled_reports'); if (s) setScheduled(JSON.parse(s)); } catch (e) {}
  }, []);

  useEffect(() => { try { localStorage.setItem('smap_recent_reports', JSON.stringify(recentReports)); } catch(e){} }, [recentReports]);
  useEffect(() => { try { localStorage.setItem('smap_scheduled_reports', JSON.stringify(scheduled)); } catch(e){} }, [scheduled]);

  // Load live KPIs and chart data from backend and poll every 15s
  useEffect(() => {
    let mounted = true;
    const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8080';

    async function loadAll() {
      try {
        const [empsRes, deptsRes] = await Promise.all([
          axios.get(`${API_BASE}/api/employees`),
          axios.get(`${API_BASE}/api/organization/departments`),
        ]);
        const emps = empsRes.status === 200 ? empsRes.data : [];
        const depts = deptsRes.status === 200 ? deptsRes.data : [];

        if (!mounted) return;
        setTotalEmployees(Array.isArray(emps) ? emps.length : 0);

        const deptMap = {};
        (depts || []).forEach(d => { deptMap[d.id] = d.name || d.id; });
        setDepartmentsMap(deptMap);

        // fetch attendance events covering the selected date range (use hours window)
        const start = new Date(startDate + 'T00:00:00Z');
        const end = new Date(endDate + 'T23:59:59Z');
        const now = new Date();
        const hoursBack = Math.max(24, Math.ceil((now - start) / (1000 * 60 * 60)));
        const evRes = await axios.get(`${API_BASE}/api/attendance/recent?hours=${hoursBack}&limit=5000`);
        const events = evRes.status === 200 ? evRes.data : [];

        const evFiltered = (events || []).filter(e => {
          const t = e.time || e.event_time || e.time;
          if (!t) return false;
          const dt = new Date(t);
          return dt >= start && dt <= end;
        });

        const presentSet = new Set(evFiltered.map(e => String(e.employee_id || e.employeeId || e.employee)));
        const present = presentSet.size;
        const total = Array.isArray(emps) ? emps.length : 0;
        const absent = Math.max(0, total - present);
        setPresentCount(present);
        setAbsentCount(absent);

        // build department chart: count present per department
        const byDept = {};
        (emps || []).forEach(emp => {
          const deptId = emp.department_id || emp.department || 'unknown';
          if (!byDept[deptId]) byDept[deptId] = { name: deptMap[deptId] || deptId, present: 0 };
          if (presentSet.has(String(emp.id))) byDept[deptId].present += 1;
        });

        const chart = Object.entries(byDept).map(([id, v]) => [v.name, v.present]);
        setChartData(chart);
      } catch (err) {
        // ignore load failure
      }
    }

    loadAll();
    const t = setInterval(loadAll, 15_000);
    return () => { mounted = false; clearInterval(t); };
  }, [startDate, endDate]);

  const templates = [
    { id: 'attendance_summary', name: 'Attendance Summary' },
    { id: 'daily_clockins', name: 'Daily Clock-ins' },
    { id: 'shift_coverage', name: 'Shift Coverage' },
  ];

  function downloadBlob(name, contents, mime='text/csv') {
    const blob = new Blob([contents], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  function generatePlaceholder() {
    // small histogram-style CSV sample depending on template
    if (template === 'attendance_summary') {
      return 'department,present,absent\nEngineering,12,3\nSales,8,1\nHR,4,0\n';
    }
    if (template === 'daily_clockins') {
      return 'employee,checkin,checkout\nGurucharan,09:01,17:02\nShivani,09:12,17:10\nSiri,08:58,16:59\n';
    }
    return 'shift,coverage_percent\nMorning,80\nEvening,70\nNight,50\n';
  }

  function generateNow() {
    // Build real data-backed reports by querying backend APIs
    const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8080';
    const filename = `report_${template}_${startDate}_${endDate}.${format}`;

    async function fetchJSON(path, params = '') {
      const url = `${API_BASE}${path}${params}`;
      const res = await axios.get(url);
      if (res.status !== 200) throw new Error(`API error ${res.status} ${url}`);
      return res.data;
    }

    (async () => {
      try {
        // compute cutoff hours to fetch recent attendance
        const start = new Date(startDate + 'T00:00:00Z');
        const end = new Date(endDate + 'T23:59:59Z');
        const now = new Date();
        const hoursBack = Math.ceil((now - start) / (1000 * 60 * 60));

        if (template === 'attendance_summary') {
          const [employees, events] = await Promise.all([
            fetchJSON('/api/employees'),
            fetchJSON(`/api/attendance/recent?hours=${hoursBack}&limit=5000`),
          ]);

          // filter events to date range
          const evFiltered = events.filter(e => {
            const t = e.time || e.event_time || e.time;
            if (!t) return false;
            const dt = new Date(t);
            return dt >= start && dt <= end;
          });

          const seen = new Set(evFiltered.map(e => String(e.employee_id || e.employeeId || e.employee)));

          // group employees by department_id
          const byDept = {};
          employees.forEach(emp => {
            const dept = emp.department_id || emp.department || 'unknown';
            byDept[dept] = byDept[dept] || { total: 0, present: 0 };
            byDept[dept].total += 1;
            if (seen.has(String(emp.id))) byDept[dept].present += 1;
          });

          const rows = ["department,total,present,absent"];
          Object.entries(byDept).forEach(([dept, v]) => {
            rows.push([dept, v.total, v.present, v.total - v.present].join(','));
          });
          const csv = rows.join('\n');
          downloadBlob(filename, csv, 'text/csv');
          setRecentReports(prev => [{ id: Date.now(), title: `${templates.find(t=>t.id===template)?.name || template} ${startDate}→${endDate}`, filename, created_at: new Date().toISOString() }, ...prev].slice(0,12));
          toast.success('Report generated successfully');
          return;
        }

        if (template === 'daily_clockins') {
          const events = await fetchJSON(`/api/attendance/recent?hours=${hoursBack}&limit=5000`);
          const evFiltered = events.filter(e => {
            const t = e.time || e.event_time || e.time;
            if (!t) return false;
            const dt = new Date(t);
            return dt >= start && dt <= end;
          });

          // Output each event as a row employee_name,event_time,event_type
          const rows = ["employee,datetime,event_type"];
          evFiltered.forEach(ev => {
            const name = ev.employee_name || ev.employee || ev.employeeId || ev.employee_id || '';
            const t = ev.time || ev.event_time || '';
            const et = ev.event_type || ev.type || '';
            rows.push([`"${String(name).replace(/"/g,'""') }"`, t, et].join(','));
          });
          const csv = rows.join('\n');
          downloadBlob(filename, csv, 'text/csv');
          setRecentReports(prev => [{ id: Date.now(), title: `${templates.find(t=>t.id===template)?.name || template} ${startDate}→${endDate}`, filename, created_at: new Date().toISOString() }, ...prev].slice(0,12));
          toast.success('Report generated successfully');
          return;
        }

        if (template === 'shift_coverage') {
          const [shifts, assignments] = await Promise.all([
            fetchJSON('/api/shifts'),
            fetchJSON('/api/assignments'),
          ]);

          // count assignments within date range
          const rows = ["shift_id,shift_name,assignments_count"];
          shifts.forEach(s => {
            const cnt = assignments.filter(a => String(a.shiftId) === String(s.id) && (a.assigned_from ? (new Date(a.assigned_from) >= start && new Date(a.assigned_from) <= end) : true)).length;
            rows.push([s.id, `"${(s.name||'').replace(/"/g,'""') }"`, cnt].join(','));
          });
          const csv = rows.join('\n');
          downloadBlob(filename, csv, 'text/csv');
          setRecentReports(prev => [{ id: Date.now(), title: `${templates.find(t=>t.id===template)?.name || template} ${startDate}→${endDate}`, filename, created_at: new Date().toISOString() }, ...prev].slice(0,12));
          toast.success('Report generated successfully');
          return;
        }
      } catch (err) {
        toast.error('Failed to generate report: ' + (err.message || err));
      }
    })();
  }

  function scheduleReport() {
    const entry = { id: Date.now(), template, recurrence: scheduleRecurrence, time: scheduleTime, enabled: true, created_at: new Date().toISOString() };
    setScheduled(prev => [entry, ...prev]);
    toast.success('Report scheduled');
  }

  function toggleScheduled(id) { setScheduled(prev => prev.map(s => s.id===id ? { ...s, enabled: !s.enabled } : s)); }
  function removeScheduled(id) { setScheduled(prev => prev.filter(s => s.id!==id)); }

  // chartData is populated from live backend in useEffect above

  function downloadRecent(r) {
    const contents = `Report: ${r.title}\nGenerated: ${r.created_at}\n(Placeholder)`;
    downloadBlob(r.filename || `report_${r.id}.txt`, contents, 'text/plain');
  }

  function clearRecent() { setRecentReports([]); }

  const _chartMax = Math.max(1, ...(chartData.map(x => x[1] || 0)));

  const { user, loading: authLoading } = useAuth();
  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-400" /></div>;
  if (!user) return null;

  return (
    <>
      <PageHeader title="Reports" subtitle="Generate attendance, shift, and performance reports" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <Card>
              <div className="text-sm text-slate-400">Total Employees</div>
              <div className="text-2xl font-bold mt-2">{totalEmployees}</div>
            </Card>
            <Card>
              <div className="text-sm text-slate-400">Present ({startDate})</div>
              <div className="text-2xl font-bold mt-2 text-green-400">{presentCount}</div>
            </Card>
            <Card>
              <div className="text-sm text-slate-400">Absentees</div>
              <div className="text-2xl font-bold mt-2 text-red-400">{absentCount}</div>
            </Card>
          </div>

          <Card className="p-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-lg font-semibold">Create / Preview Report</div>
                <div className="text-sm text-slate-400">Choose a template, date range, and generate or schedule reports.</div>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-400">Live data from database — updates every 15s</div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
              <div>
                <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-2 block">Template</label>
                <select value={template} onChange={(e)=>setTemplate(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-black/40 border border-glass-border text-white outline-none appearance-none">
                  {templates.map(t=> <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-2 block">From</label>
                <input type="date" value={startDate} onChange={(e)=>setStartDate(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-black/40 border border-glass-border text-white outline-none" />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-2 block">To</label>
                <input type="date" value={endDate} onChange={(e)=>setEndDate(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-black/40 border border-glass-border text-white outline-none" />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-2 block">Format</label>
                <select value={format} onChange={(e)=>setFormat(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-black/40 border border-glass-border text-white outline-none appearance-none">
                  <option value="csv">CSV</option>
                  <option value="pdf">PDF</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-slate-400" />
                <div className="text-sm text-slate-400 font-medium">Schedule: </div>
                <select value={scheduleRecurrence} onChange={(e)=>setScheduleRecurrence(e.target.value)} className="px-4 py-2 rounded-xl bg-black/40 border border-glass-border text-white text-sm appearance-none outline-none">
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
                <input type="time" value={scheduleTime} onChange={(e)=>setScheduleTime(e.target.value)} className="ml-2 px-4 py-2 rounded-xl bg-black/40 border border-glass-border text-white outline-none" />
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={()=>scheduleReport()}><PlusCircle className="w-4 h-4 mr-2" />Schedule</Button>
                <Button onClick={generateNow}><FileText className="w-4 h-4 mr-2" />Generate</Button>
              </div>
            </div>
          </Card>

          <Card className="p-6 mt-6">
            <div className="flex items-center justify-between mb-3">
              <div className="text-lg font-semibold">Department Attendance</div>
              <div className="text-sm text-slate-400">Snapshot</div>
            </div>

            <div className="space-y-2">
              {chartData.map((c, idx) => {
                const label = c[0]; const val = c[1] || 0; const pct = Math.min(100, (val / _chartMax) * 100);
                return (
                  <div key={idx} className="flex items-center space-x-3">
                    <div className="w-32 text-sm text-slate-400">{label}</div>
                    <div className="flex-1 bg-slate-900 rounded h-4 overflow-hidden">
                      <div style={{ width: `${pct}%` }} className="h-4 bg-gradient-to-r from-blue-600 to-sky-400" />
                    </div>
                    <div className="w-12 text-right text-sm text-slate-300">{val}</div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div>
          <Card className="p-6">
            <div className="flex items-center justify-between mb-3">
              <div className="text-lg font-semibold">Scheduled Reports</div>
              <div className="text-sm text-slate-400">Local only</div>
            </div>

            {scheduled.length === 0 ? (
              <EmptyState icon={Calendar} title="No scheduled reports" description="Use Schedule above to set up automated reports." />
            ) : (
              <div className="space-y-2">
                {scheduled.map(s => (
                  <div key={s.id} className="flex items-center justify-between p-2 rounded border dark:border-slate-700">
                    <div>
                      <div className="font-medium text-sm">{templates.find(t=>t.id===s.template)?.name || s.template}</div>
                      <div className="text-xs text-slate-400">{s.recurrence} @ {s.time}</div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button onClick={()=>toggleScheduled(s.id)} className={`px-2 py-1 rounded border ${s.enabled ? 'bg-green-600 text-white' : ''}`}>{s.enabled ? 'On' : 'Off'}</button>
                      <button onClick={()=>removeScheduled(s.id)} className="px-2 py-1 rounded border text-red-400">Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-6 mt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-lg font-semibold">Recent Reports</div>
              <div className="text-sm text-slate-400">Saved locally</div>
            </div>

            {recentReports.length === 0 ? (
              <EmptyState icon={FileText} title="No reports yet" description="Generate one to see it here." />
            ) : (
              <div className="space-y-2">
                {recentReports.map(r => (
                  <div key={r.id} className="flex items-center justify-between p-2 rounded border dark:border-slate-700">
                    <div>
                      <div className="font-medium text-sm">{r.title}</div>
                      <div className="text-xs text-slate-400">{new Date(r.created_at).toLocaleString()}</div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button title="Download" onClick={()=>downloadRecent(r)} className="px-2 py-1 rounded border"><Download className="w-4 h-4" /></button>
                      <button title="Remove" onClick={()=>setRecentReports(prev=>prev.filter(x=>x.id!==r.id))} className="px-2 py-1 rounded border text-red-400"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
                <div className="pt-2">
                  <button onClick={clearRecent} className="text-sm text-red-400">Clear all</button>
                </div>
              </div>
            )}
          </Card>

        </div>
      </div>
    </>
  );
}
