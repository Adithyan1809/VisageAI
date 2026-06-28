import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { PageHeader } from "../components/PageHeader";
import Card from "../components/Card";
import Input from "../components/Input";
import { useAuth } from '../lib/auth';
import { changePassword } from "../lib/api";
import { KeyRound, Shield, AlertTriangle } from "lucide-react";

export default function Preferences() {
  const { user, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("general");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [isChanging, setIsChanging] = useState(false);

  useEffect(() => {
    if (router.query.tab) setActiveTab(router.query.tab);
  }, [router.query.tab]);

  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-brand-blue" /></div>;
  if (!user) return null;

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");

    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }

    try {
      setIsChanging(true);
      const res = await changePassword({ current_password: currentPassword, new_password: newPassword });
      setPasswordSuccess(res.detail || "Password changed successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      
      // Force user to log in again after 2 seconds
      setTimeout(async () => {
        await logout();
        router.push("/login");
      }, 2000);
    } catch (err) {
      setPasswordError(err.response?.data?.detail || err.message || "Failed to change password.");
    } finally {
      setIsChanging(false);
    }
  };

  return (
    <>
      <PageHeader title="Preferences" subtitle="Modify system settings and global configurations" />

      {/* Tabs */}
      <div className="flex items-center gap-6 border-b border-glass-border mb-6">
        <button
          onClick={() => setActiveTab("general")}
          className={`pb-3 text-sm font-semibold transition-colors border-b-2 ${activeTab === "general" ? "border-brand-blue text-brand-blue" : "border-transparent text-muted hover:text-foreground"}`}
        >
          General Settings
        </button>
        <button
          onClick={() => setActiveTab("security")}
          className={`pb-3 text-sm font-semibold transition-colors border-b-2 ${activeTab === "security" ? "border-brand-blue text-brand-blue" : "border-transparent text-muted hover:text-foreground"}`}
        >
          Security & Password
        </button>
      </div>

      {activeTab === "general" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in">
          <Card>
            <div className="text-lg font-semibold text-foreground mb-3">Theme</div>

            <label className="flex items-center gap-3 text-muted">
              <input type="radio" name="theme" className="accent-brand-blue" defaultChecked />
              <span>Dark Mode (default)</span>
            </label>

            <label className="flex items-center gap-3 mt-2 text-muted">
              <input type="radio" name="theme" className="accent-brand-blue" />
              <span>Light Mode</span>
            </label>
          </Card>

          <Card>
            <div className="text-lg font-semibold text-foreground mb-3">Notifications</div>

            <label className="flex items-center gap-3 text-muted">
              <input type="checkbox" className="accent-brand-blue" defaultChecked />
              <span>Camera offline alerts</span>
            </label>

            <label className="flex items-center gap-3 mt-2 text-muted">
              <input type="checkbox" className="accent-brand-blue" />
              <span>New employee enrollment notifications</span>
            </label>

            <label className="flex items-center gap-3 mt-2 text-muted">
              <input type="checkbox" className="accent-brand-blue" />
              <span>Daily attendance summary</span>
            </label>
          </Card>

          <Card className="md:col-span-2">
            <div className="text-lg font-semibold text-foreground mb-3">Face Recognition Thresholds</div>

            <div className="mb-4">
              <label className="text-muted text-sm">Matching Threshold</label>
              <input type="range" min="30" max="95" defaultValue="65" className="w-full accent-brand-blue" />
              <div className="text-sm text-muted opacity-80">Adjust sensitivity of face matching</div>
            </div>

            <div>
              <label className="text-muted text-sm">Detection Confidence</label>
              <input type="range" min="50" max="100" defaultValue="80" className="w-full accent-brand-cyan" />
              <div className="text-sm text-muted opacity-80">Minimum confidence needed to register a face</div>
            </div>
          </Card>
        </div>
      )}

      {activeTab === "security" && (
        <div className="max-w-2xl animate-fade-in">
          <Card>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-brand-blue/10 flex items-center justify-center text-brand-blue">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-foreground">Change Password</h3>
                <p className="text-sm text-muted">Update your account password to stay secure.</p>
              </div>
            </div>

            <form onSubmit={handlePasswordChange} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Current Password</label>
                <Input
                  type="password"
                  placeholder="Enter current password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">New Password</label>
                <Input
                  type="password"
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
                <p className="text-xs text-muted mt-1.5 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Must be at least 8 characters, contain one uppercase letter and one digit.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Confirm New Password</label>
                <Input
                  type="password"
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>

              {passwordError && (
                <div className="p-3 rounded-lg bg-danger/10 text-danger text-sm font-medium">
                  {passwordError}
                </div>
              )}

              {passwordSuccess && (
                <div className="p-3 rounded-lg bg-success/10 text-success text-sm font-medium">
                  {passwordSuccess}
                </div>
              )}

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={isChanging}
                  className="px-6 py-2.5 bg-brand-blue hover:bg-blue-500 text-white font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isChanging ? "Updating..." : <><KeyRound className="w-4 h-4" /> Update Password</>}
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
