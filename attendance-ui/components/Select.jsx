import { cn } from "../lib/utils";

export default function Select({ className = "", children, ...props }) {
  return (
    <select
      {...props}
      className={cn(
        "w-full px-4 py-2.5 rounded-xl border transition-all duration-300 appearance-none",
        "bg-glass-card backdrop-blur-md text-white border-glass-border",
        "focus:ring-2 focus:ring-brand-blue/50 focus:border-brand-blue focus:outline-none",
        "hover:border-white/20",
        className
      )}
    >
      {children}
    </select>
  );
}
