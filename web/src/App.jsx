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
import Post             from './pages/Post';
import Search           from './pages/Search';
import PublicProfile    from './pages/PublicProfile';
import Settings          from './pages/Settings';
import AgentDashboard    from './pages/AgentDashboard';
import PrivacyPolicy     from './pages/PrivacyPolicy';

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
  );
}
