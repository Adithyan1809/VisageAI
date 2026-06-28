import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { useRouter } from "next/router";

export default function Layout({ children }) {
  const router = useRouter();
  const currentRoute = router.pathname;

  return (
    <div className="flex min-h-screen">
      {/* FIXED SIDEBAR */}
      <div className="fixed left-0 top-0 h-full w-64 z-40">
        <Sidebar active={currentRoute} />
      </div>

      {/* RIGHT SIDE */}
      <div className="ml-64 flex-1 flex flex-col min-h-screen relative">
        {/* Ambient background glow elements */}
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-brand-blue/10 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-purple-500/10 blur-[120px] pointer-events-none" />

        {/* FIXED TOPBAR */}
        <div className="sticky top-0 z-50">
          <Topbar route={currentRoute} />
        </div>

        {/* PAGE CONTENT */}
        <main className="p-8 relative z-10">
          {children}
        </main>
      </div>
    </div>
  );
}
