import { Bell, Info, ChevronDown, LogOut, User, Shield, KeyRound } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/router";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../lib/auth";

const ROLE_LABELS = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Administrator",
  VIEWER: "Viewer",
};

export default function Topbar({ route }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [showAlertTip, setShowAlertTip] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef(null);

  const titles = {
    "/": "System Dashboard",
    "/cameras": "Camera Management",
    "/camera-preferences": "Camera Settings",
    "/employees": "Employee Directory",
    "/employees/add": "Onboard Employee",
    "/employees/face-enrollment": "Biometric Enrollment",
    "/shifts": "Attendance & Shifts",
    "/shift-visualization": "Shift Analytics",
    "/reports": "System Reports",
    "/preferences": "Global Preferences",
    "/onvif-discover": "ONVIF Discovery",
  };

  const title = titles[route] || "Dashboard";

  // Close menu when clicking outside
  useEffect(() => {
    function handleOutside(e) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const handleLogout = async () => {
    setShowUserMenu(false);
    await logout();
    router.replace("/login");
  };

  const initials = user?.full_name
    ? user.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : user?.username?.slice(0, 2).toUpperCase() || "A";

  const roleLabel = ROLE_LABELS[user?.role] || user?.role || "Admin";

  return (
    <header className="flex items-center justify-between px-8 py-5 bg-glass-card/80 backdrop-blur-xl border-b border-glass-border shadow-sm sticky top-0 z-40 transition-all duration-300">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-4">
        {/* System Alerts Bell */}
        <div className="relative">
          <button
            aria-label="System alerts — camera disconnections and unknown face detections appear here"
            onMouseEnter={() => setShowAlertTip(true)}
            onMouseLeave={() => setShowAlertTip(false)}
            className="relative p-2 rounded-full hover:bg-white/10 transition-colors text-muted hover:text-white group"
          >
            <Bell className="w-5 h-5" />
            <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-danger shadow-[0_0_8px_rgba(239,68,68,0.8)] animate-pulse-slow" />
          </button>
          {showAlertTip && (
            <div className="absolute right-0 top-12 w-64 z-50 bg-glass-card backdrop-blur-xl border border-glass-border rounded-xl px-4 py-3 shadow-2xl text-xs text-muted leading-relaxed">
              <p className="text-white font-semibold mb-1 flex items-center gap-1.5"><Info className="w-3.5 h-3.5 text-brand-cyan" /> System Alerts</p>
              Real-time alerts for camera disconnections and unknown face detections are shown on the live dashboard feed below.
            </div>
          )}
        </div>

        {/* Global Status Pill */}
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/10 border border-success/20">
          <div className="w-2 h-2 rounded-full bg-success shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse-slow" />
          <span className="text-xs font-semibold text-success uppercase tracking-wider">System Online</span>
        </div>

        {/* Divider */}
        <div className="h-6 w-px bg-white/10" />

        {/* User menu */}
        <div className="relative" ref={userMenuRef}>
          <button
            id="topbar-user-menu-btn"
            onClick={() => setShowUserMenu((v) => !v)}
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/5 transition-all duration-200 border border-transparent hover:border-white/10"
          >
            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-blue/80 to-brand-cyan/80 flex items-center justify-center text-white font-bold text-xs border border-white/10 shadow-[0_0_10px_rgba(6,182,212,0.2)]">
              {initials}
            </div>
            <div className="hidden sm:block text-left">
              <div className="text-sm font-semibold text-white leading-tight">
                {user?.full_name?.split(" ")[0] || user?.username || "Admin"}
              </div>
              <div className="text-xs text-muted leading-tight">{roleLabel}</div>
            </div>
            <ChevronDown className={`w-3.5 h-3.5 text-muted transition-transform duration-200 ${showUserMenu ? "rotate-180" : ""}`} />
          </button>

          {/* Dropdown */}
          <AnimatePresence>
            {showUserMenu && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="absolute right-0 top-full mt-2 w-64 bg-[#0d1526]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50"
              >
                {/* User info header */}
                <div className="px-4 py-4 border-b border-white/8 bg-brand-blue/5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-blue/80 to-brand-cyan/80 flex items-center justify-center text-white font-bold text-sm border border-white/10">
                      {initials}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-white">{user?.full_name || user?.username}</div>
                      <div className="text-xs text-muted">{user?.email}</div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Shield className="w-3 h-3 text-brand-cyan" />
                        <span className="text-xs text-brand-cyan font-semibold">{roleLabel}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Menu items */}
                <div className="p-2">
                  <button
                    id="topbar-profile-btn"
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted hover:text-white hover:bg-white/5 transition-all text-left"
                    onClick={() => { setShowUserMenu(false); router.push("/preferences"); }}
                  >
                    <User className="w-4 h-4" />
                    Account Settings
                  </button>

                  <button
                    id="topbar-change-password-btn"
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted hover:text-white hover:bg-white/5 transition-all text-left"
                    onClick={() => { setShowUserMenu(false); router.push("/preferences?tab=security"); }}
                  >
                    <KeyRound className="w-4 h-4" />
                    Change Password
                  </button>
                </div>

                {/* Logout */}
                <div className="p-2 border-t border-white/8">
                  <button
                    id="topbar-logout-btn"
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-all text-left font-medium"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
