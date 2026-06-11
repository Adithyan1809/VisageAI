import { useState, useEffect, useRef } from "react";
import { PageHeader } from "../components/PageHeader";
import Card from "../components/Card";
import Button from "../components/Button";
import { Plus, Settings, Video, Trash2, Edit } from "lucide-react";
import { listCameras, addCamera, deleteCamera } from "../lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8081";

export default function Cameras() {
  const [cameras, setCameras] = useState([]);
  const wsRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    async function fetchCameras() {
      try {
        const data = await listCameras();
        if (mounted) setCameras(data || []);
      } catch (e) {
        // ignore for now
      }
    }

    fetchCameras();

    // WebSocket: subscribe to employee changes and refresh cameras on any db change
    function setupWs() {
      try {
        const ws = new WebSocket(`${API_BASE}/api/employees/ws`);
        ws.onopen = () => {};
        ws.onmessage = (evt) => {
          // Any DB change should trigger a refetch for resource lists
          fetchCameras();
        };
        ws.onclose = () => {
          // reconnect with delay
          setTimeout(setupWs, 2000);
        };
        ws.onerror = () => ws.close();
        wsRef.current = ws;
      } catch (err) {
        // ignore websocket setup error
      }
    }

    setupWs();

    // Polling fallback every 5s
    const interval = setInterval(fetchCameras, 5000);

    return () => {
      mounted = false;
      clearInterval(interval);
      try {
        wsRef.current && wsRef.current.close();
      } catch (e) {}
    };
  }, []);

  return (
    <>
      {/* Page Header */}
      <PageHeader
        subtitle="Manage connected cameras and configuration"
        actions={
          <>
            <Button className="flex items-center gap-2" onClick={async () => {
              try {
                const id = prompt('Camera ID (unique):');
                if (!id) return;
                const name = prompt('Camera display name:', 'New Camera');
                const status = prompt('Status (active/inactive):', 'active');
                const payload = { id, name, status };
                await addCamera(payload);
                const refreshed = await listCameras();
                setCameras(refreshed || []);
              } catch (err) {
                console.error('Failed to add camera', err);
                alert('Failed to add camera: ' + (err && err.message ? err.message : err));
              }
            }}>
              <Plus className="w-4 h-4" /> Add Camera
            </Button>
            <Button variant="secondary" className="flex items-center gap-2">
              <Settings className="w-4 h-4" /> Configure
            </Button>
          </>
        }
      />

      {/* Main Card */}
      <Card>
        <div className="flex justify-between items-center mb-4">
          <div className="text-sm text-gray-600 dark:text-slate-400">
            All Cameras ({cameras.length})
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
                <tr className="text-gray-600 dark:text-slate-400 border-b border-gray-200 dark:border-slate-800 text-left">
                  <th className="py-3">ID</th>
                  <th>Name</th>
                  <th>NVR/DVR</th>
                  <th>Zone</th>
                  <th>Device Config</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Action</th>
                </tr>
            </thead>

            <tbody>
              {cameras.length === 0 ? (
                <tr>
                  <td
                    colSpan="9"
                    className="py-12 text-center text-gray-500 dark:text-slate-500"
                  >
                    <div className="flex flex-col items-center justify-center">
                      <Video className="w-10 h-10 text-gray-400 dark:text-slate-600 mb-3" />
                      No cameras found. Click{" "}
                      <span className="text-blue-500 dark:text-blue-400">
                        "Add Camera"
                      </span>{" "}
                      to add your first camera.
                    </div>
                  </td>
                </tr>
              ) : (
              cameras.map((cam, i) => (
                <tr key={cam.id || i} className="border-b border-gray-200 dark:border-slate-800">
                  <td className="py-3 text-gray-800 dark:text-slate-200">{cam.id}</td>
                  <td className="text-gray-800 dark:text-slate-200">{cam.name}</td>
                  <td className="text-gray-600 dark:text-slate-400">{cam.nvr_dvr_id || '-'}</td>
                  <td className="text-gray-800 dark:text-slate-200">{cam.zone_id || '-'}</td>
                  <td className="text-gray-800 dark:text-slate-200">{cam.device_config_id || '-'}</td>
                  <td className="text-gray-800 dark:text-slate-200">{cam.camera_type || '-'}</td>
                  <td className="text-gray-800 dark:text-slate-200">{cam.status || 'unknown'}</td>
                  <td className="text-gray-600 dark:text-slate-400">{cam.created_at ? new Date(cam.created_at).toLocaleString() : '-'}</td>
                  <td>
                    <div className="flex items-center space-x-2">
                      <Button variant="secondary" className="text-sm" onClick={() => { /* future: open edit modal */ }}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button variant="danger" className="text-sm" onClick={async () => {
                        if (!confirm(`Delete camera ${cam.id || cam.name}?`)) return;
                        try {
                          await deleteCamera(cam.id);
                          // refresh list
                          const refreshed = await listCameras();
                          setCameras(refreshed || []);
                        } catch (err) {
                          console.error('Failed to delete camera', err);
                          alert('Failed to delete camera: ' + (err && err.message ? err.message : err));
                        }
                      }}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
