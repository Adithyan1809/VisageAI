export default function Card({ children, className = "" }) {
  return (
    <div
      className={`
        rounded-xl p-6 transition-shadow
        bg-white text-gray-900 border border-transparent shadow-sm
        dark:bg-[#0d1218] dark:text-slate-200
        hover:shadow-md
        card-bg
        ${className}
      `}
    >
      {children}
    </div>
  );
}
