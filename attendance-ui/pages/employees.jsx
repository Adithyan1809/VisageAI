import Card from "../components/Card";
import Link from "next/link";
import { Users, Search, Plus, Upload, Trash2, Edit, Eye, X, ChevronDown } from "lucide-react";
import { toast } from 'sonner';
import EmptyState from '../components/EmptyState';
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Papa from 'papaparse';
import { listEmployees, deleteEmployee, listDepartments, createEmployee } from "../lib/api";
import { useAuth } from '../lib/auth';

function AvatarBubble({ name, size = "md" }) {
  const initials = (name || "?").split(" ").filter(Boolean).slice(0, 2).map(n => n[0]).join("").toUpperCase();
  const colors = ["from-brand-blue to-brand-cyan", "from-purple-500 to-indigo-500", "from-green-500 to-teal-500", "from-orange-500 to-amber-500", "from-pink-500 to-rose-500"];
  const colorIdx = (name || "?").charCodeAt(0) % colors.length;
  const sz = size === "sm" ? "w-8 h-8 text-xs" : "w-10 h-10 text-sm";
  return (
    <div className={`${sz} rounded-full bg-gradient-to-br ${colors[colorIdx]} flex items-center justify-center font-bold text-white shadow-md shrink-0`}>
      {initials}
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    active: { label: "Active", cls: "bg-success/10 text-success border-success/20" },
    inactive: { label: "Inactive", cls: "bg-yellow-400/10 text-yellow-400 border-yellow-400/20" },
    disabled: { label: "Disabled", cls: "bg-danger/10 text-danger border-danger/20" },
  };
  const s = map[status?.toLowerCase()] || { label: status || "—", cls: "bg-white/5 text-muted border-glass-border" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full border ${s.cls}`}>
      {status?.toLowerCase() === "active" && <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />}
      {s.label}
    </span>
  );
}

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState([]);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState(null);

  // Filters
  const [query, setQuery] = useState("");
  const [filterDept, setFilterDept] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  useEffect(() => {
    let mounted = true;
    async function fetchData() {
      try {
        const [emps, deps] = await Promise.all([listEmployees(), listDepartments().catch(() => [])]);
        if (mounted) setEmployees(emps || []);
        if (mounted) setDepartments(Array.isArray(deps) ? deps : []);
      } catch (e) {
        // ignore fetch failure
      } finally {
        if (mounted) setLoading(false);
      }
    }
    fetchData();

    const base = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8080';
    const wsProto = base.startsWith('https') ? 'wss' : 'ws';
    const wsUrl = `${wsProto}://${base.replace(/^https?:\/\//, '')}/api/employees/ws`;
    let ws = null, reconnectTimer = null, retry = 0, shouldReconnect = true;

    function handleMessage(evt) {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'deleted') {
          setEmployees(prev => prev.filter(e => e.id !== msg.id));
        } else if (msg.type === 'upsert' && msg.employee) {
          setEmployees(prev => {
            const idx = prev.findIndex(p => p.id === msg.employee.id);
            if (idx === -1) return [msg.employee, ...prev];
            const copy = [...prev]; copy[idx] = msg.employee; return copy;
          });
        }
      } catch (e) {}
    }

    function scheduleReconnect() {
      const delay = Math.min(30000, 1000 * Math.pow(2, retry));
      reconnectTimer = setTimeout(() => { retry = Math.min(10, retry + 1); connect(); }, delay);
    }

    function connect() {
      try { ws = new WebSocket(wsUrl); } catch { scheduleReconnect(); return; }
      ws.onopen = () => { retry = 0; };
      ws.onmessage = handleMessage;
      ws.onclose = () => { if (shouldReconnect) scheduleReconnect(); };
      ws.onerror = () => { try { ws.close(); } catch {} };
    }

    try { connect(); } catch {}

    return () => {
      mounted = false; shouldReconnect = false;
      try { if (reconnectTimer) clearTimeout(reconnectTimer); } catch {}
      try { if (ws) ws.close(); } catch {}
    };
  }, []);

  async function handleDelete(id) {
    if (!confirm("Delete this employee?\n\nThis will also delete all facial templates and attendance records.")) return;
    setDeleting(id);
    try {
      await deleteEmployee(id);
      setEmployees(prev => prev.filter(e => e.id !== id));
      toast.success('Employee deleted successfully');
    } catch (err) {
      toast.error(`Failed to delete employee: ${err.response?.data?.detail || err.message}`);
    } finally {
      setDeleting(null);
    }
  }

  const getDeptName = (emp) => {
    if (emp.department && typeof emp.department === 'object' && emp.department.name) return emp.department.name;
    if (emp.department_name) return emp.department_name;
    const deptId = emp.department?.id || emp.department_id || emp.department;
    if (deptId && Array.isArray(departments) && departments.length > 0) {
      const found = departments.find(d => String(d.id) === String(deptId));
      if (found) return found.name;
    }
    return null;
  };

  const filtered = employees.filter(emp => {
    if (query) {
      const q = query.toLowerCase();
      if (![(emp.name || emp.username || ""), (emp.email || ""), (emp.employee_code || "")].some(s => s.toLowerCase().includes(q))) return false;
    }
    if (filterDept) {
      const deptId = emp.department?.id || emp.department_id || emp.department;
      if (!deptId || String(deptId) !== String(filterDept)) return false;
    }
    if (filterRole && !(emp.role || "").toLowerCase().includes(filterRole.toLowerCase())) return false;
    if (filterStatus && (emp.status_flag || "").toLowerCase() !== filterStatus.toLowerCase()) return false;
    return true;
  });

  const hasFilters = query || filterDept || filterRole || filterStatus;

  const { user, loading: authLoading } = useAuth();
  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-400" /></div>;
  if (!user) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-[1600px] mx-auto space-y-8">
      
      {/* Page Header */}
      <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">Employee Directory</h2>
          <p className="text-muted mt-1">{employees.length} team members registered in the system.</p>
        </div>
        <div className="flex items-center gap-3">
          <label htmlFor="employee-import" className="inline-flex items-center gap-2 px-5 py-2.5 bg-glass-card border border-glass-border hover:border-white/20 text-white rounded-xl text-sm font-semibold cursor-pointer transition-all hover:scale-105 active:scale-95 backdrop-blur-md">
            <Upload className="w-4 h-4" /> {importing ? 'Importing…' : 'Import CSV'}
          </label>
          <input id="employee-import" type="file" accept="text/csv" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            setImporting(true);
            try {
              const text = await f.text();
              const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
              const rows = parsed.data || [];
              const findDeptId = (val) => {
                if (!val) return null;
                return (departments.find(d => String(d.id) === String(val) || (d.name || "").toLowerCase() === String(val).toLowerCase()))?.id || null;
              };
              let created = 0;
              for (const r of rows) {
                try {
                  await createEmployee({
                    employee_code: r.employee_code || r.id || undefined,
                    name: r.name || r.full_name || r.username || null,
                    status_flag: r.status_flag || r.status || 'active',
                    email: r.email || null, phone: r.phone || null, role: r.role || null,
                    department_id: findDeptId(r.department || r.department_id || r.department_name) || null,
                  });
                  created++;
                } catch {}
              }
              toast.success(`Import complete: ${created} created`);
              setEmployees(await listEmployees() || []);
            } catch (err) { toast.error('Import failed: ' + (err.message || err)); }
            finally { setImporting(false); e.target.value = ''; }
          }} />
          <Link href="/employees/add">
            <span className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-blue hover:bg-blue-500 text-white rounded-xl text-sm font-semibold shadow-glow-brand transition-all hover:scale-105 active:scale-95 cursor-pointer">
              <Plus className="w-4 h-4" /> Add Employee
            </span>
          </Link>
        </div>
      </div>

      {/* Search & Filters */}
      <Card className="!py-4 !px-6">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[220px] max-w-xs">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
            <input
              value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search name, email or code…"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-black/30 border border-glass-border text-white placeholder:text-muted text-sm focus:ring-2 focus:ring-brand-blue/50 focus:border-brand-blue outline-none transition-all"
            />
          </div>

          {/* Department Filter */}
          <div className="relative">
            <select value={filterDept} onChange={e => setFilterDept(e.target.value)}
              className="pl-4 pr-8 py-2.5 rounded-xl bg-black/30 border border-glass-border text-sm text-white appearance-none focus:ring-2 focus:ring-brand-blue/50 focus:border-brand-blue outline-none transition-all cursor-pointer">
              <option value="">All Departments</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
          </div>

          {/* Role Filter */}
          <input value={filterRole} onChange={e => setFilterRole(e.target.value)} placeholder="Filter by role…"
            className="px-4 py-2.5 rounded-xl bg-black/30 border border-glass-border text-white placeholder:text-muted text-sm w-36 focus:ring-2 focus:ring-brand-blue/50 focus:border-brand-blue outline-none transition-all" />

          {/* Status Filter */}
          <div className="relative">
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="pl-4 pr-8 py-2.5 rounded-xl bg-black/30 border border-glass-border text-sm text-white appearance-none focus:ring-2 focus:ring-brand-blue/50 focus:border-brand-blue outline-none transition-all cursor-pointer">
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="disabled">Disabled</option>
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
          </div>

          {hasFilters && (
            <button onClick={() => { setQuery(''); setFilterDept(''); setFilterRole(''); setFilterStatus(''); }}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm text-muted hover:text-white hover:bg-white/5 transition-all border border-glass-border">
              <X className="w-3.5 h-3.5" /> Clear
            </button>
          )}

          <div className="ml-auto text-sm text-muted font-medium">
            <span className="text-white font-semibold">{filtered.length}</span> / {employees.length} employees
          </div>
        </div>
      </Card>

      {/* Employee Table */}
      <Card className="!p-0 overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted">
            <div className="w-8 h-8 border-2 border-brand-blue/30 border-t-brand-blue rounded-full animate-spin mb-4" />
            Loading employees…
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState 
            icon={Users}
            title={hasFilters ? "No matching employees" : "No employees yet"}
            description={hasFilters ? "Try adjusting your filters." : "Click Add Employee to onboard your first team member."}
          />
        ) : (
          <table className="w-full text-left">
            <thead className="border-b border-glass-border bg-black/20">
              <tr className="text-xs uppercase tracking-wider font-semibold text-muted">
                <th className="px-6 py-4">Employee</th>
                <th className="px-4 py-4 hidden md:table-cell">Department</th>
                <th className="px-4 py-4 hidden lg:table-cell">Email</th>
                <th className="px-4 py-4 hidden xl:table-cell">Phone</th>
                <th className="px-4 py-4 hidden lg:table-cell">Role</th>
                <th className="px-4 py-4 hidden md:table-cell">Emp Code</th>
                <th className="px-4 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-glass-border/50">
              <AnimatePresence>
                {filtered.map((emp, i) => {
                  const name = emp.name || emp.username || emp.id;
                  const deptName = getDeptName(emp);
                  return (
                    <motion.tr
                      key={emp.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2, delay: i * 0.02 }}
                      className="hover:bg-white/[0.02] transition-colors group"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <AvatarBubble name={name} />
                          <div>
                            <div className="text-sm font-semibold text-white">{name}</div>
                            <div className="text-xs text-muted">{emp.employee_code || emp.id}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 hidden md:table-cell">
                        {deptName ? (
                          <span className="inline-flex px-2.5 py-1 rounded-md bg-brand-blue/10 border border-brand-blue/20 text-xs text-brand-cyan font-medium">{deptName}</span>
                        ) : <span className="text-muted text-sm">—</span>}
                      </td>
                      <td className="px-4 py-4 text-sm text-muted hidden lg:table-cell">{emp.email || "—"}</td>
                      <td className="px-4 py-4 text-sm text-muted hidden xl:table-cell">{emp.phone || "—"}</td>
                      <td className="px-4 py-4 text-sm text-slate-300 hidden lg:table-cell">{emp.role || "—"}</td>
                      <td className="px-4 py-4 text-sm font-mono text-muted hidden md:table-cell">{emp.employee_code || "—"}</td>
                      <td className="px-4 py-4"><StatusBadge status={emp.status_flag} /></td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 justify-end">
                          <Link href={`/employees/${emp.id}`} className="inline-flex items-center justify-center p-2 rounded-lg bg-white/5 border border-glass-border hover:bg-brand-blue/20 hover:border-brand-blue/30 text-muted hover:text-white transition-all cursor-pointer" title="View profile">
                            <Eye className="w-4 h-4" />
                          </Link>
                          <Link href={`/employees/${emp.id}/edit`} className="inline-flex items-center justify-center p-2 rounded-lg bg-white/5 border border-glass-border hover:bg-purple-500/20 hover:border-purple-500/30 text-muted hover:text-white transition-all cursor-pointer" title="Edit">
                            <Edit className="w-4 h-4" />
                          </Link>
                          <button
                            onClick={() => handleDelete(emp.id)}
                            disabled={deleting === emp.id}
                            className="inline-flex items-center justify-center p-2 rounded-lg bg-white/5 border border-glass-border hover:bg-danger/20 hover:border-danger/30 text-muted hover:text-danger transition-all disabled:opacity-40"
                            title="Delete"
                          >
                            {deleting === emp.id ? <div className="w-4 h-4 border-2 border-danger/30 border-t-danger rounded-full animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
        )}
      </Card>
    </motion.div>
  );
}
