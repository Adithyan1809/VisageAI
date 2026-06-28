import { motion } from "framer-motion";
import { cn } from "../lib/utils";

export default function Button({ variant = "primary", className = "", children, ...props }) {
  const base = "inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50 disabled:pointer-events-none";

  const styles = {
    primary: "bg-brand-blue text-white shadow-glow-brand hover:bg-blue-500 hover:shadow-[0_0_25px_rgba(59,130,246,0.5)] border border-blue-400/20",
    secondary: "bg-glass-card border border-glass-border text-foreground hover:bg-glass-hover hover:border-white/20 backdrop-blur-md",
    danger: "bg-danger text-white shadow-glow-danger hover:bg-red-500 border border-red-400/20",
    ghost: "bg-transparent text-muted hover:text-foreground hover:bg-white/5",
  };

  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.96 }}
      {...props}
      className={cn(base, styles[variant], className)}
    >
      {children}
    </motion.button>
  );
}
