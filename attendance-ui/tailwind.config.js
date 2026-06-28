/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-outfit)', 'sans-serif'],
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        "glass-card": "var(--glass-card)",
        "glass-border": "var(--glass-border)",
        brand: {
          blue: "#3b82f6",
          cyan: "#06b6d4",
          indigo: "#6366f1",
          glow: "rgba(59, 130, 246, 0.5)",
        },
        success: {
          DEFAULT: "#10b981",
          glow: "rgba(16, 185, 129, 0.4)",
        },
        danger: {
          DEFAULT: "#ef4444",
          glow: "rgba(239, 68, 68, 0.4)",
        }
      },
      boxShadow: {
        "glow-brand": "0 0 20px rgba(59, 130, 246, 0.3)",
        "glow-success": "0 0 20px rgba(16, 185, 129, 0.3)",
        "glow-danger": "0 0 20px rgba(239, 68, 68, 0.3)",
        "glass": "0 4px 30px rgba(0, 0, 0, 0.1)",
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'hero-glow': 'conic-gradient(from 180deg at 50% 50%, #2a8af6 0deg, #a853ba 180deg, #e92a67 360deg)',
      },
      animation: {
        "pulse-slow": "pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "float": "float 6s ease-in-out infinite",
        "spin-slow": "spin 8s linear infinite",
        "scanline": "scanline 2s linear infinite",
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        }
      }
    },
  },
  plugins: [],
};
