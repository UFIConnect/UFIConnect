import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { useLayoutEffect } from 'react';
import { useAuth } from './contexts/AuthContext';
import { trackPageview } from './analytics';
import { getGoogleAnalytics } from './analytics/browserAnalytics';
import { getGoogleAds } from './analytics/browserAds';
import { publicRoutes } from './seo-routes.mjs';
import { isBusinessRouteAllowed, isBusinessEnrollmentRouteAllowed } from './businessRoutes.mjs';
import { isBusinessAccount } from './businessAccount.mjs';
import RequireFeedLocation from './components/RequireFeedLocation';
import MediaPermissionPrompt from './components/MediaPermissionPrompt';
import { useScreenAwake } from './hooks/useScreenAwake';

// Privacy controls load independently so their UI and styles never hold up
// route content. The consent controller still prevents optional collection
// until the visitor has made a choice.
const AnalyticsPrivacy = lazy(() => import('./components/AnalyticsPrivacy'));
const PhoneEmailReminder = lazy(() => import('./components/PhoneEmailReminder'));

const MAINTENANCE = import.meta.env.VITE_MAINTENANCE_MODE === 'true';

function MaintenancePage() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg, #f8fafc)', padding: 24, textAlign: 'center',
    }}>
      <div style={{ fontSize: '1rem', fontWeight: 900, letterSpacing: '.08em', marginBottom: 16 }}>UFIconnect</div>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: 12, color: 'var(--text, #0f172a)' }}>
        We're making improvements
      </h1>
      <p style={{ fontSize: '1rem', color: 'var(--muted, #64748b)', maxWidth: 400, lineHeight: 1.6, marginBottom: 32 }}>
        UFIconnect is temporarily offline while we polish a few things.
        We'll be back shortly — thanks for your patience.
      </p>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '10px 20px', borderRadius: 24,
        background: 'var(--primary, #102A6B)', color: '#fff',
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
const JobDetail      = lazy(() => import('./pages/JobDetail'));
const JobCompose     = lazy(() => import('./pages/JobCompose'));
const BusinessIndustries = lazy(() => import('./pages/BusinessIndustries'));
const BusinessRegister = lazy(() => import('./pages/BusinessRegister'));
const BusinessEnrollment = lazy(() => import('./pages/BusinessEnrollment'));
const BusinessIndustryCrossPost = lazy(() => import('./pages/BusinessIndustryCrossPost'));
const Messages       = lazy(() => import('./pages/Messages'));
const Conversation   = lazy(() => import('./pages/Conversation'));
const Notifications  = lazy(() => import('./pages/Notifications'));
const Profile        = lazy(() => import('./pages/Profile'));
const ConnectedAccounts = lazy(() => import('./pages/ConnectedAccounts'));
const Analytics      = lazy(() => import('./pages/Analytics'));
const Post           = lazy(() => import('./pages/Post'));
const PostDetail     = lazy(() => import('./pages/PostDetail'));
const SnapPermalink  = lazy(() => import('./pages/SnapPermalink'));
const Search         = lazy(() => import('./pages/SearchExperience'));
const People         = lazy(() => import('./pages/People'));
const Recruiting     = lazy(() => import('./pages/Recruiting'));
const BusinessPosts  = lazy(() => import('./pages/BusinessPosts'));
const Candidates     = lazy(() => import('./pages/Candidates'));
const Opportunities  = lazy(() => import('./pages/Opportunities'));
const PublicProfile  = lazy(() => import('./pages/PublicProfile'));
const Settings       = lazy(() => import('./pages/Settings'));
const PrivacyPolicy  = lazy(() => import('./pages/PrivacyPolicy'));
const TermsOfService = lazy(() => import('./pages/TermsOfService'));
const ChildSafety    = lazy(() => import('./pages/ChildSafety'));
const Policies = lazy(() => import('./pages/Policies'));
const CopyrightPolicy = lazy(() => import('./pages/CopyrightPolicy'));
const VaultDeviceOverview = lazy(() => import('./pages/VaultDeviceOverview'));
const OfficeOverview = lazy(() => import('./pages/OfficeOverview'));
const Sources        = lazy(() => import('./pages/Sources'));
const CommandCenter  = lazy(() => import('./pages/CommandCenter'));
const CareerPublishing = lazy(() => import('./pages/CareerPublishing'));
const ResumeBuilder  = lazy(() => import('./pages/ResumeBuilder'));
const CoverLetterPreview = lazy(() => import('./pages/CoverLetterPreview'));
const YourPostsFeed  = lazy(() => import('./pages/YourPostsFeed'));
const SavedItems = lazy(() => import('./pages/SavedItems'));
const Vault = lazy(() => import('./pages/Vault'));
const VaultDevice = lazy(() => import('./pages/VaultDevice'));

