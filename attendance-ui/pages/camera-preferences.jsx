import Card from "../components/Card";
import { PageHeader } from "../components/PageHeader";
import Button from "../components/Button";

export default function CameraPreferences() {
  return (
    <>
      <PageHeader
        title="Camera Preferences"
        subtitle="Manage configuration, tampering detection, and firmware settings"
      />

      <Card>
        <div className="flex gap-3 border-b border-gray-200 dark:border-slate-800 pb-3">
          <Button variant="secondary" className="px-3 py-2">Configuration</Button>
          <Button variant="secondary" className="px-3 py-2">Services</Button>
          <Button variant="secondary" className="px-3 py-2">Firmware</Button>
        </div>

        <div className="py-10 text-center text-gray-500 dark:text-slate-500">
          No cameras configured yet.
          <br />
          <button className="text-blue-500 dark:text-blue-400 hover:underline mt-2">Go to Camera List</button>
        </div>
      </Card>
    </>
  );
}
