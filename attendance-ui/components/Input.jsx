export default function Input({ className = "", ...props }) {
  return (
    <input
      {...props}
      className={`
        w-full px-3 py-2 rounded-md border transition-colors
        bg-white text-gray-900 border-gray-300
        dark:bg-[#0f1113] dark:text-slate-200 dark:border-slate-700
        focus:ring-2 focus:ring-blue-500 focus:outline-none
        ${className}
      `}
    />
  );
}
