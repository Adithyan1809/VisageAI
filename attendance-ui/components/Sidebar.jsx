import Link from "next/link";
import { useRouter } from "next/router";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home, Camera, Settings, Users, UserPlus,
  Calendar, BarChart2, FileText, Sliders, LogOut, Shield
} from "lucide-react";
import { cn } from "../lib/utils";
import { useAuth } from "../lib/auth";
import { useState } from "react";

const items = [
  { href: "/", label: "Dashboard", Icon: Home },
  { href: "/cameras", label: "Camera Management", Icon: Camera },
  { href: "/camera-preferences", label: "Camera Preferences", Icon: Sliders },
  { href: "/employees", label: "Employees", Icon: Users },
  { href: "/employees/face-enrollment", label: "Face Enrollment", Icon: UserPlus },
  { href: "/shifts", label: "Attendance & Shifts", Icon: Calendar },
  { href: "/shift-visualization", label: "Shift Visualization", Icon: BarChart2 },
  { href: "/reports", label: "Reports", Icon: FileText },
  { href: "/preferences", label: "Preferences", Icon: Settings },
];

function isRouteActive(current, href) {
  if (href === "/") return current === "/";
  return current === href || current.startsWith(href + "/");
}

const ROLE_LABELS = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  VIEWER: "Viewer",
};

const ROLE_COLORS = {
  SUPER_ADMIN: "text-brand-cyan",
  ADMIN: "text-purple-400",
  VIEWER: "text-white/40",
};

export default function Sidebar({ active = "/" }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    await logout();
    router.replace("/login");
  };

  // Get user initials for avatar
  const initials = user?.full_name
    ? user.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : user?.username?.slice(0, 2).toUpperCase() || "A";

  const roleLabel = ROLE_LABELS[user?.role] || user?.role || "Admin";
  const roleColor = ROLE_COLORS[user?.role] || "text-brand-cyan";

  return (
    <aside className="w-64 h-full flex flex-col bg-glass-card backdrop-blur-xl border-r border-glass-border">
      {/* Header */}
      <div className="px-6 py-6 flex items-center gap-4 border-b border-glass-border relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-brand-blue/10 to-transparent pointer-events-none" />
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-blue to-brand-cyan flex items-center justify-center text-white font-bold shadow-glow-brand relative z-10">
          V
        </div>
        <div className="relative z-10">
          <div className="text-lg font-bold tracking-tight text-white">VisageAI</div>
          <div className="text-xs text-brand-cyan font-medium uppercase tracking-wider">Enterprise</div>
        </div>
      </div>

      {/* Menu */}
      <nav className="mt-6 flex-1 px-3 space-y-1 overflow-y-auto custom-scrollbar">
        {items.map((it) => {
          const activeItem = isRouteActive(active, it.href);

          return (
            <Link key={it.href} href={it.href}>
              <motion.div
                whileHover={{ x: 4 }}
                whileTap={{ scale: 0.98 }}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-300 relative overflow-hidden",
                  activeItem
                    ? "text-brand-cyan bg-brand-blue/10 border border-brand-blue/20 shadow-[0_0_15px_rgba(6,182,212,0.15)]"
                    : "text-muted hover:text-white hover:bg-white/5 border border-transparent"
                )}
              >
                {activeItem && (
                  <motion.div 
                    layoutId="activeTab"
                    className="absolute left-0 top-0 bottom-0 w-1 bg-brand-cyan shadow-[0_0_10px_rgba(6,182,212,1)] rounded-r-full"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
                <it.Icon className={cn("w-5 h-5", activeItem ? "text-brand-cyan" : "text-muted")} />
                <span className="relative z-10">{it.label}</span>
              </motion.div>
            </Link>
          );
        })}
      </nav>

      {/* Footer — user info + logout */}
      <div className="p-4 border-t border-glass-border mt-auto bg-white/[0.02] backdrop-blur-md">
        {/* Logout confirm */}
        <AnimatePresence>
          {showLogoutConfirm && (
            <motion.div
              initial={{ opacity: 0, y: 8, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: 8, height: 0 }}
              className="mb-3 overflow-hidden"
            >
              <p className="text-xs text-white/60 mb-2 text-center">Sign out of VisageAI?</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowLogoutConfirm(false)}
                  className="flex-1 py-1.5 rounded-lg text-xs text-white/50 hover:text-white bg-white/5 hover:bg-white/10 transition-all"
                >
                  Cancel
                </button>
                <button
                  id="confirm-logout-btn"
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="flex-1 py-1.5 rounded-lg text-xs text-red-400 hover:text-white bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-all font-semibold"
                >
                  {loggingOut ? "Signing out…" : "Sign Out"}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* User info row */}
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-blue/80 to-brand-cyan/80 flex items-center justify-center text-white font-bold text-xs border border-white/10 shadow-[0_0_10px_rgba(6,182,212,0.3)]">
              {initials}
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-success border-2 border-[#070c18] shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
          </div>

          {/* Name + role */}
          <div className="flex-1 min-w-0">
            <div className="text-sm text-white font-semibold truncate">
              {user?.full_name || user?.username || "Administrator"}
            </div>
            <div className={`text-xs font-medium flex items-center gap-1 ${roleColor}`}>
              <Shield className="w-3 h-3 flex-shrink-0" />
              {roleLabel}
            </div>
          </div>

          {/* Logout button */}
          <button
            id="logout-btn"
            aria-label="Sign out"
            onClick={() => setShowLogoutConfirm((v) => !v)}
            className="p-1.5 rounded-lg text-muted hover:text-red-400 hover:bg-red-500/10 transition-all duration-200 flex-shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
