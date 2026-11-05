const KEY_SETUP = {
  devto: { label: 'DEV API key', setupUrl: 'https://dev.to/settings/extensions', settingsLabel: 'DEV account settings', description: 'Create an API key in your DEV account settings, then enter it here.' },
  hashnode_blog: { label: 'Hashnode personal access token', setupUrl: 'https://hashnode.com/settings/developer', settingsLabel: 'Hashnode developer settings', description: 'Create a personal access token in your Hashnode developer settings, then enter it here. Publishing requires an eligible publication.' },
};

export function apiKeyConnectionSetup(source, platform = {}) {
  const setup = KEY_SETUP[source];
  if (!setup) return null;
  return { ...setup, label: platform.apiKeyLabel || setup.label, description: platform.apiKeyDescription || setup.description,
    setupUrl: platform.apiKeySetupUrl === setup.setupUrl ? platform.apiKeySetupUrl : setup.setupUrl };
}
