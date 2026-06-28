import { motion } from "framer-motion";
import { cn } from "../lib/utils";

export default function Card({ children, className = "", animate = false, delay = 0 }) {
  const Component = animate ? motion.div : "div";
  
  const animationProps = animate ? {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, delay, ease: "easeOut" }
  } : {};

  return (
    <Component
      {...animationProps}
      className={cn(
        "glass-panel glass-glow p-6",
        className
      )}
    >
      <div className="relative z-10">
        {children}
      </div>
    </Component>
  );
}
