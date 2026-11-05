// Configuration inventory only: never return environment values or provider errors.
const { providerSettings } = require('./auth-signin');
const { SOURCE_KEYS, officeSourceReadiness } = require('./office-agent-activation');
function getOfficeSourceReadiness(id, env = {}) {
  const requiredEnv = [...(SOURCE_KEYS[id] || [])];
  const { configured, missingEnv } = officeSourceReadiness(id, env);
  return { configured, requiredEnv, missingEnv };
}
function buildOfficeSetup({ env = {}, role = 'api', database = false, backup = {}, social = {}, sourceWorkers = {}, autofixEnabled = env.AUTOFIX_ENABLED === 'true' } = {}) {
  const items = [];
  const present = key => Boolean(String(env[key] || '').trim());
  const add = (id, label, category, keys, description, options = {}) => {
    const missing = keys.filter(key => !present(key));
    const configured = options.configured ?? missing.length === 0;
    items.push({ id, label, category, description, requiredEnv: keys, missingEnv: configured ? [] : missing,
      status: options.status || (configured ? 'configured' : 'missing'),
      detail: options.detail || (configured ? 'Settings are present. Provider access has not been tested.' : 'Add the missing settings to this Render service, then redeploy.'),
      ...(options.capabilities ? { capabilities: options.capabilities } : {}),
    });
  };
  const sourceRuntime = id => {
    if (role !== 'pipeline') return {};
    const worker = sourceWorkers[id];
    if (!worker || !getOfficeSourceReadiness(id, env).configured) return {};
    if (worker.paused || worker.consecutiveErrors > 0) return {
      status: 'degraded', detail: 'Credentials are present, but the worker reports a pause or failed fetch. Review its source agent; provider cooldowns remain in place.',
    };
    if (worker.lastSuccess && Number(worker.postCount) > 0) return {
      status: 'ready', detail: 'The worker reports a successful fetch and a nonempty source cache. Provider approval and personal account connections are separate.',
    };
    return { detail: 'Credentials are present. No successful fetch with cached posts has been observed yet. An empty result does not verify provider access.' };
  };
  add('database', 'Primary database', 'Core services', ['DATABASE_URL'], 'Stores accounts, posts, settings, and Office history.', {
    status: database ? 'ready' : present('DATABASE_URL') ? 'degraded' : 'missing',
    detail: database ? 'The service reports an active database connection.' : 'The primary database is not connected. Check its connection, storage, and TLS settings.',
  });
  add('office', 'Office access', 'Core services', ['OFFICE_TOKEN'], 'Protects administration on desktop and mobile.');
  add('sessions', 'Persistent sign-in', 'Core services', ['JWT_SECRET', 'OAUTH_TOKEN_ENCRYPTION_KEY'], 'Keep stable, matching keys on API and pipeline so sessions and connected-account credentials survive deployments.');
  add('agent-chat', 'Agent explanations', 'AI and content', ['OPENAI_API_KEY'], 'Enables AI explanations of curated agent metrics. Local diagnostic replies remain available without this key.', {
    capabilities: { apiKeyConfigured: present('OPENAI_API_KEY'), modelConfigured: present('OFFICE_CHAT_OPENAI_MODEL') || present('AI_CONTENT_OPENAI_MODEL'), usesDefaultModel: !present('OFFICE_CHAT_OPENAI_MODEL') && !present('AI_CONTENT_OPENAI_MODEL') },
  });
  if (role === 'api') add('office-ai', 'Office AI · Cloudflare', 'AI and content', ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
    'General conversation, live research, saved tools, and reviewed Office commands.', {
      configured: present('CLOUDFLARE_ACCOUNT_ID') && present('CLOUDFLARE_API_TOKEN') || present('OFFICE_AI_RELAY_URL') && present('OFFICE_AI_RELAY_SECRET'),
      detail: 'Open Office AI → Connections to verify or connect Cloudflare, GitHub, and Render. Research availability depends on the connected AI Gateway and credits.',
    });
  add('youtube', 'YouTube search', 'Content sources', ['YOUTUBE_API_KEY'], 'Enables keyword search and duration information; public channel feeds remain available without it.');
  add('twitch', 'Twitch discovery', 'Content sources', ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'], 'Enables Twitch API discovery.', sourceRuntime('twitch'));
  if (role === 'pipeline') {
    for (const [id, label, description] of [
      ['reddit', 'Reddit public discovery', 'Uses the authorized Reddit API. Failed authorization does not fall back to anonymous access.'],
      ['twitter', 'X public discovery', 'Requires an app bearer token and provider-approved search access. Personal OAuth app credentials do not enable this worker.'],
      ['linkedin', 'LinkedIn public discovery', 'Requires a dedicated app-level token and approved access to the implemented public discovery API. A member sign-in client does not enable this worker.'],
      ['facebook', 'Facebook public discovery', 'Requires a dedicated app-level access token and approved access to the implemented public discovery API. Personal account credentials are separate.'],
      ['usajobs', 'USAJobs discovery', 'Requires the search API key and the email registered with USAJobs as its User-Agent.'],
    ]) {
      const readiness = getOfficeSourceReadiness(id, env);
      add(`source-${id}`, label, 'Content sources', readiness.requiredEnv, description, { configured: readiness.configured, ...sourceRuntime(id) });
    }
  }
  if (role === 'api') {
    add('agent-actions', 'AI agent action setup', 'Office controls', ['OFFICE_TOKEN', 'DATABASE_URL'], 'Choose and save a supported task in Live City → AI → Action setup, or run it from Controls.', {
      ...(!present('OFFICE_TOKEN') || !present('DATABASE_URL') ? {} : { status: database ? 'ready' : 'degraded' }),
      detail: 'Office access and the database store reviewed task runs. Supported controls work without an AI explanation key. Explanation requests use the configured model or gpt-5-mini by default.',
      capabilities: { actionControlsConfigured: present('OFFICE_TOKEN') && present('DATABASE_URL') && Boolean(database), explanationKeyConfigured: present('OPENAI_API_KEY'), modelConfigured: present('OFFICE_CHAT_OPENAI_MODEL') || present('AI_CONTENT_OPENAI_MODEL') },
    });
    const signIn = providerSettings(env);
    const callbackBase = (env.OAUTH_CALLBACK_BASE_URL || env.PUBLIC_API_URL || 'https://api.uficonnect.org').replace(/\/$/, '');
    const dedicatedGoogle = signIn.google.callbackPath === '/auth/providers/google/callback';
    const googleKeys = dedicatedGoogle ? ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET'] : ['YOUTUBE_CLIENT_ID','YOUTUBE_CLIENT_SECRET'];
    add('login-google', 'Google login and signup', 'Accounts and notifications', googleKeys, 'Account sign-in requests only openid, email and profile. This is separate from connecting a YouTube source.', {
      configured: signIn.google.configured,
      detail: `Use a Google OAuth web client and authorize ${callbackBase}${signIn.google.callbackPath}. Existing YouTube app credentials can be reused. Provider sign-in has not been tested by this inventory.`,
    });
    add('login-apple', 'Apple login and signup', 'Accounts and notifications', ['APPLE_CLIENT_ID','APPLE_TEAM_ID','APPLE_KEY_ID','APPLE_PRIVATE_KEY'], 'Requires an Apple Developer account, a Sign in with Apple Services ID associated with an app, and a private key.', {
      configured: signIn.apple.configured,
      detail: `Set APPLE_CLIENT_ID to the Services ID, APPLE_TEAM_ID to the developer team, APPLE_KEY_ID to the key ID, and APPLE_PRIVATE_KEY to the PEM .p8 key. Register the website domain and return URL ${callbackBase}/auth/providers/apple/callback. Requires HTTPS; callback uses form_post.`,
    });
    add('login-phone', 'Phone number login and signup', 'Accounts and notifications', ['TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_VERIFY_SERVICE_SID'], 'Requires a Twilio account and an SMS-enabled Verify service. Account creation and SMS billing must be set up in Twilio.', {
      configured: signIn.phone.configured,
      detail: 'Set the AC account SID, account auth token, and VA Verify service SID on the API service. Enable intended destination countries and review Twilio fraud protection, sender requirements and SMS charges. Codes expire after ten minutes; requests and verification attempts are limited.',
    });
    add('managed-recovery', 'Primary database recovery evidence', 'Core services', ['RENDER_API_KEY', 'RENDER_DATABASE_ID'], 'Reads Render point-in-time recovery and export metadata. Review Data recovery in Overview for verified provider status; restore drills are separate.');
    add('backup', 'Feed read failover', 'Core services', ['DATABASE_URL_BACKUP'], 'Copies a bounded recent feed snapshot. This does not back up accounts, messages, or the full database.', {
      status: !present('DATABASE_URL_BACKUP') ? 'missing' : backup.connected && backup.lastSyncAt ? 'ready' : 'degraded',
      detail: backup.connected && backup.lastSyncAt ? `Last successful feed sync: ${backup.lastSyncAt}` : 'Needs a connected backup database and a successful feed sync.',
    });
    const github = present('OFFICE_GITHUB_TOKEN') || present('AUTOFIX_GITHUB_TOKEN');
    add('github', 'Publish and deploy from Office', 'Release tools', ['OFFICE_GITHUB_TOKEN'], 'Enables reviewed frontend commits and verified deployment workflow dispatches.', {
      configured: github, detail: github ? 'A repository token is present. Verify Contents and Actions write access for UFIConnect/UFIConnect.' : 'Set OFFICE_GITHUB_TOKEN with Contents and Actions write access for UFIConnect/UFIConnect.',
    });
    add('render-status', 'Render deployment status', 'Release tools', ['RENDER_API_KEY', 'RENDER_SERVICE_API_ID', 'RENDER_SERVICE_PIPELINE_ID', 'RENDER_SERVICE_WEB_ID', 'RENDER_SERVICE_OFFICE_ID'], 'Allows Office to read deployment state for all four services.');
    add('autofix', 'Automatic fixes', 'Release tools', ['AUTOFIX_GITHUB_TOKEN', 'OPENAI_API_KEY'], 'Requires a dedicated repository write token and an explicit enable setting.', {
      ...(!autofixEnabled ? { status:'disabled', detail:'Automatic commits are disabled. Review the limits and enable this separately when intended.' } : {}),
    });
    add('uploads', 'Image and video storage', 'AI and content', ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'], 'Stores uploads and generated media.');
    add('narration', 'Narrated video', 'AI and content', ['OPENAI_API_KEY', 'SHOTSTACK_API_KEY', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'], 'Creates narrated video through Shotstack. Provider permissions and credits must be verified separately.');
    add('email', 'Password reset email', 'Accounts and notifications', ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'], 'Delivers password reset messages through your email provider.');
    add('push', 'Browser notifications', 'Accounts and notifications', ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'], 'Enables web push after the user grants notification permission.');
    add('billing', 'Subscriptions', 'Accounts and notifications', ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ID', 'STRIPE_PRICE_ID_BUSINESS', 'STRIPE_PRICE_ID_BUSINESS_TEAM'], 'Enables subscription checkout and webhook processing. Business requires USD 199.94/month for one person and USD 19.94/person/month for teams of two or more. Price IDs must belong to the configured Stripe account.');
    add('resume-billing', 'Resume Builder subscription', 'Accounts and notifications', ['STRIPE_RESUME_BUILDER_PRICE_ID'], 'Requires an active USD 149.94 price recurring every six months.', { configured: present('STRIPE_RESUME_BUILDER_PRICE_ID') || present('STRIPE_PRICE_ID_RESUME_BUILDER') });
    add('resume-monthly-billing', 'Resume Builder monthly subscription', 'Accounts and notifications', ['STRIPE_RESUME_BUILDER_MONTHLY_PRICE_ID'], 'Requires an active USD 30 price recurring every month. Grants the same Resume Builder access as the six-month option.', { configured: present('STRIPE_RESUME_BUILDER_MONTHLY_PRICE_ID') || present('STRIPE_PRICE_ID_RESUME_BUILDER_MONTHLY') });
    add('vpn-billing', 'UFI Vault membership', 'Accounts and notifications', ['STRIPE_VPN_CONNECTOR_PRICE_ID'], 'Requires an active USD 3.94 price recurring every month. Enables encrypted passwords, documents and keys. VPN gateway and client availability are checked separately.');
    for (const [provider, status] of Object.entries(social)) {
      add(`social-${provider}`, `${provider[0].toUpperCase()}${provider.slice(1)} account connection`, 'Connected accounts', status.requiredEnv || [], 'Users connect their own accounts after the provider app and callback are approved.', {
        configured: Boolean(status.configured),
        ...(status.disabled ? {status:'disabled'} : {}),
        detail: (status.disabled ? 'This integration is not enabled in the product. Credentials alone do not unlock its required provider approval or implementation.' : status.configured ? 'App credentials are present. Complete a real account connection to verify scopes and provider approval.' : 'Configure the provider app and register its callback.')
          + (status.callbackUrl ? ` Register redirect URI ${status.callbackUrl}.` : ''),
      });
    }
  }
  return { role, checkedAt: new Date().toISOString(), items, summary: Object.fromEntries(['ready', 'configured', 'missing', 'degraded', 'disabled'].map(status => [status, items.filter(item => item.status === status).length])) };
}
module.exports = { buildOfficeSetup, getOfficeSourceReadiness };
