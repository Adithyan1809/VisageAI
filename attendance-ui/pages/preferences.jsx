import { PageHeader } from "../components/PageHeader";
import Card from "../components/Card";
import Input from "../components/Input";
import { useAuth } from '../lib/auth';

export default function Preferences() {
  const { user, loading: authLoading } = useAuth();
  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-400" /></div>;
  if (!user) return null;

  return (
    <>
      <PageHeader title="Preferences" subtitle="Modify system settings and global configurations" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <div className="text-lg font-semibold text-gray-900 dark:text-slate-200 mb-3">Theme</div>

          <label className="flex items-center gap-3 text-gray-700 dark:text-slate-400">
            <input type="radio" name="theme" className="accent-blue-500" defaultChecked />
            <span>Dark Mode (default)</span>
          </label>

          <label className="flex items-center gap-3 mt-2 text-gray-700 dark:text-slate-400">
            <input type="radio" name="theme" className="accent-blue-500" />
            <span>Light Mode</span>
          </label>
        </Card>

        <Card>
          <div className="text-lg font-semibold text-gray-900 dark:text-slate-200 mb-3">Notifications</div>

          <label className="flex items-center gap-3 text-gray-700 dark:text-slate-400">
            <input type="checkbox" className="accent-blue-500" defaultChecked />
            <span>Camera offline alerts</span>
          </label>

          <label className="flex items-center gap-3 mt-2 text-gray-700 dark:text-slate-400">
            <input type="checkbox" className="accent-blue-500" />
            <span>New employee enrollment notifications</span>
          </label>

          <label className="flex items-center gap-3 mt-2 text-gray-700 dark:text-slate-400">
            <input type="checkbox" className="accent-blue-500" />
            <span>Daily attendance summary</span>
          </label>
        </Card>

        <Card className="md:col-span-2">
          <div className="text-lg font-semibold text-gray-900 dark:text-slate-200 mb-3">Face Recognition Thresholds</div>

          <div className="mb-4">
            <label className="text-gray-700 dark:text-slate-400 text-sm">Matching Threshold</label>
            <input type="range" min="30" max="95" defaultValue="65" className="w-full accent-blue-500" />
            <div className="text-sm text-gray-600 dark:text-slate-400">Adjust sensitivity of face matching</div>
          </div>

          <div>
            <label className="text-gray-700 dark:text-slate-400 text-sm">Detection Confidence</label>
            <input type="range" min="50" max="100" defaultValue="80" className="w-full accent-green-500" />
            <div className="text-sm text-gray-600 dark:text-slate-400">Minimum confidence needed to register a face</div>
          </div>
        </Card>
      </div>
    </>
  );
}