const WorkspaceCenter = lazy(() => import('./pages/WorkspaceCenter'));
const GroupPost = lazy(() => import('./pages/GroupPost'));
const NotFound = lazy(() => import('./pages/NotFound'));
const SearchGuide = lazy(() => import('./pages/SearchGuide'));
// Maps and workspaces are available behind account sign-in.
const Maps = lazy(() => import('./pages/Maps'));

function AnalyticsPrivacyControls() {
  return <Suspense fallback={null}><AnalyticsPrivacy /></Suspense>;
}

function RequireAuth({ children }) {
  const { token, loading, sessionError } = useAuth();
  const location = useLocation();
  if (loading) return <SessionLoading />;
  if (sessionError) return <SessionRecovery />;
  return token ? children : <Navigate to="/login" state={{ from: location.pathname + location.search + location.hash }} replace />;
}

function SessionLoading() {
  return <div className="splash" role="status">Opening UFIconnect…</div>;
}

function SessionRecovery() {
  const { retrySession } = useAuth();
  const location = useLocation();
  return <main className="session-recovery">
    <h1>We couldn’t restore your session</h1>
    <p>Check your connection and try again. We’ll keep you on this page.</p>
    <button type="button" className="btn btn-primary" onClick={retrySession}>Try again</button>
    <Link to="/login" state={{ from: location.pathname + location.search + location.hash }}>Sign in</Link>
  </main>;
}

