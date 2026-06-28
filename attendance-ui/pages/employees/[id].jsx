import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Link from "next/link";
import Card from "../../components/Card";
import { getEmployee, deleteEmployee } from "../../lib/api";
import { toast } from "sonner";

export default function EmployeeView() {
  const router = useRouter();
  const { id } = router.query;
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) return;
    let mounted = true;
    async function fetch() {
      setLoading(true);
      try {
        const data = await getEmployee(id);
        if (mounted) setEmployee(data || null);
      } catch (e) {
        if (mounted) setError(e);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    fetch();
    return () => (mounted = false);
  }, [id]);

  async function handleDelete() {
    if (!confirm("Delete this employee? This cannot be undone.")) return;
    try {
      await deleteEmployee(id);
      toast.success("Employee deleted successfully");
      router.push("/employees");
    } catch (e) {
      toast.error("Failed to delete employee");
    }
  }

  if (loading) return <Card><div className="p-6">Loading...</div></Card>;
  if (error) return <Card><div className="p-6 text-red-600">Error loading employee</div></Card>;
  if (!employee) return <Card><div className="p-6">Employee not found</div></Card>;

  // High-level profile view fields
  const fields = [
    ["Name", employee.name || employee.username || employee.id],
    ["Employee Code", employee.employee_code || "-"],
    ["Status", employee.status_flag || "-"],
    ["Role", employee.role || "-"],
    ["Email", employee.email || "-"],
    ["Phone", employee.phone || "-"],
    ["Department", employee.department_id || "-"],
    ["Site", employee.site_id || "-"],
    ["Zone", employee.zone_id || "-"],
    ["External ID", employee.external_employee_id || "-"],
    ["Created At", employee.created_at || "-"],
    ["Updated At", employee.updated_at || "-"],
  ];

  return (
    <>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Employee Profile</h1>
          <p className="text-sm text-slate-400 mt-1">Detailed view of employee identity, contact and assignment information.</p>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/employees">
            <button className="px-3 py-2 border border-slate-600 text-slate-200 rounded hover:bg-slate-700/30">Back</button>
          </Link>
          <Link href={`/employees/${id}/edit`}>
            <button className="px-3 py-2 bg-blue-600 text-white rounded shadow hover:bg-blue-700">Edit</button>
          </Link>
          <button onClick={handleDelete} className="px-3 py-2 bg-red-600 text-white rounded shadow hover:bg-red-700">Delete</button>
        </div>
      </div>

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6">
          <div>
            <div className="flex items-center gap-4 mb-4">
              <div className="w-16 h-16 rounded-full bg-slate-700 flex items-center justify-center text-xl font-semibold text-foreground">{(employee.name||employee.username||"?").charAt(0)}</div>
              <div>
                <div className="text-lg font-semibold text-slate-100">{employee.name || employee.username || employee.id}</div>
                <div className="text-sm text-slate-400">{employee.employee_code || ""}</div>
              </div>
            </div>

            <h2 className="text-sm font-medium text-slate-200 mb-2">Profile Summary</h2>
            <p className="text-xs text-slate-400 mb-4">A concise view of the employee identity and assignment details.</p>

            <ul className="space-y-2">
              {fields.slice(0, 6).map(([k, v]) => (
                <li key={k} className="flex justify-between border-b border-slate-700 py-3">
                  <span className="text-sm text-slate-400">{k}</span>
                  <span className="text-sm font-semibold text-slate-100">{v}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-sm font-medium text-slate-200 mb-2">Employment Details</h2>
            <p className="text-xs text-slate-400 mb-4">Assignment and system identifiers.</p>

            <ul className="space-y-2">
              {fields.slice(6).map(([k, v]) => (
                <li key={k} className="flex justify-between border-b border-slate-700 py-3">
                  <span className="text-sm text-slate-400">{k}</span>
                  <span className="text-sm font-semibold text-slate-100">{v}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

   
    </>
  );
}
