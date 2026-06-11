import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import Card from '../../../components/Card'
import { getEmployee, updateEmployee, listDepartments } from '../../../lib/api'

export default function EditEmployeePage() {
  const router = useRouter()
  const { id } = router.query

  const [employee, setEmployee] = useState(null)
  const [departments, setDepartments] = useState([])
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (!id) return
    getEmployee(id).then((res) => {
      setEmployee(res || {})
    }).catch(() => setEmployee({}))

    // fetch departments for the department select
    listDepartments().then((d) => {
      setDepartments(Array.isArray(d) ? d : [])
    }).catch(() => setDepartments([]))
  }, [id])

  if (!employee) {
    return <div className="p-6">Loading…</div>
  }

  function validate(payload) {
    const e = {}
    if (!payload.name || payload.name.trim().length === 0) e.name = 'Name is required'
    if (payload.email && !/^\S+@\S+\.\S+$/.test(payload.email)) e.email = 'Invalid email'
    return e
  }

  async function handleSubmit(ev) {
    ev.preventDefault()
    const form = new FormData(ev.target)
    const payload = {
      name: form.get('name') || null,
      employee_code: form.get('employee_code') || null,
      status_flag: form.get('status_flag') || null,
      email: form.get('email') || null,
      phone: form.get('phone') || null,
      role: form.get('role') || null,
      department_id: form.get('department_id') || null,
      site_id: form.get('site_id') || null,
      zone_id: form.get('zone_id') || null,
      external_employee_id: form.get('external_employee_id') || null,
    }

    const e = validate(payload)
    setErrors(e)
    if (Object.keys(e).length) return

    try {
      setSaving(true)
      await updateEmployee(id, payload)
      router.push(`/employees/${id}`)
    } catch (err) {
      console.error('Update failed', err)
      // try to read structured errors from server (axios error)
      const srv = err?.response?.data
      if (srv && srv.errors) {
        // set field-level errors returned by server
        setErrors(srv.errors)
      } else {
        setErrors({ submit: 'Save failed — try again' })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Edit Employee</h1>
          <p className="text-sm text-slate-400 mt-1">Update employee fields. Changes will be saved to the database.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/employees/${id}`}>
            <button className="px-3 py-2 border border-slate-600 text-slate-200 rounded hover:bg-slate-700/30">Back</button>
          </Link>
        </div>
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errors.submit && <div className="text-sm text-red-400">{errors.submit}</div>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-slate-300">Name</label>
              <input name="name" defaultValue={employee.name || ''} className="mt-1 w-full rounded bg-slate-800 border border-slate-700 px-3 py-2 text-slate-100" />
              {errors.name && <div className="text-xs text-red-400 mt-1">{errors.name}</div>}
            </div>

            <div>
              <label className="text-sm text-slate-300">Employee Code</label>
              <input name="employee_code" defaultValue={employee.employee_code || ''} className="mt-1 w-full rounded bg-slate-800 border border-slate-700 px-3 py-2 text-slate-100" />
            </div>

            <div>
              <label className="text-sm text-slate-300">Status</label>
              <select name="status_flag" defaultValue={employee.status_flag || 'active'} className="mt-1 w-full rounded bg-slate-800 border border-slate-700 px-3 py-2 text-slate-100">
                <option value="active">active</option>
                <option value="inactive">inactive</option>
              </select>
            </div>

            <div>
              <label className="text-sm text-slate-300">Role</label>
              <input name="role" defaultValue={employee.role || ''} className="mt-1 w-full rounded bg-slate-800 border border-slate-700 px-3 py-2 text-slate-100" />
            </div>

            <div>
              <label className="text-sm text-slate-300">Email</label>
              <input name="email" defaultValue={employee.email || ''} className="mt-1 w-full rounded bg-slate-800 border border-slate-700 px-3 py-2 text-slate-100" />
              {errors.email && <div className="text-xs text-red-400 mt-1">{errors.email}</div>}
            </div>

            <div>
              <label className="text-sm text-slate-300">Phone</label>
              <input name="phone" defaultValue={employee.phone || ''} className="mt-1 w-full rounded bg-slate-800 border border-slate-700 px-3 py-2 text-slate-100" />
            </div>

            <div>
              <label className="text-sm text-slate-300">Department</label>
              <select name="department_id" defaultValue={
                // prefer explicit department_id, fall back to nested department.id or department (name)
                employee.department_id ?? employee.department?.id ?? employee.department ?? ''
              } className="mt-1 w-full rounded bg-slate-800 border border-slate-700 px-3 py-2 text-slate-100">
                <option value="">(none)</option>
                {departments.map((d) => (
                  <option key={d.id ?? d.department_id ?? d.name} value={d.id ?? d.department_id}>{d.name || d.department_name || d.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm text-slate-300">Site</label>
              <input name="site_id" defaultValue={employee.site_id || ''} className="mt-1 w-full rounded bg-slate-800 border border-slate-700 px-3 py-2 text-slate-100" />
            </div>

            <div>
              <label className="text-sm text-slate-300">Zone</label>
              <input name="zone_id" defaultValue={employee.zone_id || ''} className="mt-1 w-full rounded bg-slate-800 border border-slate-700 px-3 py-2 text-slate-100" />
            </div>

            <div className="md:col-span-2">
              <label className="text-sm text-slate-300">External Employee ID</label>
              <input name="external_employee_id" defaultValue={employee.external_employee_id || ''} className="mt-1 w-full rounded bg-slate-800 border border-slate-700 px-3 py-2 text-slate-100" />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded shadow hover:bg-blue-700">{saving ? 'Saving…' : 'Save'}</button>
            <Link href={`/employees/${id}`}>
              <button type="button" className="px-4 py-2 border border-slate-600 text-slate-200 rounded">Cancel</button>
            </Link>
          </div>
        </form>
      </Card>
    </div>
  )
}
