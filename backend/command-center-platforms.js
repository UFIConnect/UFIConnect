'use strict';

// Account connections can be useful without a personal feed or posting API.
// Request only profile access for these providers and keep publishing separate.
function profileOAuthConfig(env = process.env) {
  return {
    discord: {
      authUrl: 'https://discord.com/oauth2/authorize',
      tokenUrl: 'https://discord.com/api/oauth2/token',
      clientId: () => env.DISCORD_CLIENT_ID,
      clientSecret: () => env.DISCORD_CLIENT_SECRET,
      scope: 'identify', pkce: false, basicAuth: true,
      profileUrl: 'https://discord.com/api/v10/users/@me',
    },
    figma: {
      authUrl: 'https://www.figma.com/oauth',
      tokenUrl: 'https://api.figma.com/v1/oauth/token',
      clientId: () => env.FIGMA_CLIENT_ID,
      clientSecret: () => env.FIGMA_CLIENT_SECRET,
      scope: 'current_user:read', pkce: true, basicAuth: true,
      profileUrl: 'https://api.figma.com/v1/me',
    },
  };
}

const PROFILE_PLATFORMS = {
  discord: {
    name: 'Discord', color: '#5865F2', icon: 'discord',
    description: 'Connect your Discord profile to your Command Center.',
    scopes: ['identify'], authUrl: 'https://discord.com/oauth2/authorize',
    loginUrl: 'https://discord.com/login', siteUrl: 'https://discord.com/channels/@me',
    setupUrl: 'https://discord.com/developers/applications', reviewRequired: false,
    note: 'Profile connection. Server messages and publishing require a separate server integration.',
  },
  figma: {
    name: 'Figma', color: '#A259FF', icon: 'figma',
    description: 'Connect your Figma profile and open your design workspace.',
    scopes: ['current_user:read'], authUrl: 'https://www.figma.com/oauth',
    loginUrl: 'https://www.figma.com/login', siteUrl: 'https://www.figma.com/files',
    setupUrl: 'https://www.figma.com/developers/apps', reviewRequired: true,
    note: 'Profile connection. File access and publishing are separate capabilities; Figma controls which accounts can authorize this app.',
  },
};

module.exports = { profileOAuthConfig, PROFILE_PLATFORMS };
