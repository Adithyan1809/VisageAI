export default function Button({ variant = "primary", className = "", children, ...props }) {
  const base =
    "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-offset-2";

  const styles = {
    primary: `
      bg-gradient-to-br from-blue-600 to-blue-500 text-white shadow-md hover:from-blue-700 hover:to-blue-600
      dark:from-blue-600 dark:to-blue-500
    `,
    secondary: `
      bg-transparent border border-white/10 text-white hover:bg-white/5
      dark:bg-transparent
    `,
    danger: `
      bg-red-600 text-white hover:bg-red-700 shadow-sm
    `,
  };

  return (
    <button {...props} className={`${base} ${styles[variant]} ${className}`}>
      {children}
    </button>
  );
}
