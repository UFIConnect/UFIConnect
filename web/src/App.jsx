import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';

const Login          = lazy(() => import('./pages/Login'));
const Register       = lazy(() => import('./pages/Register'));
const Landing        = lazy(() => import('./pages/Landing'));
const Onboarding     = lazy(() => import('./pages/Onboarding'));
const Feed           = lazy(() => import('./pages/Feed'));
const Groups         = lazy(() => import('./pages/Groups'));
const GroupDetail    = lazy(() => import('./pages/GroupDetail'));
const Opportunities  = lazy(() => import('./pages/Opportunities'));
const Messages       = lazy(() => import('./pages/Messages'));
const Conversation   = lazy(() => import('./pages/Conversation'));
const Profile        = lazy(() => import('./pages/Profile'));
const ConnectedAccounts = lazy(() => import('./pages/ConnectedAccounts'));
const Post           = lazy(() => import('./pages/Post'));
const Search         = lazy(() => import('./pages/Search'));
const PublicProfile  = lazy(() => import('./pages/PublicProfile'));
const Settings       = lazy(() => import('./pages/Settings'));
const AgentDashboard = lazy(() => import('./pages/AgentDashboard'));
const PrivacyPolicy  = lazy(() => import('./pages/PrivacyPolicy'));

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

function HomeRoute() {
  const { token, profile, loading } = useAuth();
  if (loading) return <div className="splash">Loading…</div>;
  if (!token) return <Landing />;
  if (profile && !profile.onboardingComplete) return <Navigate to="/onboarding" replace />;
  return <Feed />;
}

export default function App() {
  return (
    <Suspense fallback={<div className="splash">Loading…</div>}>
    <Routes>
      {/* Public */}
      <Route path="/login"    element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* Auth-only */}
      <Route path="/onboarding" element={
        <RequireAuth><Onboarding /></RequireAuth>
      }/>

      {/* Home: Landing for public, Feed for authenticated */}
      <Route path="/" element={<HomeRoute />} />
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
      <Route path="/profile" element={
        <RequireAuth><RequireOnboarding><Profile /></RequireOnboarding></RequireAuth>
      }/>
      <Route path="/connected-accounts" element={
        <RequireAuth><RequireOnboarding><ConnectedAccounts /></RequireOnboarding></RequireAuth>
      }/>
      <Route path="/post" element={
        <RequireAuth><RequireOnboarding><Post /></RequireOnboarding></RequireAuth>
      }/>
      <Route path="/search" element={
        <RequireAuth><RequireOnboarding><Search /></RequireOnboarding></RequireAuth>
      }/>
      <Route path="/u/:id" element={
        <RequireAuth><RequireOnboarding><PublicProfile /></RequireOnboarding></RequireAuth>
      }/>
      <Route path="/settings" element={
        <RequireAuth><RequireOnboarding><Settings /></RequireOnboarding></RequireAuth>
      }/>

      {/* Agent Control Room — live on public domain */}
      <Route path="/hq"     element={<AgentDashboard />} />
      <Route path="/agents" element={<Navigate to="/hq" replace />} />

      {/* Legal */}
      <Route path="/privacy" element={<PrivacyPolicy />} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
