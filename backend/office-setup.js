// Configuration inventory only: never return environment values or provider errors.
function buildOfficeSetup({ env = {}, role = 'api', database = false, backup = {}, social = {}, autofixEnabled = env.AUTOFIX_ENABLED === 'true' } = {}) {
  const items = [];
  const present = key => Boolean(String(env[key] || '').trim());
  const add = (id, label, category, keys, description, options = {}) => {
    const missing = keys.filter(key => !present(key));
    const configured = options.configured ?? missing.length === 0;
    items.push({ id, label, category, description, requiredEnv: keys, missingEnv: configured ? [] : missing,
      status: options.status || (configured ? 'configured' : 'missing'),
      detail: options.detail || (configured ? 'Settings are present. Provider access has not been tested.' : 'Add the missing settings to this Render service, then redeploy.'),
    });
  };
  add('database', 'Primary database', 'Core services', ['DATABASE_URL'], 'Stores accounts, posts, settings, and Office history.', {
    status: database ? 'ready' : present('DATABASE_URL') ? 'degraded' : 'missing',
    detail: database ? 'The service reports an active database connection.' : 'The primary database is not connected. Check its connection, storage, and TLS settings.',
  });
  add('office', 'Office access', 'Core services', ['OFFICE_TOKEN'], 'Protects administration on desktop and mobile.');
  add('sessions', 'Persistent sign-in', 'Core services', ['JWT_SECRET', 'OAUTH_TOKEN_ENCRYPTION_KEY'], 'Keep stable, matching keys on API and pipeline so sessions and connected-account credentials survive deployments.');
  add('agent-chat', 'Agent explanations', 'AI and content', ['OPENAI_API_KEY'], 'Enables AI explanations of curated agent metrics. Local diagnostic replies remain available without this key.');
  add('youtube', 'YouTube search', 'Content sources', ['YOUTUBE_API_KEY'], 'Enables keyword search and duration information; public channel feeds remain available without it.');
  add('twitch', 'Twitch discovery', 'Content sources', ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'], 'Enables Twitch API discovery.');
  if (role === 'api') {
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
    add('billing', 'Subscriptions', 'Accounts and notifications', ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ID', 'STRIPE_PRICE_ID_BUSINESS'], 'Enables subscription checkout and webhook processing. Price IDs must belong to the configured Stripe account.');
    add('resume-billing', 'Resume Builder subscription', 'Accounts and notifications', ['STRIPE_RESUME_BUILDER_PRICE_ID'], 'Requires an active USD 149.94 price recurring every six months.', { configured: present('STRIPE_RESUME_BUILDER_PRICE_ID') || present('STRIPE_PRICE_ID_RESUME_BUILDER') });
    add('vpn-billing', 'VPN Connector subscription', 'Accounts and notifications', ['STRIPE_VPN_CONNECTOR_PRICE_ID'], 'Requires an active USD 3.94 price recurring every month. This pays for saved UFI connector locations, not a VPN provider plan.');
    for (const [provider, status] of Object.entries(social)) {
      add(`social-${provider}`, `${provider[0].toUpperCase()}${provider.slice(1)} account connection`, 'Connected accounts', status.requiredEnv || [], 'Users connect their own accounts after the provider app and callback are approved.', {
        configured: Boolean(status.configured),
        ...(status.disabled ? {status:'disabled'} : {}),
        detail: status.disabled ? 'This integration is not enabled in the product. Credentials alone do not unlock its required provider approval or implementation.' : status.configured ? 'App credentials are present. Complete a real account connection to verify scopes and provider approval.' : 'Configure the provider app and register the callback shown in the account connection settings.',
      });
    }
  }
  return { role, checkedAt: new Date().toISOString(), items, summary: Object.fromEntries(['ready', 'configured', 'missing', 'degraded', 'disabled'].map(status => [status, items.filter(item => item.status === status).length])) };
}
module.exports = { buildOfficeSetup };
