import { PageHeader } from "../components/PageHeader";
import Card from "../components/Card";
import Link from "next/link";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import Papa from 'papaparse';
import { listEmployees, deleteEmployee, listDepartments, createEmployee } from "../lib/api";

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState([]);
  const [importing, setImporting] = useState(false);

  // Filters
  const [query, setQuery] = useState("");
  const [filterDept, setFilterDept] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  useEffect(() => {
    let mounted = true;
    async function fetch() {
      try {
        const [emps, deps] = await Promise.all([listEmployees(), listDepartments().catch(()=>[])]);
        if (mounted) setEmployees(emps || []);
        if (mounted) setDepartments(Array.isArray(deps) ? deps : []);
      } catch (e) {
        console.error("Failed to fetch employees or departments", e);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    fetch();
    // open websocket for realtime updates with reconnect (no page reload)
    const base = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8080'
    const wsProto = base.startsWith('https') ? 'wss' : 'ws'
    const wsUrl = `${wsProto}://${base.replace(/^https?:\/\//, '')}/api/employees/ws`

    let ws = null
    let reconnectTimer = null
    let retry = 0
    let shouldReconnect = true

    function handleMessage(evt) {
      try {
        const msg = JSON.parse(evt.data)
        if (msg.type === 'deleted') {
          setEmployees(prev => prev.filter(e => e.id !== msg.id))
        } else if (msg.type === 'upsert' && msg.employee) {
          setEmployees(prev => {
            const idx = prev.findIndex(p => p.id === msg.employee.id)
            if (idx === -1) return [msg.employee, ...prev]
            const copy = [...prev]
            copy[idx] = msg.employee
            return copy
          })
        }
      } catch (e) { console.error('ws message parse', e) }
    }

    function connect() {
      try {
        ws = new WebSocket(wsUrl)
      } catch (e) {
        scheduleReconnect()
        return
      }

      ws.onopen = () => {
        retry = 0
      }

      ws.onmessage = handleMessage

      ws.onclose = () => {
        if (!shouldReconnect) return
        scheduleReconnect()
      }

      ws.onerror = (err) => {
        try { ws.close() } catch (e) {}
      }
    }

    function scheduleReconnect() {
      const delay = Math.min(30000, 1000 * Math.pow(2, retry))
      reconnectTimer = setTimeout(() => {
        retry = Math.min(10, retry + 1)
        connect()
      }, delay)
    }

    try { connect() } catch (e) { console.warn('Realtime websocket unavailable', e) }

    return () => {
      mounted = false
      shouldReconnect = false
      try { if (reconnectTimer) clearTimeout(reconnectTimer) } catch (e) {}
      try { if (ws) ws.close() } catch (e) {}
    }
  }, []);

  const [deleting, setDeleting] = useState(null);

  async function handleDelete(id) {
    if (!confirm("Delete this employee?\n\nThis will also delete all facial templates and attendance records.")) return;
    setDeleting(id);
    try {
      const result = await deleteEmployee(id);
      setEmployees((prev) => prev.filter((e) => e.id !== id));
      alert("Employee deleted successfully along with all related data (facial templates, attendance records, shift assignments)");
    } catch (err) {
      console.error("Delete failed", err);
      alert(`Failed to delete employee: ${err.response?.data?.detail || err.message}`);
    } finally {
      setDeleting(null);
    }
  }

  // derived filtered list (client-side)
  const filtered = employees.filter(emp => {
    if (query) {
      const q = query.toLowerCase();
      const inName = (emp.name || emp.username || "").toLowerCase().includes(q);
      const inEmail = (emp.email || "").toLowerCase().includes(q);
      const inCode = (emp.employee_code || "").toLowerCase().includes(q);
      if (!(inName || inEmail || inCode)) return false;
    }
    if (filterDept) {
      // employees may have department or department_id
      const deptId = emp.department?.id || emp.department_id || emp.department;
      if (!deptId || String(deptId) !== String(filterDept)) return false;
    }
    if (filterRole) {
      // allow partial/substring matches for role (case-insensitive)
      const roleText = (emp.role || "").toLowerCase();
      const want = String(filterRole).toLowerCase();
      if (!roleText.includes(want)) return false;
    }
    if (filterStatus) {
      if (!emp.status_flag || String(emp.status_flag).toLowerCase() !== String(filterStatus).toLowerCase()) return false;
    }
    return true;
  });

  return (
    <>
      <PageHeader
        title="Employees"
        subtitle="Manage team members"
        actions={
          <>
            <Link href="/employees/add">
              <button className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded">
                <Plus className="w-4 h-4" /> Add Employee
              </button>
            </Link>
            <label htmlFor="employee-import" className="px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded cursor-pointer">
              {importing ? 'Importing…' : 'Import File'}
            </label>
            <input id="employee-import" type="file" accept="text/csv" className="hidden" onChange={async (e) => {
              const f = e.target.files && e.target.files[0]
              if (!f) return
              setImporting(true)
              try {
                const text = await f.text()
                // Use PapaParse for robust CSV parsing (header row expected)
                const parsed = Papa.parse(text, { header: true, skipEmptyLines: true })
                if (parsed.errors && parsed.errors.length) {
                  console.warn('CSV parse warnings/errors', parsed.errors)
                }
                const rows = parsed.data || []

                // helper to map department value -> id (allow name or id)
                const findDeptId = (val) => {
                  if (!val) return null
                  const foundById = departments.find(d => String(d.id) === String(val) || String(d.department_id) === String(val))
                  if (foundById) return foundById.id ?? foundById.department_id
                  const foundByName = departments.find(d => String(d.name).toLowerCase() === String(val).toLowerCase() || String(d.department_name).toLowerCase() === String(val).toLowerCase())
                  if (foundByName) return foundByName.id ?? foundByName.department_id
                  return null
                }

                // create each employee sequentially
                let created = 0
                for (const r of rows) {
                  const payload = {
                    id: r.employee_code || undefined,
                    employee_code: r.employee_code || r.id || undefined,
                    name: r.name || r.full_name || r.username || null,
                    status_flag: r.status_flag || r.status || 'active',
                    email: r.email || null,
                    phone: r.phone || null,
                    role: r.role || null,
                    department_id: findDeptId(r.department || r.department_id || r.department_name) || null,
                    site_id: r.site_id || null,
                    zone_id: r.zone_id || null,
                    external_employee_id: r.external_employee_id || null,
                  }
                  try {
                    await createEmployee(payload)
                    created++
                  } catch (err) {
                    console.error('Failed to create row', payload, err)
                  }
                }
                alert(`Import complete: ${created} created`)
                const emps = await listEmployees()
                setEmployees(emps || [])
              } catch (err) {
                console.error('Import failed', err)
                alert('Import failed: ' + (err.message || err))
              } finally {
                setImporting(false)
                e.target.value = ''
              }
            }} />
          </>
        }
      />

      <Card>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name, email or code" className="px-3 py-2 rounded bg-slate-900/50 text-sm w-60" />
            <select value={filterDept} onChange={e=>setFilterDept(e.target.value)} className="px-3 py-2 rounded bg-slate-900/50 text-sm">
              <option value="">All Departments</option>
              {departments.map(d=> (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <input value={filterRole} onChange={e=>setFilterRole(e.target.value)} placeholder="Role (e.g. admin)" className="px-3 py-2 rounded bg-slate-900/50 text-sm w-40" />
            <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} className="px-3 py-2 rounded bg-slate-900/50 text-sm">
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="disabled">Disabled</option>
            </select>
            <button onClick={()=>{ setQuery(''); setFilterDept(''); setFilterRole(''); setFilterStatus(''); }} className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded">Reset</button>
            <div className="ml-auto text-slate-400 text-sm">Showing {filtered.length} / {employees.length}</div>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-sm table-fixed">
            <thead className="text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-2 w-[20%] text-left">Name</th>
                <th className="w-[14%] text-left">Department</th>
                <th className="w-[18%] text-left">Email</th>
                <th className="w-[12%] text-left">Phone</th>
                <th className="w-[14%] text-left">Role</th>
                <th className="w-[12%] text-left">Emp Code</th>
                <th className="w-[8%] text-left">Status</th>
                <th className="w-[16%] text-left">Actions</th>
              </tr>
            </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan="8" className="py-12 text-center text-slate-500">
                  Loading employees...
                </td>
              </tr>
            ) : filtered && filtered.length > 0 ? (
              filtered.map((emp) => (
                <tr key={emp.id} className="even:bg-slate-900/20">
                  <td className="py-3">{emp.name || emp.username || emp.id}</td>
                  <td className="truncate">{(() => {
                    // Prefer embedded department object name, then department_name,
                    // then lookup by id from fetched `departments`, then raw value.
                    if (emp.department && typeof emp.department === 'object' && emp.department.name) return emp.department.name;
                    if (emp.department_name) return emp.department_name;
                    // dept id could be in department_id or department
                    const deptId = emp.department?.id || emp.department_id || emp.department;
                    if (deptId && Array.isArray(departments) && departments.length > 0) {
                      const found = departments.find(d => String(d.id) === String(deptId));
                      if (found) return found.name;
                    }
                    // fallback to raw value or dash
                    return emp.department || "-";
                  })()}</td>
                  <td className="truncate">{emp.email || "-"}</td>
                  <td className="truncate">{emp.phone || "-"}</td>
                  <td className="truncate">{emp.role || "-"}</td>
                  <td className="truncate">{emp.employee_code || "-"}</td>
                  <td className="truncate">{emp.status_flag || "-"}</td>
                  <td className="whitespace-nowrap">
                    <div className="inline-flex items-center gap-2">
                      <Link href={`/employees/${emp.id}`}>
                            <button className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded">View</button>
                      </Link>
                          <Link href={`/employees/edit/${emp.id}`}>
                            <button className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded">Edit</button>
                          </Link>
                      <button 
                        onClick={() => handleDelete(emp.id)} 
                        disabled={deleting === emp.id}
                        className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {deleting === emp.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="8" className="py-12 text-center text-slate-500">
                  No employees found. Click <span className="text-blue-400">"Add Employee"</span> to add your first team member.
                </td>
              </tr>
            )}
          </tbody>
        </table>
          </div>
        </div>
      </Card>
    </>
  );
}
