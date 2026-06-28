import axios from 'axios';
import { useState, useEffect, useRef } from "react";
import Card from "../components/Card";
import Button from "../components/Button";
import { BarChart3, Clock, Users, Plus, Edit, Trash2, CalendarDays } from "lucide-react";
import { toast } from 'sonner';
import EmptyState from '../components/EmptyState';
import { motion, AnimatePresence } from "framer-motion";
import Modal from "../components/Modal";
import Input from "../components/Input";
import Select from "../components/Select";
import { listShifts, listAssignments, listEmployees, createShift, updateShift, deleteShift, createAssignment, updateAssignment, deleteAssignment } from "../lib/api";
import { useAuth } from '../lib/auth';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080";

// Initial empty data - will be populated through the UI
const initialShifts = [];
const initialEmployees = [];

export default function Shifts() {
  const { user, accessToken, loading: authLoading } = useAuth();
  const [tab, setTab] = useState(0);

  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-400" /></div>;
  if (!user) return null;

  // Shift management state
  const [shifts, setShifts] = useState(initialShifts);
  const [employees, setEmployees] = useState(initialEmployees);
  const [assignments, setAssignments] = useState([]);
  const wsRef = useRef(null);
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [currentShift, setCurrentShift] = useState(null);
  const [shiftForm, setShiftForm] = useState({ name: '', startTime: '09:00', endTime: '17:00', color: '#3b82f6' });
  
  const [isAssignmentModalOpen, setIsAssignmentModalOpen] = useState(false);
  const [assignmentForm, setAssignmentForm] = useState({ employeeId: '', shiftId: '', date: new Date().toISOString().split('T')[0] });
  // Load initial data and subscribe to realtime updates
  useEffect(() => {
    let mounted = true;

    async function fetchAll() {
      try {
        const [s, a, e] = await Promise.all([listShifts(), listAssignments(), listEmployees()]);
        if (!mounted) return;
        setShifts(Array.isArray(s) ? s : []);
        setAssignments(Array.isArray(a) ? a : []);
        setEmployees(Array.isArray(e) ? e : []);
      } catch (err) {
        // ignore
      }
    }

    fetchAll();

    // WebSocket: reuse employees websocket; any DB change triggers refetch
    function setupWs() {
      try {
        const ws = new WebSocket(`${API_BASE.replace("http", "ws")}/api/employees/ws?token=${accessToken || ''}`);
        ws.onopen = () => {};
        ws.onmessage = () => {
          fetchAll();
        };
        ws.onclose = () => { if (mounted) setTimeout(setupWs, 2000); };
        ws.onerror = () => ws.close();
        wsRef.current = ws;
      } catch (e) {
        // ignore
      }
    }

    setupWs();

    const poll = setInterval(fetchAll, 5000);

    return () => {
      mounted = false;
      clearInterval(poll);
      try { wsRef.current && wsRef.current.close(); } catch (e) {}
    };
  }, [accessToken]);
  const tabs = [
    { label: "Attendance", icon: BarChart3 },
    { label: "Shift Definitions", icon: Clock },
    { label: "Shift Assignments", icon: Users },
  ];


  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-[1600px] mx-auto space-y-8">
      {/* Page Header */}
      <div>
        <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">Attendance &amp; Shifts</h2>
        <p className="text-muted mt-1">Manage attendance records, shift definitions, and employee shift assignments.</p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-black/30 border border-glass-border rounded-2xl p-1.5 w-fit">
        {tabs.map(({ label, icon: Icon }, i) => (
          <button
            key={label}
            onClick={() => setTab(i)}
            className={`relative flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
              tab === i
                ? "bg-brand-blue text-white shadow-glow-brand"
                : "text-muted hover:text-foreground hover:bg-white/5"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab Panels */}
      <AnimatePresence mode="wait">
        {tab === 0 && (
          <motion.div key="attendance" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card className="!p-0 overflow-hidden">
              <div className="px-6 py-4 border-b border-glass-border flex items-center gap-3">
                <BarChart3 className="w-5 h-5 text-brand-cyan" />
                <h3 className="text-base font-semibold text-foreground">Today's Attendance Stream</h3>
              </div>
              <AttendanceTable />
            </Card>
          </motion.div>
        )}

        {tab === 1 && (
          <motion.div key="shifts" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Shift Definitions</h3>
                <p className="text-sm text-muted">{shifts.length} shifts configured</p>
              </div>
              <Button onClick={() => { setCurrentShift(null); setShiftForm({ name: '', startTime: '09:00', endTime: '17:00', color: '#3b82f6' }); setIsShiftModalOpen(true); }} className="flex items-center gap-2">
                <Plus className="w-4 h-4" /> Create Shift
              </Button>
            </div>

            {shifts.length === 0 ? (
              <Card className="!p-0 border border-dashed border-glass-border">
                <EmptyState icon={Clock} title="No shifts defined yet" description="Create your first shift definition to get started." />
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {shifts.map((shift, i) => (
                  <motion.div key={shift.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.05 }}>
                    <Card className="group relative overflow-hidden hover:border-brand-blue/30 transition-colors">
                      <div className="absolute top-0 left-0 w-1 h-full rounded-l-xl" style={{ backgroundColor: shift.color || '#3b82f6' }} />
                      <div className="pl-4">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h4 className="font-bold text-foreground text-lg">{shift.name}</h4>
                            <div className="flex items-center gap-1.5 text-sm text-muted mt-1">
                              <Clock className="w-3.5 h-3.5" />
                              {shift.start_time || shift.startTime || '—'} → {shift.end_time || shift.endTime || '—'}
                            </div>
                          </div>
                          <div className="w-4 h-4 rounded-full border-2 border-glass-border" style={{ backgroundColor: shift.color }} />
                        </div>
                        <div className="flex items-center gap-2 pt-3 border-t border-glass-border">
                          <button onClick={() => { setCurrentShift(shift); setShiftForm({ name: shift.name, startTime: shift.start_time || shift.startTime, endTime: shift.end_time || shift.endTime, color: shift.color }); setIsShiftModalOpen(true); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-muted hover:text-foreground hover:bg-white/10 rounded-lg transition-all">
                            <Edit className="w-3.5 h-3.5" /> Edit
                          </button>
                          <button onClick={async () => { if (!window.confirm(`Delete "${shift.name}"?`)) return; try { await deleteShift(shift.id); setShifts(await listShifts()); toast.success('Shift deleted successfully'); } catch { toast.error('Failed to delete shift'); } }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-muted hover:text-danger hover:bg-danger/10 rounded-lg transition-all">
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                          </button>
                        </div>
                      </div>
                    </Card>
                  </motion.div>
                ))}
              </div>
            )}

            <Modal isOpen={isShiftModalOpen} onClose={() => setIsShiftModalOpen(false)} title={currentShift ? 'Edit Shift' : 'Create New Shift'}>
              <div className="space-y-4">
                <Input label="Shift Name" value={shiftForm.name} onChange={(e) => setShiftForm({...shiftForm, name: e.target.value})} placeholder="e.g., Morning Shift" required />
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Start Time</label>
                    <input type="time" value={shiftForm.startTime} onChange={(e) => setShiftForm({...shiftForm, startTime: e.target.value})} className="w-full px-4 py-3 rounded-xl bg-black/40 border border-glass-border text-foreground focus:ring-2 focus:ring-brand-blue outline-none" required />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">End Time</label>
                    <input type="time" value={shiftForm.endTime} onChange={(e) => setShiftForm({...shiftForm, endTime: e.target.value})} className="w-full px-4 py-3 rounded-xl bg-black/40 border border-glass-border text-foreground focus:ring-2 focus:ring-brand-blue outline-none" required />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Color</label>
                  <input type="color" value={shiftForm.color} onChange={(e) => setShiftForm({...shiftForm, color: e.target.value})} className="w-full h-12 rounded-xl border border-glass-border cursor-pointer" />
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <Button variant="secondary" onClick={() => setIsShiftModalOpen(false)}>Cancel</Button>
                  <Button onClick={() => { (async () => { try { if (currentShift) { await updateShift(currentShift.id, { name: shiftForm.name, start_time: shiftForm.startTime, end_time: shiftForm.endTime }); toast.success('Shift updated'); } else { await createShift({ id: String(Date.now()), name: shiftForm.name, start_time: shiftForm.startTime, end_time: shiftForm.endTime }); toast.success('Shift created'); } const updated = await listShifts(); setShifts(Array.isArray(updated) ? updated : []); setIsShiftModalOpen(false); } catch { toast.error('Failed to save shift'); } })(); }}>
                    {currentShift ? 'Update' : 'Create'} Shift
                  </Button>
                </div>
              </div>
            </Modal>
          </motion.div>
        )}

        {tab === 2 && (
          <motion.div key="assignments" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Shift Assignments</h3>
                <p className="text-sm text-muted">{assignments.length} active assignments</p>
              </div>
              <Button onClick={() => { const fe = employees?.[0]?.id || ''; const fs = shifts?.[0]?.id || ''; setAssignmentForm({ employeeId: fe, shiftId: fs, date: new Date().toISOString().split('T')[0] }); setIsAssignmentModalOpen(true); }} className="flex items-center gap-2">
                <Plus className="w-4 h-4" /> Assign Shift
              </Button>
            </div>

            {assignments.length === 0 ? (
              <Card className="!p-0 border border-dashed border-glass-border">
                <EmptyState icon={CalendarDays} title="No assignments yet" description="Assign shifts to employees to manage their schedule." />
              </Card>
            ) : (
              <Card className="!p-0 overflow-hidden">
                <table className="w-full text-left">
                  <thead className="border-b border-glass-border bg-black/20">
                    <tr className="text-xs uppercase tracking-wider font-semibold text-muted">
                      <th className="px-6 py-4">Employee</th>
                      <th className="px-4 py-4">Shift</th>
                      <th className="px-4 py-4">Time</th>
                      <th className="px-4 py-4">Date</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-glass-border/50">
                    {assignments.map((assignment, index) => {
                      const employee = employees.find(e => e.id === assignment.employeeId);
                      const shift = shifts.find(s => s.id === assignment.shiftId);
                      if (!employee || !shift) return null;
                      return (
                        <tr key={index} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-brand-blue/20 border border-brand-blue/30 flex items-center justify-center text-xs font-bold text-brand-cyan">
                                {(employee.name || '?').slice(0, 2).toUpperCase()}
                              </div>
                              <span className="text-sm font-semibold text-foreground">{employee.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: shift.color || '#3b82f6' }} />
                              <span className="text-sm text-foreground">{shift.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-sm text-muted">{shift.start_time || shift.startTime || '—'} – {shift.end_time || shift.endTime || '—'}</td>
                          <td className="px-4 py-4 text-sm text-muted">{assignment.date ? new Date(assignment.date).toLocaleDateString() : '—'}</td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2 justify-end">
                              <button onClick={() => { setAssignmentForm({ id: assignment.id, employeeId: assignment.employeeId, shiftId: assignment.shiftId, date: assignment.date }); setIsAssignmentModalOpen(true); }}
                                className="p-2 rounded-lg hover:bg-white/10 text-muted hover:text-foreground transition-all"><Edit className="w-4 h-4" /></button>
                              <button onClick={async () => { if (!confirm('Remove this assignment?')) return; try { await deleteAssignment(assignment.id); setAssignments(await listAssignments()); toast.success('Assignment removed'); } catch { toast.error('Failed to remove assignment'); } }}
                                className="p-2 rounded-lg hover:bg-danger/10 text-muted hover:text-danger transition-all"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            )}

            <Modal isOpen={isAssignmentModalOpen} onClose={() => setIsAssignmentModalOpen(false)} title={assignmentForm.id ? 'Edit Shift Assignment' : 'Assign Shift to Employee'}>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Employee</label>
                  <select value={assignmentForm.employeeId} onChange={(e) => setAssignmentForm({...assignmentForm, employeeId: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl bg-black/40 border border-glass-border text-foreground focus:ring-2 focus:ring-brand-blue outline-none appearance-none" required>
                    <option value="">Select an employee</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Shift</label>
                  <select value={assignmentForm.shiftId} onChange={(e) => setAssignmentForm({...assignmentForm, shiftId: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl bg-black/40 border border-glass-border text-foreground focus:ring-2 focus:ring-brand-blue outline-none appearance-none" required>
                    <option value="">Select a shift</option>
                    {shifts.map(s => <option key={s.id} value={s.id}>{s.name} ({s.start_time || s.startTime} – {s.end_time || s.endTime})</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Date</label>
                  <input type="date" value={assignmentForm.date} onChange={(e) => setAssignmentForm({...assignmentForm, date: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl bg-black/40 border border-glass-border text-foreground focus:ring-2 focus:ring-brand-blue outline-none" required />
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <Button variant="secondary" onClick={() => setIsAssignmentModalOpen(false)}>Cancel</Button>
                  <Button onClick={async () => { try { if (assignmentForm.id) { await updateAssignment(assignmentForm.id, { employeeId: assignmentForm.employeeId, shiftId: assignmentForm.shiftId, assigned_from: assignmentForm.date }); toast.success('Assignment updated'); } else { await createAssignment({ id: String(Date.now()), employeeId: assignmentForm.employeeId, shiftId: assignmentForm.shiftId, assigned_from: assignmentForm.date, is_active: true }); toast.success('Assignment created'); } setAssignments(await listAssignments()); setIsAssignmentModalOpen(false); } catch { toast.error('Failed to save assignment'); } }}
                    disabled={!assignmentForm.employeeId || !assignmentForm.shiftId || !assignmentForm.date}>
                    {assignmentForm.id ? 'Update' : 'Assign'} Shift
                  </Button>
                </div>
              </div>
            </Modal>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}


// Small component to fetch and render recent attendance (24h) in a simple table

// Small component to fetch and render recent attendance (24h) in a simple table
function AttendanceTable() {
  const [rows, setRows] = useState([]);
  const [employees, setEmployees] = useState([]);
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080";

  useEffect(() => {
    let mounted = true;
    async function fetchRecent() {
      try {
        // use the dev raw-SQL reader if available to avoid ORM mapper errors on the backend
        const res = await axios.get(`${API_BASE}/api/dev/attendance/recent?hours=24&limit=500`, { withCredentials: true });
        if (!mounted) return;
        if (res.status === 200) {
          const items = res.data;
          setRows(items || []);
        }
      } catch (e) {
        // ignore
      }
    }
    async function fetchEmployees() {
      try {
        const res = await axios.get(`${API_BASE}/api/employees`, { withCredentials: true });
        if (!mounted) return;
        if (res.status === 200) {
          const list = res.data;
          setEmployees(Array.isArray(list) ? list : []);
        }
      } catch (e) {
        // ignore
      }
    }
    fetchRecent();
    fetchEmployees();
    const poll = setInterval(fetchRecent, 10000);
    return () => { mounted = false; clearInterval(poll); };
  }, []);

  if (!rows.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted">
        <BarChart3 className="w-12 h-12 opacity-20 mb-4" />
        <p className="text-foreground font-semibold mb-1">No attendance records found</p>
        <p className="text-sm">Records from the last 24 hours will appear here.</p>
      </div>
    );
  }

  return (
    <div className="overflow-auto max-h-[600px]">
      <table className="w-full text-left">
        <thead className="bg-black/20 border-b border-glass-border sticky top-0">
          <tr className="text-xs uppercase tracking-wider font-semibold text-muted">
            <th className="px-6 py-4">Time</th>
            <th className="px-4 py-4">Employee</th>
            <th className="px-4 py-4">Camera</th>
            <th className="px-4 py-4">Type</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-glass-border/40">
          {rows.map((r, idx) => {
            const emp = employees.find(e => String(e.id) === String(r.employee_id));
            const displayName = emp?.name || r.employee_name || (r.employee_id ? `ID:${r.employee_id}` : 'Unknown');
            const initials = (displayName || '?').split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase();
            const isIn = (r.event_type || '').toLowerCase().includes('in') || r.event_type === 'face_recognized';
            return (
              <motion.tr
                key={r.id || idx}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, delay: Math.min(idx * 0.01, 0.3) }}
                className="hover:bg-white/[0.02] transition-colors"
              >
                <td className="px-6 py-3.5 text-sm text-muted whitespace-nowrap">{r.time ? new Date(r.time).toLocaleString() : '—'}</td>
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-brand-blue/20 border border-brand-blue/30 flex items-center justify-center text-xs font-bold text-brand-cyan shrink-0">
                      {initials}
                    </div>
                    <span className="text-sm font-semibold text-foreground">{displayName}</span>
                  </div>
                </td>
                <td className="px-4 py-3.5 text-sm font-mono text-brand-cyan/70">{r.camera_id || '—'}</td>
                <td className="px-4 py-3.5">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-full border ${
                    isIn ? 'bg-success/10 border-success/20 text-success' : 'bg-orange-400/10 border-orange-400/20 text-orange-400'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${isIn ? 'bg-success' : 'bg-orange-400'}`} />
                    {r.event_type || 'IN'}
                  </span>
                </td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
