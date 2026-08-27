import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { trackPageview } from './analytics';

const MAINTENANCE = import.meta.env.VITE_MAINTENANCE_MODE === 'true';

function MaintenancePage() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg, #f8fafc)', padding: 24, textAlign: 'center',
    }}>
      <div style={{ fontSize: '3rem', marginBottom: 16 }}>🔧</div>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: 12, color: 'var(--text, #0f172a)' }}>
        We're making improvements
      </h1>
      <p style={{ fontSize: '1rem', color: 'var(--muted, #64748b)', maxWidth: 400, lineHeight: 1.6, marginBottom: 32 }}>
        UFconnect is temporarily offline while we polish a few things.
        We'll be back shortly — thanks for your patience.
      </p>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '10px 20px', borderRadius: 24,
        background: 'var(--primary, #6366f1)', color: '#fff',
        fontSize: '.875rem', fontWeight: 600,
      }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff', opacity: 0.7,
          animation: 'pulse 1.5s ease-in-out infinite' }} />
        Coming back soon
      </div>
    </div>
  );
}

const Login          = lazy(() => import('./pages/Login'));
const Register       = lazy(() => import('./pages/Register'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword  = lazy(() => import('./pages/ResetPassword'));
const Landing        = lazy(() => import('./pages/Landing'));
const Onboarding     = lazy(() => import('./pages/Onboarding'));
const Feed           = lazy(() => import('./pages/Feed'));
const GuestFeed       = lazy(() => import('./pages/GuestFeed'));
const Videos         = lazy(() => import('./pages/Videos'));
const Groups         = lazy(() => import('./pages/Groups'));
const GroupDetail    = lazy(() => import('./pages/GroupDetail'));
const Opportunities  = lazy(() => import('./pages/Opportunities'));
const Messages       = lazy(() => import('./pages/Messages'));
const Conversation   = lazy(() => import('./pages/Conversation'));
const Notifications  = lazy(() => import('./pages/Notifications'));
const Profile        = lazy(() => import('./pages/Profile'));
const ConnectedAccounts = lazy(() => import('./pages/ConnectedAccounts'));
const Post           = lazy(() => import('./pages/Post'));
const PostDetail     = lazy(() => import('./pages/PostDetail'));
const Search         = lazy(() => import('./pages/Search'));
const PublicProfile  = lazy(() => import('./pages/PublicProfile'));
const Settings       = lazy(() => import('./pages/Settings'));
const AgentDashboard = lazy(() => import('./pages/AgentDashboard'));
const PrivacyPolicy  = lazy(() => import('./pages/PrivacyPolicy'));
const TermsOfService = lazy(() => import('./pages/TermsOfService'));
const ChildSafety    = lazy(() => import('./pages/ChildSafety'));
const Sources        = lazy(() => import('./pages/Sources'));
const CommandCenter  = lazy(() => import('./pages/CommandCenter'));

function RequireAuth({ children }) {
  const { token, loading } = useAuth();
  if (loading) return <div className="splash">Loading…</div>;
  return token ? children : <Navigate to="/login" replace />;
}

function RequireOnboarding({ children }) {
  const { profile, loading } = useAuth();
  if (loading) return <div className="splash">Loading…</div>;
  if (profile && !profile.onboardingComplete) return <Navigate to="/onboarding" replace />;
  return children;
}

function PageviewTracker() {
  const location = useLocation();
  useEffect(() => {
    trackPageview(location.pathname);
  }, [location.pathname]);
  return null;
}

// GUEST_SESSION_KEY set by Landing/Login's own "Continue as guest" — a
// session (not persistent) flag, so closing the tab and coming back fresh
// shows Landing again rather than permanently treating this browser as
// guest-mode. Checked only when there's genuinely no token; an actual
// signed-in session always wins regardless of what this flag says.
const GUEST_SESSION_KEY = 'ufi_guest';
function HomeRoute() {
  const { token, profile, loading } = useAuth();
  if (loading) return <div className="splash">Loading…</div>;
  if (!token) {
    if (sessionStorage.getItem(GUEST_SESSION_KEY) === '1') return <GuestFeed />;
    return <Landing />;
  }
  if (profile && !profile.onboardingComplete) return <Navigate to="/onboarding" replace />;
  return <Feed />;
}

export default function App() {
  const [preview, setPreview] = useState(() => {
    if (typeof window === 'undefined') return false;
    const url = window.location.href;
    if (url.includes('preview') || url.includes('admin')) {
      sessionStorage.setItem('ufi_preview', '1');
      return true;
    }
    return sessionStorage.getItem('ufi_preview') === '1';
  });

  if (MAINTENANCE && !preview) return <MaintenancePage />;

  return (
    <>
    <PageviewTracker />
    <Suspense fallback={<div className="splash">Loading…</div>}>
    <Routes>
      {/* Public */}
      <Route path="/login"    element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password"  element={<ResetPassword />} />

      {/* Auth-only */}
      <Route path="/onboarding" element={
        <RequireAuth><Onboarding /></RequireAuth>
      }/>

      {/* Home: Landing for public, Feed for authenticated */}
      <Route path="/" element={<HomeRoute />} />
      <Route path="/videos" element={
        <RequireAuth><RequireOnboarding><Videos /></RequireOnboarding></RequireAuth>
      }/>
      <Route path="/groups" element={
        <RequireAuth><RequireOnboarding><Groups /></RequireOnboarding></RequireAuth>
      }/>
      <Route path="/groups/:id" element={
        <RequireAuth><RequireOnboarding><GroupDetail /></RequireOnboarding></RequireAuth>
      }/>
      <Route path="/opportunities" element={
        <RequireAuth><RequireOnboarding><Opportunities /></RequireOnboarding></RequireAuth>
      }/>
      <Route path="/messages" element={
        <RequireAuth><RequireOnboarding><Messages /></RequireOnboarding></RequireAuth>
      }/>
      <Route path="/messages/:userId" element={
        <RequireAuth><RequireOnboarding><Conversation /></RequireOnboarding></RequireAuth>
      }/>
      <Route path="/notifications" element={
        <RequireAuth><RequireOnboarding><Notifications /></RequireOnboarding></RequireAuth>
      }/>
      <Route path="/profile" element={
        <RequireAuth><RequireOnboarding><Profile /></RequireOnboarding></RequireAuth>
      }/>
      <Route path="/command-center" element={
        <RequireAuth><RequireOnboarding><CommandCenter /></RequireOnboarding></RequireAuth>
      }/>
      <Route path="/connected-accounts" element={
        <RequireAuth><RequireOnboarding><ConnectedAccounts /></RequireOnboarding></RequireAuth>
      }/>
      <Route path="/post" element={
        <RequireAuth><RequireOnboarding><Post /></RequireOnboarding></RequireAuth>
      }/>
      {/* No RequireAuth — a shared post link needs to actually work for
          whoever clicks it, logged in or not. PostDetail itself branches on
          whether a session exists for its own chrome/actions. */}
      <Route path="/p/:id" element={<PostDetail />}/>
      <Route path="/search" element={
        <RequireAuth><RequireOnboarding><Search /></RequireOnboarding></RequireAuth>
      }/>
      <Route path="/u/:id" element={
        <RequireAuth><RequireOnboarding><PublicProfile /></RequireOnboarding></RequireAuth>
      }/>
      <Route path="/settings" element={
        <RequireAuth><RequireOnboarding><Settings /></RequireOnboarding></RequireAuth>
      }/>

      <Route path="/sources" element={
        <RequireAuth><RequireOnboarding><Sources /></RequireOnboarding></RequireAuth>
      }/>

      {/* Agent Control Room — live on public domain */}
      <Route path="/hq"     element={<AgentDashboard />} />
      <Route path="/agents" element={<Navigate to="/hq" replace />} />

      {/* Legal */}
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/terms" element={<TermsOfService />} />
      <Route path="/child-safety" element={<ChildSafety />} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
    </>
  );
}
