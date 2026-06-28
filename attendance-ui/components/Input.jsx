import { cn } from "../lib/utils";

export default function Input({ className = "", ...props }) {
  return (
    <input
      {...props}
      className={cn(
        "w-full px-4 py-2.5 rounded-xl border transition-all duration-300",
        "bg-glass-card/50 backdrop-blur-md text-foreground border-glass-border",
        "placeholder:text-muted",
        "focus:ring-2 focus:ring-brand-blue/50 focus:border-brand-blue focus:bg-glass-card focus:outline-none",
        "hover:border-white/20",
        className
      )}
    />
  );
}
