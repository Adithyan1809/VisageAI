import { useState, useEffect, useRef } from "react";
import { PageHeader } from "../components/PageHeader";
import Card from "../components/Card";
import Button from "../components/Button";
import { Plus, Edit, Trash2, User, Clock, Check, X } from "lucide-react";
import Modal from "../components/Modal";
import Input from "../components/Input";
import Select from "../components/Select";
import { listShifts, listAssignments, listEmployees, createShift, updateShift, deleteShift, createAssignment, updateAssignment, deleteAssignment } from "../lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8081";

// Initial empty data - will be populated through the UI
const initialShifts = [];
const initialEmployees = [];

export default function Shifts() {
  const [tab, setTab] = useState(0);
  const tabs = ["Attendance", "Shift Definitions", "Shift Assignments"];
  
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
        const ws = new WebSocket(`${API_BASE}/api/employees/ws`);
        ws.onopen = () => {};
        ws.onmessage = () => {
          fetchAll();
        };
        ws.onclose = () => setTimeout(setupWs, 2000);
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
  }, []);
  return (
    <>
      <PageHeader
        title="Attendance & Shift Management"
        subtitle="Manage attendance, shift creation, and shift assignment"
      />

      <div className="flex gap-2 mb-4">
        {tabs.map((t, i) => (
          <button
            key={t}
            onClick={() => setTab(i)}
            className={`px-4 py-2 rounded-md text-sm transition-colors ${
              tab === i
                ? "bg-blue-600 text-white"
                : "text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-[#1e2228]"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 0 && (
        <Card>
          <div className="flex justify-between items-center mb-6">
            <div className="text-gray-600 dark:text-slate-400 text-sm">Today's Attendance</div>
          </div>

          <AttendanceTable />
        </Card>
      )}

      {tab === 1 && (
        <Card>
          <div className="flex justify-between items-center mb-6">
            <div className="text-gray-600 dark:text-slate-400 text-sm">Shift Definitions</div>
            <Button onClick={() => {
              setCurrentShift(null);
              setShiftForm({ name: '', startTime: '09:00', endTime: '17:00', color: '#3b82f6' });
              setIsShiftModalOpen(true);
            }}>
              <Plus className="w-4 h-4 mr-2" /> Create New Shift
            </Button>
          </div>
          
          {shifts.length === 0 ? (
            <div className="py-12 text-center text-gray-500 dark:text-slate-500">No shifts created yet.</div>
          ) : (
            <div className="space-y-4">
              {shifts.map(shift => (
                <div key={shift.id} className="flex items-center justify-between p-4 border rounded-lg dark:border-slate-700">
                  <div className="flex items-center">
                    <div className="w-3 h-3 rounded-full mr-3" style={{ backgroundColor: shift.color }} />
                    <div>
                      <div className="font-medium">{shift.name}</div>
                      <div className="text-sm text-gray-500 dark:text-slate-400">
                        {(shift.start_time || shift.startTime || '')} - {(shift.end_time || shift.endTime || '')}
                      </div>
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => {
                          setCurrentShift(shift);
                          setShiftForm({
                            name: shift.name,
                            startTime: shift.startTime,
                            endTime: shift.endTime,
                            color: shift.color
                          });
                          setIsShiftModalOpen(true);
                      }}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                      onClick={async () => {
                        if (!window.confirm(`Are you sure you want to delete the "${shift.name}" shift?`)) return;
                        try {
                          await deleteShift(shift.id);
                          setShifts(await listShifts());
                        } catch (e) {
                          console.error('Failed to delete shift', e);
                          alert('Failed to delete shift');
                        }
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Shift Form Modal */}
          <Modal
            isOpen={isShiftModalOpen}
            onClose={() => setIsShiftModalOpen(false)}
            title={currentShift ? 'Edit Shift' : 'Create New Shift'}
          >
            <div className="space-y-4">
              <Input
                label="Shift Name"
                value={shiftForm.name}
                onChange={(e) => setShiftForm({...shiftForm, name: e.target.value})}
                placeholder="e.g., Morning Shift"
                required
              />
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                    Start Time
                  </label>
                  <input
                    type="time"
                    value={shiftForm.startTime}
                    onChange={(e) => setShiftForm({...shiftForm, startTime: e.target.value})}
                    className="w-full px-3 py-2 border rounded-md dark:bg-slate-800 dark:border-slate-700"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                    End Time
                  </label>
                  <input
                    type="time"
                    value={shiftForm.endTime}
                    onChange={(e) => setShiftForm({...shiftForm, endTime: e.target.value})}
                    className="w-full px-3 py-2 border rounded-md dark:bg-slate-800 dark:border-slate-700"
                    required
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                  Color
                </label>
                <input
                  type="color"
                  value={shiftForm.color}
                  onChange={(e) => setShiftForm({...shiftForm, color: e.target.value})}
                  className="w-full h-10 rounded-md border dark:border-slate-700"
                />
              </div>
              
              <div className="flex justify-end space-x-2 pt-4">
                <Button variant="outline" onClick={() => setIsShiftModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    (async () => {
                      try {
                        if (currentShift) {
                          await updateShift(currentShift.id, {
                            name: shiftForm.name,
                            start_time: shiftForm.startTime,
                            end_time: shiftForm.endTime,
                            site_id: shiftForm.siteId || null,
                          });
                        } else {
                          await createShift({ id: String(Date.now()), name: shiftForm.name, start_time: shiftForm.startTime, end_time: shiftForm.endTime });
                        }
                        const s = await listShifts();
                        setShifts(Array.isArray(s) ? s : []);
                        setIsShiftModalOpen(false);
                      } catch (e) {
                        console.error('Failed to save shift', e);
                        alert('Failed to save shift');
                      }
                    })();
                  }}
                >
                  {currentShift ? 'Update' : 'Create'} Shift
                </Button>
              </div>
            </div>
          </Modal>
        </Card>
      )}

      {tab === 2 && (
        <Card>
          <div className="flex justify-between items-center mb-6">
            <div className="text-gray-600 dark:text-slate-400 text-sm">Shift Assignments</div>
            <Button
              variant="primary"
              className="flex items-center space-x-2"
              aria-label="Assign a shift"
              title="Assign a shift to an employee"
              onClick={() => {
                // Pre-fill the form with sensible defaults to reduce empty submissions
                const firstEmp = employees && employees.length ? employees[0].id : '';
                const firstShift = shifts && shifts.length ? shifts[0].id : '';
                setAssignmentForm({ employeeId: firstEmp, shiftId: firstShift, date: new Date().toISOString().split('T')[0] });
                setIsAssignmentModalOpen(true);
              }}
            >
              <span className="flex items-center">
                <Plus className="w-4 h-4 mr-2" />
                <span>Assign Shift</span>
              </span>
            </Button>
          </div>
          
          {assignments.length === 0 ? (
            <div className="py-12 text-center text-gray-500 dark:text-slate-500">
              No shift assignments yet. Click the "Assign Shift" button to get started.
            </div>
          ) : (
              <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                <thead className="bg-gray-50 dark:bg-slate-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">Employee</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">Shift</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">Shift ID</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">Time</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
                  {assignments.map((assignment, index) => {
                    const employee = employees.find(e => e.id === assignment.employeeId);
                    const shift = shifts.find(s => s.id === assignment.shiftId);
                    
                    if (!employee || !shift) return null;
                    
                    return (
                      <tr key={index}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-10 w-10 rounded-full bg-gray-200 dark:bg-slate-700 flex items-center justify-center">
                              <User className="h-5 w-5 text-gray-500 dark:text-slate-400" />
                            </div>
                            <div className="ml-4">
                              <div className="text-sm font-medium text-gray-900 dark:text-white">{employee.name}</div>
                              <div className="text-sm text-gray-500 dark:text-slate-400">{employee.position}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="h-3 w-3 rounded-full mr-2" style={{ backgroundColor: shift.color }} />
                            <span>{shift.name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-slate-400 font-mono">
                          {shift.id}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-slate-400">
                          {new Date(assignment.date).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-slate-400">
                          {(shift.start_time || shift.startTime || '')} - {(shift.end_time || shift.endTime || '')}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <button
                            onClick={() => {
                              setAssignmentForm({
                                id: assignment.id,
                                employeeId: assignment.employeeId,
                                shiftId: assignment.shiftId,
                                date: assignment.date
                              });
                              setIsAssignmentModalOpen(true);
                            }}
                            className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 mr-4"
                          >
                            Edit
                          </button>
                          <button
                            onClick={async () => {
                              if (!window.confirm('Are you sure you want to remove this shift assignment?')) return;
                              try {
                                await deleteAssignment(assignment.id);
                                setAssignments(await listAssignments());
                              } catch (e) {
                                console.error('Failed to delete assignment', e);
                                alert('Failed to delete assignment');
                              }
                            }}
                            className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Assignment Form Modal */}
          <Modal
            isOpen={isAssignmentModalOpen}
            onClose={() => setIsAssignmentModalOpen(false)}
            title={assignmentForm.id ? 'Edit Shift Assignment' : 'Assign Shift to Employee'}
          >
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                  Employee
                </label>
                <select
                  value={assignmentForm.employeeId}
                  onChange={(e) => setAssignmentForm({...assignmentForm, employeeId: e.target.value})}
                  className="w-full px-3 py-2 border rounded-md dark:bg-slate-800 dark:border-slate-700"
                  required
                >
                  <option value="">Select an employee</option>
                  {employees.map(employee => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name} ({employee.position})
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                  Shift
                </label>
                <select
                  value={assignmentForm.shiftId}
                  onChange={(e) => setAssignmentForm({...assignmentForm, shiftId: e.target.value})}
                  className="w-full px-3 py-2 border rounded-md dark:bg-slate-800 dark:border-slate-700"
                  required
                >
                  <option value="">Select a shift</option>
                  {shifts.map(shift => (
                    <option key={shift.id} value={shift.id}>
                      {shift.name} ({(shift.start_time || shift.startTime || '')} - {(shift.end_time || shift.endTime || '')})
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                  Date
                </label>
                <input
                  type="date"
                  value={assignmentForm.date}
                  onChange={(e) => setAssignmentForm({...assignmentForm, date: e.target.value})}
                  className="w-full px-3 py-2 border rounded-md dark:bg-slate-800 dark:border-slate-700"
                  required
                />
              </div>
              
              <div className="flex justify-end space-x-2 pt-4">
                <Button variant="outline" onClick={() => setIsAssignmentModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={async () => {
                    try {
                      if (assignmentForm.id) {
                        await updateAssignment(assignmentForm.id, {
                          employeeId: assignmentForm.employeeId,
                          shiftId: assignmentForm.shiftId,
                          assigned_from: assignmentForm.date,
                        });
                      } else {
                        await createAssignment({
                          id: String(Date.now()),
                          employeeId: assignmentForm.employeeId,
                          shiftId: assignmentForm.shiftId,
                          assigned_from: assignmentForm.date,
                          is_active: true
                        });
                      }
                      setAssignments(await listAssignments());
                      setIsAssignmentModalOpen(false);
                    } catch (e) {
                      console.error('Failed to save assignment', e);
                      alert('Failed to save assignment');
                    }
                  }}
                  disabled={!assignmentForm.employeeId || !assignmentForm.shiftId || !assignmentForm.date}
                >
                  {assignmentForm.id ? 'Update' : 'Assign'} Shift
                </Button>
              </div>
            </div>
          </Modal>
        </Card>
      )}
    </>
  );
}

// Small component to fetch and render recent attendance (24h) in a simple table
function AttendanceTable() {
  const [rows, setRows] = useState([]);
  const [employees, setEmployees] = useState([]);
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8081";

  useEffect(() => {
    let mounted = true;
    async function fetchRecent() {
      try {
        // use the dev raw-SQL reader if available to avoid ORM mapper errors on the backend
        const res = await fetch(`${API_BASE}/api/dev/attendance/recent?hours=24&limit=500`, { credentials: 'include' });
        if (!mounted) return;
        if (res.ok) {
          const items = await res.json();
          setRows(items || []);
        }
      } catch (e) {
        console.warn('Failed to fetch recent attendance', e);
      }
    }
    async function fetchEmployees() {
      try {
        const res = await fetch(`${API_BASE}/api/employees`, { credentials: 'include' });
        if (!mounted) return;
        if (res.ok) {
          const list = await res.json();
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
      <div className="py-12 text-center text-gray-500 dark:text-slate-500">No attendance records found.</div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="max-h-[560px] overflow-y-auto rounded-md border dark:border-slate-700">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
        <thead className="bg-gray-50 dark:bg-slate-800">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">Time</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">Employee</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">Camera</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">Type</th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
          {rows.map((r) => {
            const emp = employees.find(e => String(e.id) === String(r.employee_id));
            const displayName = emp?.name || r.employee_name || (r.employee_id ? `#${r.employee_id}` : 'unknown');
            const initials = (displayName || '').split(' ').filter(Boolean).slice(0,2).map(n => n[0]).join('').toUpperCase();
            return (
              <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-slate-900">
                <td className="px-6 py-3 whitespace-nowrap text-sm text-slate-400">{r.time ? new Date(r.time).toLocaleString() : '-'}</td>
                <td className="px-6 py-3 whitespace-nowrap text-sm font-medium">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 h-9 w-9 rounded-full bg-gray-200 dark:bg-slate-700 flex items-center justify-center mr-3">
                      <span className="text-xs font-semibold text-gray-700 dark:text-slate-200">{initials || 'U'}</span>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">{displayName}</div>
                      <div className="text-xs text-gray-500 dark:text-slate-400">{emp?.position || ''}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-3 whitespace-nowrap text-sm text-slate-400">{r.camera_id || '-'}</td>
                <td className="px-6 py-3 whitespace-nowrap text-sm text-slate-400">{r.event_type || 'face_recognized'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
