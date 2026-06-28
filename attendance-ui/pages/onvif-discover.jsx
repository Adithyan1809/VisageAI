import { useEffect, useState } from "react";
import { discoverOnvif, validateOnvifCamera } from "../lib/api"; // keep your lib
import Card from "../components/Card";
import { PageHeader } from "../components/PageHeader";
import Button from "../components/Button";
import Input from "../components/Input";
import { Wifi, AlertTriangle, Video } from "lucide-react";
import { useAuth } from '../lib/auth';

export default function OnvifDiscover() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [discoverErr, setDiscoverErr] = useState("");
  const [modal, setModal] = useState({ open: false, device: null });
  const [creds, setCreds] = useState({ username: "admin", password: "" });
  const [validating, setValidating] = useState(false);
  const [result, setResult] = useState(null);

  async function runDiscover() {
    setDiscoverErr("");
    setResult(null);
    setLoading(true);
    try {
      const r = await discoverOnvif();
      setDevices(r.devices || []);
    } catch (e) {
      const onvifBase = process.env.NEXT_PUBLIC_ONVIF_BASE || 'http://localhost:5001';
      setDiscoverErr(`Discovery failed. Is the ONVIF service running at ${onvifBase}?`);
      setDevices([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // optional: runDiscover();
  }, []);

  function openValidate(device) {
    setModal({ open: true, device });
    setCreds({ username: "admin", password: "" });
    setResult(null);
  }

  async function submitValidate(e) {
    e.preventDefault();
    if (!modal.device) return;
    setValidating(true);
    setResult(null);
    try {
      const payload = {
        ip: modal.device.ip,
        port: modal.device.port || null,
        username: creds.username,
        password: creds.password,
      };
      const r = await validateOnvifCamera(payload);
      setResult({ success: !!r.ok, data: r });
    } catch (err) {
      setResult({ success: false, data: { message: err?.message || "Validation request failed" } });
    } finally {
      setValidating(false);
    }
  }

  const { user, loading: authLoading } = useAuth();
  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-400" /></div>;
  if (!user) return null;

  return (
    <div>
      <PageHeader
        title="ONVIF Discovery"
        subtitle="Discover ONVIF cameras on the local network and validate them into the pipeline"
        actions={
          <div className="flex items-center gap-2">
            <Button onClick={runDiscover}><Wifi className="w-4 h-4" /> Discover Cameras</Button>
          </div>
        }
      />

      <Card>
        {loading && <div className="py-6 text-gray-600 dark:text-slate-400">Scanning network for ONVIF devices...</div>}

        {!loading && discoverErr && (
          <div className="py-4 text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
            <AlertTriangle className="w-5 h-5" />
            <div>{discoverErr}</div>
          </div>
        )}

        {!loading && devices.length === 0 && !discoverErr && (
          <div className="py-12 text-center text-gray-500 dark:text-slate-500">
            <div className="flex flex-col items-center">
              <Wifi className="w-12 h-12 text-gray-400 dark:text-slate-600 mb-3" />
              No ONVIF devices discovered. Click <span className="text-blue-500 dark:text-blue-400">Discover Cameras</span> to scan.
            </div>
          </div>
        )}

        {!loading && devices.length > 0 && (
          <div className="space-y-3">
            {devices.map((d, idx) => (
              <div key={`${d.ip}-${idx}`} className="flex items-center justify-between p-3 bg-white dark:bg-[#0b0c0d] border border-gray-200 dark:border-slate-800 rounded">
                <div>
                  <div className="text-sm text-gray-800 dark:text-slate-200 font-medium">{d.ip}{d.port ? `:${d.port}` : ""}</div>
                  <div className="text-xs text-gray-500 dark:text-slate-500">source: {d.source}</div>
                </div>

                <div className="flex items-center gap-2">
                  <Button onClick={() => openValidate(d)}>Validate & Activate</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Modal */}
      {modal.open && modal.device && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg bg-white dark:bg-[#0b0c0d] border border-gray-200 dark:border-slate-800 rounded shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-lg font-semibold text-gray-900 dark:text-slate-200">Validate Camera</div>
                <div className="text-sm text-gray-500 dark:text-slate-400">IP: {modal.device.ip} {modal.device.port ? `: ${modal.device.port}` : ""}</div>
              </div>
              <button onClick={() => setModal({ open: false, device: null })} className="text-gray-600 dark:text-slate-400">Close</button>
            </div>

            <form onSubmit={submitValidate} className="space-y-3">
              <div>
                <label className="text-sm text-gray-600 dark:text-slate-400 block mb-1">Username</label>
                <Input value={creds.username} onChange={(e) => setCreds({ ...creds, username: e.target.value })} />
              </div>

              <div>
                <label className="text-sm text-gray-600 dark:text-slate-400 block mb-1">Password</label>
                <Input type="password" value={creds.password} onChange={(e) => setCreds({ ...creds, password: e.target.value })} />
              </div>

              <div className="flex items-center gap-2">
                <Button disabled={validating}>{validating ? "Validating..." : "Validate & Add"}</Button>
                <Button variant="secondary" onClick={() => setModal({ open: false, device: null })}>Cancel</Button>
              </div>

              {result && (
                <div className={`mt-3 p-3 rounded text-sm ${result.success ? "bg-green-50 dark:bg-green-900 text-green-800 dark:text-green-300" : "bg-red-50 dark:bg-red-900 text-red-800 dark:text-red-300"}`}>
                  {result.data?.message || JSON.stringify(result.data)}
                  {result.success && result.data?.rtsp_url && (
                    <div className="mt-2 text-xs text-gray-700 dark:text-slate-300">RTSP: {result.data.rtsp_url}</div>
                  )}
                </div>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
