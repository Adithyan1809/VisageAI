import Link from "next/link";
import {
  Home,
  Camera,
  Settings,
  Users,
  UserPlus,
  Calendar,
  BarChart2,
  FileText,
  Sliders,
  AlertTriangle,
} from "lucide-react";

// Sidebar items
const items = [
  { href: "/", label: "Dashboard", Icon: Home },
  { href: "/cameras", label: "Camera Management", Icon: Camera },
  { href: "/camera-preferences", label: "Camera Preferences", Icon: Sliders },
  { href: "/employees", label: "Employees", Icon: Users },
  { href: "/employees/face-enrollment", label: "Face Enrollment", Icon: UserPlus },
  { href: "/shifts", label: "Attendance and Shift Management", Icon: Calendar },
  { href: "/shift-visualization", label: "Shift Visualization", Icon: BarChart2 },
  { href: "/reports", label: "Reports", Icon: FileText },
  { href: "/preferences", label: "Preferences", Icon: Settings },
];

// Advanced active logic
function isRouteActive(current, href) {
  if (href === "/") return current === "/";
  return current === href || current.startsWith(href + "/");
}


export default function Sidebar({ active = "/" }) {
  return (
    <aside
      className="
        w-64 min-h-screen flex flex-col transition-colors
        text-slate-200 border-r border-slate-800
      "
      style={{ background: 'var(--bg-start)' }}
    >
      {/* Header */}
      <div className="px-5 py-5 flex items-center gap-3 border-b border-slate-800">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-red-600 to-rose-500 flex items-center justify-center text-white font-bold">S</div>
        <div>
          <div className="text-sm font-semibold">AI ATTENDANCE</div>
          <div className="text-xs muted">DSATM</div>
        </div>
      </div>

      {/* Menu */}
      <nav className="mt-4 flex-1">
        {items.map((it) => {
          const activeItem = isRouteActive(active, it.href);

          return (
            <Link
              key={it.href}
              href={it.href}
              className={`
                flex items-center gap-3 px-4 py-2 mx-3 my-1 rounded-lg text-sm transition-all
                ${
                  activeItem
                    ? // ACTIVE ITEM COLORS
                      `bg-blue-600 text-white shadow-sm
                       dark:bg-[#2a2f38] dark:text-white`
                    : // NORMAL ITEM COLORS
                      `text-gray-700 hover:bg-gray-200
                       dark:text-slate-300 dark:hover:bg-[#1e2228]`
                }
              `}
            >
              <it.Icon className="w-5 h-5" />
              <span>{it.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div
        className="
          p-4 border-t text-sm transition-colors
          border-gray-300 text-gray-600
          dark:border-slate-800 dark:text-slate-400
        "
      >
        <div className="mb-1">Signed in as</div>
        <div className="text-black dark:text-white font-medium">Admin</div>
      </div>
    </aside>
  );
}
