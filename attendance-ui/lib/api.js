// Centralized API helpers for the attendance UI.
// Uses axios; NEXT_PUBLIC_API_BASE can override backend base URL.
import axios from "axios";

const BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080";
const ONVIF = process.env.NEXT_PUBLIC_ONVIF_BASE || "http://localhost:5001";
axios.defaults.withCredentials = true;

// ---------------- Cameras ----------------
export async function listCameras() { return (await axios.get(`${BASE}/api/cameras/`)).data; }
export async function addCamera(payload) { return (await axios.post(`${BASE}/api/cameras/`, payload)).data; }
export async function deleteCamera(id) { return (await axios.delete(`${BASE}/api/cameras/${id}`)).data; }

// ---------------- Shifts & Assignments ----------------
export async function listShifts() { return (await axios.get(`${BASE}/api/shifts/`)).data; }
export async function createShift(payload) { return (await axios.post(`${BASE}/api/shifts/`, payload)).data; }
export async function updateShift(id, payload) { return (await axios.put(`${BASE}/api/shifts/${id}`, payload)).data; }
export async function deleteShift(id) { return (await axios.delete(`${BASE}/api/shifts/${id}`)).data; }

export async function listAssignments() { return (await axios.get(`${BASE}/api/assignments/`)).data; }
export async function createAssignment(payload) { return (await axios.post(`${BASE}/api/assignments/`, payload)).data; }
export async function updateAssignment(id, payload) { return (await axios.put(`${BASE}/api/assignments/${id}`, payload)).data; }
export async function deleteAssignment(id) { return (await axios.delete(`${BASE}/api/assignments/${id}`)).data; }

// ---------------- Employees ----------------
export async function listEmployees() { return (await axios.get(`${BASE}/api/employees/`)).data; }
export async function getEmployee(id) { return (await axios.get(`${BASE}/api/employees/${id}`)).data; }
export async function createEmployee(payload) { return (await axios.post(`${BASE}/api/employees/`, payload)).data; }
export async function updateEmployee(id, payload) { return (await axios.put(`${BASE}/api/employees/${id}`, payload)).data; }
export async function deleteEmployee(id) { return (await axios.delete(`${BASE}/api/employees/${id}`)).data; }
export async function listDepartments() { return (await axios.get(`${BASE}/api/organization/departments`)).data; }

// ---------------- Face Enrollment ----------------
export async function enrollFaceWithFiles(employeeId, employeeName, files) {
  const formData = new FormData();
  formData.append("employee_id", employeeId);
  formData.append("employee_name", employeeName);
  files.forEach(f => formData.append("files", f));
  return (
    await axios.post(`${BASE}/api/face-enrollment/enroll`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 60000,
    })
  ).data;
}

export async function enrollFaceFromCamera(employeeId, employeeName, frameBlobs) {
  const formData = new FormData();
  formData.append("employee_id", employeeId);
  formData.append("employee_name", employeeName);
  frameBlobs.forEach((b, i) => formData.append("frames", b, `frame_${i}.jpg`));
  return (
    await axios.post(`${BASE}/api/face-enrollment/enroll-from-camera`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 120000,
    })
  ).data;
}

export async function detectFaceRealtime(frameBlob) {
  const formData = new FormData();
  formData.append("file", frameBlob, "frame.jpg");
  return (
    await axios.post(`${BASE}/api/face-enrollment/detect`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 5000,
    })
  ).data;
}

export async function checkEnrollmentStatus() { return (await axios.get(`${BASE}/api/face-enrollment/status`)).data; }

// ---------------- ONVIF ----------------
export async function discoverOnvif() { return (await axios.get(`${ONVIF}/discover`, { timeout: 15000 })).data; }
export async function validateOnvifCamera(payload) { return (await axios.post(`${ONVIF}/validate_camera`, payload, { timeout: 20000 })).data; }

// End of helpers










