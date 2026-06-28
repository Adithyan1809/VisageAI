import '../styles/globals.css';
import React from 'react';
import Layout from '../components/Layout';
import { Outfit } from 'next/font/google';
import { AnimatePresence, motion } from 'framer-motion';
import { Toaster } from 'sonner';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '../lib/auth';
import { Loader2 } from 'lucide-react';

// Load the Outfit font
const outfit = Outfit({ 
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-outfit',
});

// Public routes that do NOT require authentication
const PUBLIC_ROUTES = ['/login'];

// ---------------------------------------------------------------------------
// Global Error Boundary — catches unhandled render exceptions
// ---------------------------------------------------------------------------
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(err, info) {
    // In production, send to your error tracking service here
    if (process.env.NODE_ENV === 'development') {
      console.error('Uncaught error:', err, info);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: '#050810', color: '#fff', fontFamily: 'system-ui, sans-serif',
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: 'linear-gradient(135deg, #2563eb, #06b6d4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 20, boxShadow: '0 0 30px rgba(6,182,212,0.4)',
          }}>
            <span style={{ fontSize: 24, fontWeight: 900 }}>V</span>
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ color: '#94a3b8', marginBottom: 28, fontSize: 14 }}>
            An unexpected error occurred. Please refresh the page.
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            style={{
              padding: '10px 28px', background: '#2563eb', color: '#fff',
              border: 'none', borderRadius: 10, cursor: 'pointer',
              fontSize: 14, fontWeight: 600,
            }}
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * RouteGuard — wraps the entire app and redirects to /login
 * if the user is not authenticated and the route is protected.
 */
function RouteGuard({ children, route }) {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();
  const isPublic = PUBLIC_ROUTES.includes(route);

  useEffect(() => {
    if (!isLoading && !isAuthenticated && !isPublic) {
      // Preserve original destination so login can redirect back
      router.replace(`/login?redirect=${encodeURIComponent(route)}`);
    }
  }, [isLoading, isAuthenticated, isPublic, router, route]);

  // While checking session on mount, show a full-screen loader
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050810]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-blue to-brand-cyan flex items-center justify-center shadow-[0_0_30px_rgba(6,182,212,0.4)]">
            <span className="text-2xl font-black text-white">V</span>
          </div>
          <Loader2 className="w-5 h-5 text-brand-cyan animate-spin" />
          <p className="text-xs text-white/30 tracking-wider uppercase">Initializing session…</p>
        </div>
      </div>
    );
  }

  // If not public and not authenticated, render nothing (redirect is in-flight)
  if (!isPublic && !isAuthenticated) return null;

  return children;
}

export default function App({ Component, pageProps, router }) {
  const isLoginPage = router.pathname === '/login';

  return (
    <ErrorBoundary>
      <AuthProvider>
        <div className={`${outfit.variable} font-sans`}>
          <Toaster 
            theme="dark" 
            position="top-right" 
            toastOptions={{
              className: 'bg-glass-card/90 backdrop-blur-xl border-glass-border text-white',
              style: {
                background: 'rgba(255, 255, 255, 0.03)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#fff',
              }
            }} 
          />
          <RouteGuard route={router.pathname}>
            {isLoginPage ? (
              // Login page: no sidebar/topbar
              <AnimatePresence mode="wait">
                <motion.div
                  key={router.route}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <Component {...pageProps} />
                </motion.div>
              </AnimatePresence>
            ) : (
              // All other pages: wrapped in Layout (sidebar + topbar)
              <Layout>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={router.route}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.3, ease: 'easeInOut' }}
                    className="h-full"
                  >
                    <Component {...pageProps} />
                  </motion.div>
                </AnimatePresence>
              </Layout>
            )}
          </RouteGuard>
        </div>
      </AuthProvider>
    </ErrorBoundary>
  );
}
