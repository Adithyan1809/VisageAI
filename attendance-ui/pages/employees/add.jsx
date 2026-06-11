import { PageHeader } from "../../components/PageHeader";
import Card from "../../components/Card";
import Input from "../../components/Input";
import Button from "../../components/Button";
import { useState } from "react";
import { useRouter } from "next/router";
import { createEmployee, listDepartments } from "../../lib/api";
import { useEffect } from "react";

export default function AddEmployee() {
  const [name, setName] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [departmentId, setDepartmentId] = useState("");
  const [errors, setErrors] = useState({});
  const router = useRouter();

  useEffect(() => {
    let mounted = true
    listDepartments().then((data) => {
      if (!mounted) return
      const arr = data || []
      setDepartments(arr)
      if (arr && arr.length > 0) setDepartmentId(arr[0].id ?? arr[0].department_id ?? '')
    }).catch((e) => console.error('Failed to load departments', e))
    return () => (mounted = false)
  }, [])

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        id: employeeCode || undefined,
        employee_code: employeeCode,
        name,
        status_flag: "active",
        email,
        phone,
        role,
        department_id: departmentId || null,
      };
      await createEmployee(payload);
      router.push("/employees");
    } catch (err) {
      console.error("Create failed", err);
      const srv = err?.response?.data
      if (srv && srv.errors) {
        setErrors(srv.errors)
      } else {
        alert("Failed to create employee")
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHeader title="Add New Employee" />

      <Card>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-600 dark:text-slate-400">Name *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., John Doe" />
              {errors.name && <div className="text-xs text-red-400 mt-1">{errors.name}</div>}
            </div>

            <div>
              <label className="text-sm text-gray-600 dark:text-slate-400">Employee ID *</label>
              <Input value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} placeholder="e.g., EMP001" />
            </div>

            <div>
              <label className="text-sm text-gray-600 dark:text-slate-400">Email</label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="john.doe@company.com" />
              {errors.email && <div className="text-xs text-red-400 mt-1">{errors.email}</div>}
            </div>

            <div>
              <label className="text-sm text-gray-600 dark:text-slate-400">Role *</label>
              <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g., Software Engineer" />
            </div>

            <div>
              <label className="text-sm text-gray-600 dark:text-slate-400">Phone</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1-555-123-4567" />
            </div>

            <div>
              <label className="text-sm text-gray-600 dark:text-slate-400">Department</label>
              <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="mt-1 w-full rounded bg-slate-800 border border-slate-700 px-3 py-2 text-slate-100">
                <option value="">-- none --</option>
                {departments.map(d => (
                  <option key={d.id ?? d.department_id ?? d.name} value={d.id ?? d.department_id}>{d.name || d.department_name || d.external_department_code || d.id}</option>
                ))}
              </select>
              {errors.department_id && <div className="text-xs text-red-400 mt-1">{errors.department_id}</div>}
            </div>
          </div>

          <div className="flex gap-3 mt-4">
            <Button type="submit" disabled={loading}>{loading ? "Adding..." : "Add Employee"}</Button>
            <Button variant="secondary" type="button" onClick={() => router.push("/employees")}> Cancel </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
