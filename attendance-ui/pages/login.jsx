import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff, Lock, User, Shield, AlertCircle, Loader2 } from "lucide-react";
import { useAuth } from "../lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const { login, isAuthenticated, isLoading } = useAuth();

  const [form, setForm] = useState({ username: "", password: "", rememberMe: false });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  // Redirect if already authenticated (e.g. user hits /login with active session)
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      const redirectTo = router.query.redirect || '/';
      router.replace(Array.isArray(redirectTo) ? redirectTo[0] : redirectTo);
    }
  }, [isAuthenticated, isLoading, router]);

  const validate = () => {
    const errs = {};
    if (!form.username.trim()) errs.username = "Username is required";
    if (!form.password) errs.password = "Password is required";
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setFieldErrors({});

    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }

    setSubmitting(true);
    try {
      await login(form.username.trim(), form.password, form.rememberMe);
      // Redirect to original destination or dashboard
      const redirectTo = router.query.redirect || '/';
      router.replace(Array.isArray(redirectTo) ? redirectTo[0] : redirectTo);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 429) {
        setError(detail || "Account temporarily locked. Too many failed attempts.");
      } else if (err?.response?.status === 403) {
        setError(detail || "Account is deactivated. Contact your administrator.");
      } else if (err?.response?.status === 401) {
        setError("Invalid username or password. Please try again.");
      } else {
        setError("Unable to connect to the server. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050810]">
        <Loader2 className="w-8 h-8 text-brand-cyan animate-spin" />
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Sign In — VisageAI Enterprise</title>
        <meta name="description" content="VisageAI admin portal — secure sign in" />
      </Head>

      <div className="min-h-screen bg-[#050810] flex items-center justify-center relative overflow-hidden">
        {/* ── Ambient background ── */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-brand-blue/10 blur-[140px]" />
          <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-purple-600/8 blur-[140px]" />
          <div className="absolute top-[30%] right-[20%] w-[30%] h-[30%] rounded-full bg-cyan-500/5 blur-[100px]" />

          {/* Grid overlay */}
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(6,182,212,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.5) 1px, transparent 1px)",
              backgroundSize: "60px 60px",
            }}
          />
        </div>

        {/* ── Login card ── */}
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="relative z-10 w-full max-w-md mx-4"
        >
          {/* Card */}
          <div className="bg-white/[0.03] backdrop-blur-2xl border border-white/10 rounded-2xl p-8 shadow-[0_0_80px_rgba(6,182,212,0.05)] relative overflow-hidden">
            {/* Card glow line */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-px bg-gradient-to-r from-transparent via-brand-cyan/60 to-transparent" />

            {/* ── Header ── */}
            <div className="text-center mb-8">
              {/* Logo */}
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1, duration: 0.4 }}
                className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-blue to-brand-cyan shadow-[0_0_30px_rgba(6,182,212,0.4)] mb-5"
              >
                <span className="text-2xl font-black text-foreground">V</span>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.4 }}
              >
                <h1 className="text-2xl font-bold text-foreground tracking-tight">VisageAI</h1>
                <p className="text-xs text-brand-cyan font-semibold uppercase tracking-widest mt-1">
                  Enterprise Admin Portal
                </p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="flex items-center justify-center gap-2 mt-4 px-4 py-2 rounded-full bg-white/5 border border-white/10 w-fit mx-auto"
              >
                <Shield className="w-3.5 h-3.5 text-brand-cyan" />
                <span className="text-xs text-muted">Restricted Access — Authorized Personnel Only</span>
              </motion.div>
            </div>

            {/* ── Error Alert ── */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -8, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: "auto" }}
                  exit={{ opacity: 0, y: -8, height: 0 }}
                  transition={{ duration: 0.25 }}
                  className="mb-5 flex items-start gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
                >
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Form ── */}
            <motion.form
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.4 }}
              onSubmit={handleSubmit}
              className="space-y-4"
              noValidate
            >
              {/* Username */}
              <div>
                <label htmlFor="login-username" className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Username
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
                  <input
                    id="login-username"
                    type="text"
                    autoComplete="username"
                    autoFocus
                    value={form.username}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, username: e.target.value }));
                      setFieldErrors((fe) => ({ ...fe, username: "" }));
                    }}
                    placeholder="Enter your username"
                    className={`w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border text-foreground placeholder-white/20 text-sm transition-all duration-200 outline-none focus:bg-white/8 focus:border-brand-cyan/60 focus:shadow-[0_0_0_3px_rgba(6,182,212,0.1)] ${
                      fieldErrors.username ? "border-red-500/50" : "border-white/10"
                    }`}
                  />
                </div>
                {fieldErrors.username && (
                  <p className="mt-1.5 text-xs text-red-400">{fieldErrors.username}</p>
                )}
              </div>

              {/* Password */}
              <div>
                <label htmlFor="login-password" className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
                  <input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={form.password}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, password: e.target.value }));
                      setFieldErrors((fe) => ({ ...fe, password: "" }));
                    }}
                    placeholder="Enter your password"
                    className={`w-full pl-10 pr-12 py-3 rounded-xl bg-white/5 border text-foreground placeholder-white/20 text-sm transition-all duration-200 outline-none focus:bg-white/8 focus:border-brand-cyan/60 focus:shadow-[0_0_0_3px_rgba(6,182,212,0.1)] ${
                      fieldErrors.password ? "border-red-500/50" : "border-white/10"
                    }`}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {fieldErrors.password && (
                  <p className="mt-1.5 text-xs text-red-400">{fieldErrors.password}</p>
                )}
              </div>

              {/* Remember me */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  id="remember-me-toggle"
                  role="checkbox"
                  aria-checked={form.rememberMe}
                  onClick={() => setForm((f) => ({ ...f, rememberMe: !f.rememberMe }))}
                  className={`relative w-10 h-5 rounded-full transition-all duration-300 flex-shrink-0 ${
                    form.rememberMe ? "bg-brand-cyan" : "bg-white/10"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-300 ${
                      form.rememberMe ? "left-5" : "left-0.5"
                    }`}
                  />
                </button>
                <label
                  htmlFor="remember-me-toggle"
                  className="text-sm text-muted cursor-pointer select-none"
                  onClick={() => setForm((f) => ({ ...f, rememberMe: !f.rememberMe }))}
                >
                  Stay signed in for 30 days
                </label>
              </div>

              {/* Submit */}
              <button
                id="login-submit-btn"
                type="submit"
                disabled={submitting}
                className="w-full mt-2 py-3 px-4 rounded-xl bg-gradient-to-r from-brand-blue to-brand-cyan text-foreground font-semibold text-sm tracking-wide shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:shadow-[0_0_30px_rgba(6,182,212,0.5)] transition-all duration-300 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Authenticating…
                  </>
                ) : (
                  "Sign In to Dashboard"
                )}
              </button>
            </motion.form>

            {/* ── Footer ── */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-6 pt-5 border-t border-white/5 text-center"
            >
              <p className="text-xs text-foreground/20">
                VisageAI Enterprise &nbsp;·&nbsp; Admin access only
              </p>
              <p className="text-xs text-foreground/15 mt-1">
                Unauthorized access is strictly prohibited and monitored
              </p>
            </motion.div>
          </div>

          {/* Bottom badge */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="flex items-center justify-center gap-2 mt-4"
          >
            <div className="w-2 h-2 rounded-full bg-success shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse" />
            <span className="text-xs text-foreground/25">Secure connection established</span>
          </motion.div>
        </motion.div>
      </div>
    </>
  );
}
