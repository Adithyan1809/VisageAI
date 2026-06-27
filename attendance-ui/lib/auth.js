/**
 * AuthContext — Industry-grade client-side authentication.
 *
 * Pattern:
 *   - Access token (JWT, 15 min): stored in React state (memory only, never localStorage).
 *   - Refresh token: lives in an httpOnly cookie, JS never touches it directly.
 *   - On mount, we always attempt a silent token refresh to restore session after page reload.
 *   - Axios interceptor attaches Authorization: Bearer header on every API call.
 *   - On 401 from API, we try one silent refresh; if that also fails we force logout.
 */

import React, { createContext, useContext, useEffect, useReducer, useRef, useCallback } from "react";
import axios from "axios";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const initialState = {
  user: null,           // AdminUser object from /api/auth/me
  accessToken: null,    // JWT string (in memory only)
  expiresAt: null,      // Date when access token expires
  isLoading: true,      // True while checking session on mount
  isAuthenticated: false,
};

function authReducer(state, action) {
  switch (action.type) {
    case "AUTH_SUCCESS":
      return {
        ...state,
        user: action.payload.user,
        accessToken: action.payload.accessToken,
        expiresAt: action.payload.expiresAt,
        isAuthenticated: true,
        isLoading: false,
      };
    case "AUTH_LOADING":
      return { ...state, isLoading: true };
    case "AUTH_DONE_LOADING":
      return { ...state, isLoading: false };
    case "LOGOUT":
      return { ...initialState, isLoading: false };
    case "UPDATE_TOKEN":
      return {
        ...state,
        accessToken: action.payload.accessToken,
        expiresAt: action.payload.expiresAt,
      };
    case "UPDATE_USER":
      return { ...state, user: action.payload.user };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, dispatch] = useReducer(authReducer, initialState);
  const refreshTimerRef = useRef(null);
  const isRefreshingRef = useRef(false);
  const refreshSubscribersRef = useRef([]);

  // ---------------------------------------------------------------------------
  // Schedule proactive token refresh (1 min before expiry)
  // ---------------------------------------------------------------------------
  const scheduleRefresh = useCallback((expiresAt) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const msUntilExpiry = expiresAt - Date.now();
    const refreshIn = Math.max(msUntilExpiry - 60_000, 5_000); // 1 min early, at least 5s
    refreshTimerRef.current = setTimeout(() => {
      silentRefresh();
    }, refreshIn);
  }, []);

  // ---------------------------------------------------------------------------
  // Silent token refresh using the httpOnly refresh cookie
  // ---------------------------------------------------------------------------
  const silentRefresh = useCallback(async () => {
    try {
      const res = await axios.post(
        `${API_BASE}/api/auth/refresh`,
        {},
        { withCredentials: true }
      );
      const { access_token, expires_in } = res.data;
      const expiresAt = Date.now() + expires_in * 1000;

      dispatch({ type: "UPDATE_TOKEN", payload: { accessToken: access_token, expiresAt } });
      scheduleRefresh(expiresAt);

      // Notify pending requests waiting on the refresh
      refreshSubscribersRef.current.forEach((cb) => cb(access_token));
      refreshSubscribersRef.current = [];

      return access_token;
    } catch (err) {
      // Refresh failed — session expired, force logout
      dispatch({ type: "LOGOUT" });
      refreshSubscribersRef.current.forEach((cb) => cb(null));
      refreshSubscribersRef.current = [];
      return null;
    }
  }, [scheduleRefresh]);

  // ---------------------------------------------------------------------------
  // On mount: attempt to restore session via silent refresh
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        const res = await axios.post(
          `${API_BASE}/api/auth/refresh`,
          {},
          { withCredentials: true }
        );
        if (cancelled) return;

        const { access_token, expires_in } = res.data;
        const expiresAt = Date.now() + expires_in * 1000;

        // Fetch user profile
        const userRes = await axios.get(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${access_token}` },
          withCredentials: true,
        });
        if (cancelled) return;

        dispatch({
          type: "AUTH_SUCCESS",
          payload: { user: userRes.data, accessToken: access_token, expiresAt },
        });
        scheduleRefresh(expiresAt);
      } catch {
        if (!cancelled) dispatch({ type: "AUTH_DONE_LOADING" });
      }
    }

    restoreSession();
    return () => { cancelled = true; };
  }, [scheduleRefresh]);

  // Keep a ref to the latest access token for the interceptor (declared before useEffect that uses it)
  const tokenRef = useRef(state.accessToken);
  useEffect(() => { tokenRef.current = state.accessToken; }, [state.accessToken]);

  // ---------------------------------------------------------------------------
  // Axios request interceptor — attach JWT to every request
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const reqInterceptor = axios.interceptors.request.use((config) => {
      // Read token from closure via state ref
      const token = tokenRef.current;
      if (token && !config.headers["Authorization"]) {
        config.headers["Authorization"] = `Bearer ${token}`;
      }
      config.withCredentials = true;
      return config;
    });

    return () => axios.interceptors.request.eject(reqInterceptor);
  }, []);

  // ---------------------------------------------------------------------------
  // Axios response interceptor — auto-retry on 401 with fresh token
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const resInterceptor = axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;

        // Only intercept 401s that haven't been retried and aren't auth endpoints
        if (
          error.response?.status === 401 &&
          !originalRequest._retry &&
          !originalRequest.url?.includes("/api/auth/")
        ) {
          originalRequest._retry = true;

          if (isRefreshingRef.current) {
            // Queue this request until refresh completes
            return new Promise((resolve, reject) => {
              refreshSubscribersRef.current.push((newToken) => {
                if (!newToken) return reject(error);
                originalRequest.headers["Authorization"] = `Bearer ${newToken}`;
                resolve(axios(originalRequest));
              });
            });
          }

          isRefreshingRef.current = true;
          const newToken = await silentRefresh();
          isRefreshingRef.current = false;

          if (!newToken) return Promise.reject(error);

          originalRequest.headers["Authorization"] = `Bearer ${newToken}`;
          return axios(originalRequest);
        }

        return Promise.reject(error);
      }
    );

    return () => axios.interceptors.response.eject(resInterceptor);
  }, [silentRefresh]);

  // ---------------------------------------------------------------------------
  // login()
  // ---------------------------------------------------------------------------
  const login = useCallback(async (username, password, rememberMe = false) => {
    const res = await axios.post(
      `${API_BASE}/api/auth/login`,
      { username, password, remember_me: rememberMe },
      { withCredentials: true }
    );
    const { access_token, expires_in } = res.data;
    const expiresAt = Date.now() + expires_in * 1000;

    // Fetch user profile
    const userRes = await axios.get(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${access_token}` },
      withCredentials: true,
    });

    dispatch({
      type: "AUTH_SUCCESS",
      payload: { user: userRes.data, accessToken: access_token, expiresAt },
    });
    scheduleRefresh(expiresAt);
  }, [scheduleRefresh]);

  // ---------------------------------------------------------------------------
  // logout()
  // ---------------------------------------------------------------------------
  const logout = useCallback(async () => {
    try {
      await axios.post(`${API_BASE}/api/auth/logout`, {}, { withCredentials: true });
    } catch { /* silently ignore */ }
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    dispatch({ type: "LOGOUT" });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, silentRefresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
