import Link from 'next/link';

export default function Nav() {
  return (
    <nav className="bg-white shadow p-3 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div className="text-xl font-bold">SMAP UI</div>
        <Link href="/" className="text-sm hover:underline">Dashboard</Link>
        <Link href="/cameras" className="text-sm hover:underline">Cameras</Link>
        <Link href="/employees" className="text-sm hover:underline">Employees</Link>
        <Link href="/enroll" className="text-sm hover:underline">Enroll</Link>
      </div>
      <div>
        <button className="text-sm bg-blue-600 text-white px-3 py-1 rounded">
          Sign Out
        </button>
      </div>
    </nav>
  );
}
