import { Sun, Moon } from "lucide-react";
import { useState, useEffect } from "react";

export default function Topbar({ route }) {

  const titles = {
    "/": "Dashboard",
    "/cameras": "Camera Management",
    "/camera-preferences": "Camera Preferences",
    "/employees": "Employees",
    "/employees/add": "Add Employee",
    "/employees/face-enrollment": "Face Enrollment",
    "/shifts": "Attendance & Shift Management",
    "/shift-visualization": "Shift Visualization",
    "/reports": "Reports",
    "/preferences": "Preferences",
    "/onvif-discover": "ONVIF Discovery",
  };

  const title = titles[route] || "Dashboard";

  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return (
    <header
      className={
        `
      flex items-center justify-between
      px-6 py-5
      text-white
      border-b border-slate-800
      shadow-sm
    `}
      style={{ background: 'var(--bg-start)', backdropFilter: 'none' }}
    >
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <div className="text-sm muted">&nbsp;</div>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="p-2 rounded-md hover:bg-white/5 transition"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun className="text-white" /> : <Moon className="text-white" />}
        </button>

        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-slate-700 to-slate-600 flex items-center justify-center text-white font-semibold">
          A
        </div>
      </div>
    </header>
  );
}