function RequireOnboarding({ children }) {
  const { profile, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="splash">Loading...</div>;
  if (profile && !profile.onboardingComplete && !isBusinessAccount(profile)) return <Navigate to="/onboarding" state={{ from: location.pathname + location.search + location.hash }} replace />;
  return children;
}

function BusinessRoutes({ children }) {
  const { profile, loading } = useAuth();
  const { pathname, hash } = useLocation();
  // Each protected route handles restoration. Keep public sign-in and
  // recovery pages usable while an older session lookup is still pending.
  if (loading) return children;
  if (isBusinessAccount(profile) && profile.plan !== 'business') {
    const invitation = pathname === '/recruiting' && new URLSearchParams(hash.slice(1)).has('invite');
    if (!invitation && !isBusinessEnrollmentRouteAllowed(pathname, profile)) return <Navigate to="/business/enrollment" replace />;
  }
  return profile?.plan === 'business' && !isBusinessRouteAllowed(pathname, profile)
    ? <Navigate to="/recruiting" replace /> : children;
}

function PeopleRoute() {
  const { profile } = useAuth();
  return profile?.plan === 'business' ? <Candidates /> : <People />;
}

function PageviewTracker() {
  const location = useLocation();
  useEffect(() => {
    trackPageview(location.pathname, location.key);
    getGoogleAnalytics().trackPage(location.pathname, location.key);
  }, [location.pathname]);
  return null;
}

function HomeRoute({ guestHome }) {
  const { token, profile, loading, sessionError } = useAuth();
  if (loading) return <SessionLoading />;
  if (sessionError) return <SessionRecovery />;
  if (!token) {
    return guestHome || <Landing />;
  }
  if (!profile?.id) return <SessionRecovery />;
  if (!profile.onboardingComplete) return <Navigate to="/onboarding" replace />;
  return <RequireFeedLocation><Feed key={profile.id} /></RequireFeedLocation>;
}

function GlobalFeedRoute() {
  const { token, loading, sessionError } = useAuth();
  if (loading) return <SessionLoading />;
  if (sessionError) return <SessionRecovery />;
  return token ? <Navigate to="/?feed=feed" replace /> : <GuestFeed />;
}

function SearchRoute() {
  const { token, loading, sessionError } = useAuth();
  if (loading) return <SessionLoading />;
  if (sessionError) return <SessionRecovery />;
  return token ? <RequireAuth><RequireOnboarding><Search /></RequireOnboarding></RequireAuth> : <SearchGuide />;
}

function VaultRoute() {
  const { profile, loading } = useAuth();
  if (loading) return <SessionLoading />;
  if (!profile?.id) return <SessionRecovery />;
  return <Vault key={profile.id} accountId={profile.id} />;
}

function RouteLoading() {
  const { pathname } = useLocation();
  if (pathname === '/' || pathname === '/search' || !publicRoutes.some(route => route.path === pathname)) return <SessionLoading />;
  const page = publicRoutes.find(route => route.path === pathname);
  return <main className="public-guide" aria-busy="true">
    <h1>{page ? page.title.split(' | ')[0] : 'UFIconnect'}</h1>
    <p>{page?.description || 'Open your account or browse public posts and communities.'}</p>
    <p role="status">Opening your page…</p>
    <nav aria-label="Public pages"><a href="/">Home</a><a href="/global">Global feed</a><a href="/login">Sign in</a><a href="/privacy">Privacy policy</a></nav>
  </main>;
}

export default function App({ guestHome, keepScreenAwake = false } = {}) {
  const { token, loading, sessionError, profile } = useAuth();
  const { pathname, search } = useLocation();
  const feed = new URLSearchParams(search).get('feed') || 'feed';
  useScreenAwake({
    enabled: keepScreenAwake && Boolean(token && profile?.onboardingComplete && !loading && !sessionError && !MAINTENANCE),
    home: pathname === '/' && feed === 'feed',
  });
  const ads = getGoogleAds();
  const guestHomepage = pathname === '/' && !token && !loading && !sessionError && !MAINTENANCE;
  useLayoutEffect(() => { ads.setHomepageEligible(guestHomepage); }, [ads, guestHomepage]);
  if (ads.mustLeave(guestHomepage)) return <SessionLoading />;
  return <AppContent guestHome={guestHome} mediaAccountId={profile?.id} />;
}

function AppContent({ guestHome, mediaAccountId }) {
  useLayoutEffect(() => {
    // Reveal React's committed route, not a pre-rendered guest page while
    // the member's saved session is still being restored.
    document.getElementById('root')?.removeAttribute('data-session-shell');
  }, []);
  const [preview, setPreview] = useState(() => {
    if (typeof window === 'undefined') return false;
    const url = window.location.href;
    if (url.includes('preview') || url.includes('admin')) {
      sessionStorage.setItem('ufi_preview', '1');
      return true;
    }
    return sessionStorage.getItem('ufi_preview') === '1';
  });

  if (MAINTENANCE && !preview) return <><PageviewTracker /><MaintenancePage /><AnalyticsPrivacyControls /></>;

  return (
    <>
    <PageviewTracker />
    <Suspense fallback={<RouteLoading />}>
    <BusinessRoutes>
    <Routes>
      {/* Public */}
      <Route path="/login"    element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/business/register" element={<BusinessRegister />} />
      <Route path="/business/enrollment" element={<RequireAuth><BusinessEnrollment /></RequireAuth>} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password"  element={<ResetPassword />} />

      {/* Auth-only */}
      <Route path="/onboarding" element={
        <RequireAuth><Onboarding /></RequireAuth>
      }/>

      {/* Home: Landing for public, Feed for authenticated */}
      <Route path="/" element={<HomeRoute guestHome={guestHome} />} />
      <Route path="/global" element={<GlobalFeedRoute />} />
      <Route path="/global-scroll" element={<Navigate to="/global" replace />} />
      <Route path="/videos" element={
        <RequireAuth><RequireOnboarding><RequireFeedLocation><Videos /></RequireFeedLocation></RequireOnboarding></RequireAuth>
      }/>
      {/* "You" is the member's own connected-account posts, separate from
          Following mode's other-people/interest-matched feed. */}
      <Route path="/you" element={
        <RequireAuth><RequireOnboarding><YourPostsFeed /></RequireOnboarding></RequireAuth>
      }/>
      <Route path="/music" element={
        <RequireAuth><RequireOnboarding><RequireFeedLocation><Videos music /></RequireFeedLocation></RequireOnboarding></RequireAuth>
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
      <Route path="/opportunities/:id" element={
        <RequireAuth><RequireOnboarding><JobDetail /></RequireOnboarding></RequireAuth>
      }/>
      <Route path="/resume-builder" element={
        <RequireAuth><RequireOnboarding><ResumeBuilder /></RequireOnboarding></RequireAuth>
      }/>
      <Route path="/resume-builder/cover-letter/preview" element={
        <RequireAuth><RequireOnboarding><CoverLetterPreview /></RequireOnboarding></RequireAuth>
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
      <Route path="/analytics" element={
        <RequireAuth><RequireOnboarding><Analytics /></RequireOnboarding></RequireAuth>
      }/>
      <Route path="/post" element={
        <RequireAuth><RequireOnboarding><Post /></RequireOnboarding></RequireAuth>
      }/>
      {/* No RequireAuth — a shared post link needs to actually work for
          whoever clicks it, logged in or not. PostDetail itself branches on
          whether a session exists for its own chrome/actions. */}
      <Route path="/p/:id" element={<PostDetail />}/>
      <Route path="/snaps/:id" element={<SnapPermalink />}/>
      <Route path="/search" element={<SearchRoute />}/>
      <Route path="/people" element={<RequireAuth><RequireOnboarding><PeopleRoute /></RequireOnboarding></RequireAuth>} />
      <Route path="/recruiting" element={<RequireAuth><RequireOnboarding><Recruiting /></RequireOnboarding></RequireAuth>} />
      <Route path="/business-posts" element={<RequireAuth><RequireOnboarding><BusinessPosts /></RequireOnboarding></RequireAuth>} />
      <Route path="/career-posts" element={<RequireAuth><RequireOnboarding><CareerPublishing /></RequireOnboarding></RequireAuth>} />
      <Route path="/jobs/new" element={<RequireAuth><RequireOnboarding><JobCompose /></RequireOnboarding></RequireAuth>} />
      <Route path="/business/industries" element={<RequireAuth><RequireOnboarding><BusinessIndustries /></RequireOnboarding></RequireAuth>} />
      <Route path="/business/cross-post" element={<RequireAuth><RequireOnboarding><BusinessIndustryCrossPost /></RequireOnboarding></RequireAuth>} />
      <Route path="/u/:id" element={
        <RequireAuth><RequireOnboarding><PublicProfile /></RequireOnboarding></RequireAuth>
      }/>
      <Route path="/settings" element={
        <RequireAuth><RequireOnboarding><Settings /></RequireOnboarding></RequireAuth>
      }/>

      <Route path="/sources" element={
        <RequireAuth><RequireOnboarding><Sources /></RequireOnboarding></RequireAuth>
      }/>

      <Route path="/saved/:kind" element={<RequireAuth><RequireOnboarding><SavedItems /></RequireOnboarding></RequireAuth>} />
      <Route path="/vault" element={<RequireAuth><RequireOnboarding><VaultRoute /></RequireOnboarding></RequireAuth>} />
      <Route path="/vault/device" element={<RequireAuth><RequireOnboarding><VaultDevice /></RequireOnboarding></RequireAuth>} />
      <Route path="/maps" element={<RequireAuth><RequireOnboarding><RequireFeedLocation><Maps /></RequireFeedLocation></RequireOnboarding></RequireAuth>} />
      <Route path="/centers/:kind" element={<RequireAuth><RequireOnboarding><WorkspaceCenter /></RequireOnboarding></RequireAuth>} />
      <Route path="/groups/post" element={<RequireAuth><RequireOnboarding><GroupPost /></RequireOnboarding></RequireAuth>} />


      {/* Agent Control Room — live on public domain */}
      <Route path="/hq"     element={<Navigate to="/command-center" replace />} />
      <Route path="/agents" element={<Navigate to="/command-center" replace />} />

      {/* Legal */}
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/terms" element={<TermsOfService />} />
      <Route path="/child-safety" element={<ChildSafety />} />
      <Route path="/policies" element={<Policies />} />
      <Route path="/copyright" element={<CopyrightPolicy />} />
      <Route path="/vault-device" element={<VaultDeviceOverview />} />
      <Route path="/how-it-works" element={<OfficeOverview />} />
      <Route path="/how-office-works" element={<Navigate to="/how-it-works" replace />} />

      {/* Fallback */}
      <Route path="*" element={<NotFound />} />
    </Routes>
    </BusinessRoutes>
    </Suspense>
    <AnalyticsPrivacyControls />
    <MediaPermissionPrompt accountId={mediaAccountId} />
    <Suspense fallback={null}><PhoneEmailReminder /></Suspense>
    </>
  );
}
