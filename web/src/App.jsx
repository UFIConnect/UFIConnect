import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';

import Login            from './pages/Login';
import Register         from './pages/Register';
import Landing          from './pages/Landing';
import Onboarding       from './pages/Onboarding';
import Feed             from './pages/Feed';
import Groups           from './pages/Groups';
import GroupDetail      from './pages/GroupDetail';
import Opportunities    from './pages/Opportunities';
import Messages         from './pages/Messages';
import Conversation     from './pages/Conversation';
import Profile          from './pages/Profile';
import ConnectedAccounts from './pages/ConnectedAccounts';
import Settings          from './pages/Settings';
import AgentDashboard    from './pages/AgentDashboard';

// Agents are only accessible on localhost — never exposed on the public domain
const IS_LOCAL = typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

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
      <Route path="/profile/connected-accounts" element={
        <RequireAuth><RequireOnboarding><ConnectedAccounts /></RequireOnboarding></RequireAuth>
      }/>
      <Route path="/settings" element={
        <RequireAuth><RequireOnboarding><Settings /></RequireOnboarding></RequireAuth>
      }/>

      {/* Agent Control Room — localhost only */}
      <Route path="/agents" element={
        IS_LOCAL
          ? <RequireAuth><AgentDashboard /></RequireAuth>
          : <Navigate to="/" replace />
      }/>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
