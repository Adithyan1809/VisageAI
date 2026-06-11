import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { useRouter } from "next/router";

export default function Layout({ children }) {
  const router = useRouter();
  const currentRoute = router.pathname;

  return (
    <div className="flex bg-gray-50 dark:bg-[#0d0f11] min-h-screen">

      {/* FIXED SIDEBAR */}
      <div className="fixed left-0 top-0 h-full w-64">
        <Sidebar active={currentRoute} />
      </div>

      {/* RIGHT SIDE */}
      <div className="ml-64 flex-1 flex flex-col">

        {/* FIXED TOPBAR */}
        <div className="sticky top-0 z-50">
          <Topbar route={currentRoute} />
        </div>

        {/* PAGE CONTENT */}
        <main className="p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
