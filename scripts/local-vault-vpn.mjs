import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Local Windows adapter only. The preview server must authenticate callers and
// enforce loopback Host/Origin + CSRF before exposing these methods over HTTP.
// Never import this module into the production API or a browser bundle.
// Windows references:
// https://learn.microsoft.com/en-us/powershell/module/vpnclient/get-vpnconnection
// https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-server-2012-r2-and-2012/ff859533(v=ws.11)
// https://learn.microsoft.com/en-us/windows-server/remote/remote-access/configure-vpn-protocols
// https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/vpn/vpn-connection-type
const ENUMERATE_PROFILES = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$profiles = @()
$failedScopes = @()
foreach ($scope in @('user', 'allUsers')) {
  try {
    $connections = if ($scope -eq 'allUsers') {
      @(Get-VpnConnection -AllUserConnection -ErrorAction Stop)
    } else {
      @(Get-VpnConnection -ErrorAction Stop)
    }
    foreach ($connection in $connections) {
      $profiles += [pscustomobject]@{
        name = [string]$connection.Name
        scope = $scope
        protocol = [string]$connection.TunnelType
        status = [string]$connection.ConnectionStatus
        splitTunneling = [bool]$connection.SplitTunneling
      }
    }
  } catch {
    $failedScopes += $scope
  }
}
[pscustomobject]@{ profiles = @($profiles); failedScopes = @($failedScopes) } | ConvertTo-Json -Compress -Depth 4
`;
const ENCODED_ENUMERATION = Buffer.from(ENUMERATE_PROFILES, 'utf16le').toString('base64');
const PROTOCOLS = new Map([['ikev2', 'IKEv2'], ['sstp', 'SSTP']]);
const STATUSES = new Set(['connected', 'disconnected', 'connecting', 'disconnecting']);
const cleanText = (value, limit = 256) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, limit);
const safeEntryName = name => Boolean(name) && name.length <= 256 && name === name.trim()
  && !/^[/-]|[\u0000-\u001f\u007f"]/.test(name);

export class LocalVaultVpnError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = 'LocalVaultVpnError';
    this.code = code;
    this.status = status;
  }
}

export function createLocalVaultVpn({
  execFileImpl = execFile,
  platform = process.platform,
  env = process.env,
  now = () => new Date(),
} = {}) {
  const windowsRoot = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows';
  const powershell = path.win32.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const rasdial = path.win32.join(windowsRoot, 'System32', 'rasdial.exe');
  const userData = env.APPDATA || '';
  const commonData = env.ProgramData || env.PROGRAMDATA || '';
  const activity = [];
  let actionInProgress = false;
  let statusRequest = null;

  function run(file, args, timeout) {
    return new Promise((resolve, reject) => {
      const child = execFileImpl(file, args, {
        shell: false, windowsHide: true, encoding: 'utf8',
        timeout, maxBuffer: 256 * 1024,
      }, (error, stdout) => {
        // Do not propagate child stdout/stderr/errors: RAS diagnostics may
        // include account names, endpoints, or Windows credential details.
        if (error) reject(new Error('Windows command could not complete.'));
        else resolve(stdout);
      });
      // rasdial uses credentials already stored by Windows. It must never
      // receive a password, read browser input, or wait for a password prompt.
      child?.stdin?.end();
    });
  }

  function phonebook(scope) {
    const base = scope === 'allUsers' ? commonData : userData;
    if (!base || !path.win32.isAbsolute(base) || /[\u0000-\u001f\u007f"]/.test(base)) return null;
    return path.win32.join(base, 'Microsoft', 'Network', 'Connections', 'Pbk', 'rasphone.pbk');
  }

  async function readProfiles() {
    if (platform !== 'win32') return { available: false, entries: [], message: 'Windows VPN controls are available only on the Windows computer running this local preview.' };
    try {
      const output = await run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED_ENUMERATION], 12000);
      const parsed = JSON.parse(String(output || '').replace(/^\uFEFF/, '').trim());
      if (!Array.isArray(parsed.profiles) || !Array.isArray(parsed.failedScopes) || parsed.profiles.length > 200) throw new Error('Unexpected profile data.');
      const failed = new Set(parsed.failedScopes.filter(scope => ['user', 'allUsers'].includes(scope)));
      const entries = [];
      const seen = new Set();
      for (const raw of parsed.profiles) {
        if (!raw || typeof raw.name !== 'string' || !['user', 'allUsers'].includes(raw.scope) || failed.has(raw.scope)) continue;
        const id = createHash('sha256').update(`${raw.scope}\0${raw.name}`).digest('hex').slice(0, 32);
        if (seen.has(id)) continue;
        seen.add(id);
        const protocol = PROTOCOLS.get(String(raw.protocol || '').toLowerCase()) || cleanText(raw.protocol, 32) || 'Unknown';
        const reportedStatus = String(raw.status || '').toLowerCase();
        const status = STATUSES.has(reportedStatus) ? reportedStatus : 'unknown';
        let unavailableReason = '';
        if (!PROTOCOLS.has(String(raw.protocol || '').toLowerCase())) {
          unavailableReason = 'Use a Windows VPN profile explicitly configured for IKEv2 or SSTP. Automatic, PPTP, L2TP, and other protocols are unavailable here.';
        } else if (!safeEntryName(raw.name)) {
          unavailableReason = 'This profile name cannot be controlled here. Manage it in Windows VPN settings.';
        } else if (!phonebook(raw.scope)) {
          unavailableReason = 'The Windows phonebook location is unavailable. Manage this profile in Windows VPN settings.';
        }
        entries.push({
          rawName: raw.name,
          public: {
            id, name: cleanText(raw.name), scope: raw.scope, protocol, status,
            splitTunneling: raw.splitTunneling === true,
            canConnect: !unavailableReason && status === 'disconnected',
            canDisconnect: !unavailableReason && status === 'connected',
            unavailableReason,
          },
        });
      }
      return {
        available: failed.size < 2,
        entries,
        ...(failed.size ? { message: failed.size === 2
          ? 'Windows VPN profiles could not be read. Open Windows VPN settings to check this computer.'
          : 'Some Windows VPN profiles could not be read. Open Windows VPN settings to see all profiles.' }
          : !entries.length ? { message: 'No Windows VPN profiles are configured. Add an IKEv2 or SSTP connection in Windows VPN settings.' } : {}),
      };
    } catch {
      return { available: false, entries: [], message: 'Windows VPN status is unavailable. Open Windows VPN settings to check the current connection.' };
    }
  }

  function publicStatus(snapshot) {
    return {
      available: snapshot.available,
      platform: platform === 'win32' ? 'windows' : cleanText(platform, 32),
      busy: actionInProgress,
      profiles: snapshot.entries.map(({ public: profile }) => ({
        ...profile,
        canConnect: profile.canConnect && !actionInProgress,
        canDisconnect: profile.canDisconnect && !actionInProgress,
      })),
      activity: activity.map(item => ({ ...item })),
      ...(snapshot.message ? { message: snapshot.message } : {}),
    };
  }

  async function status() {
    // Concurrent read requests share one OS query, but no status is cached.
    if (!statusRequest) statusRequest = readProfiles().finally(() => { statusRequest = null; });
    return publicStatus(await statusRequest);
  }

  async function act(action, profileId) {
    if (actionInProgress) throw new LocalVaultVpnError('VPN_BUSY', 'A Windows VPN action is already running. Wait for its status before trying again.');
    if (typeof profileId !== 'string' || !/^[a-f0-9]{32}$/.test(profileId)) throw new LocalVaultVpnError('VPN_PROFILE_NOT_FOUND', 'Select a currently configured Windows VPN profile.', 404);
    actionInProgress = true;
    let result;
    try {
      // Never trust a browser-supplied name, protocol, path, or a stale list.
      const before = await readProfiles();
      if (!before.available) throw new LocalVaultVpnError('VPN_UNAVAILABLE', before.message, 503);
      const entry = before.entries.find(item => item.public.id === profileId);
      if (!entry) throw new LocalVaultVpnError('VPN_PROFILE_NOT_FOUND', 'The selected VPN profile is no longer available in Windows.', 404);
      const profile = entry.public;
      if (profile.unavailableReason) throw new LocalVaultVpnError('VPN_PROFILE_UNAVAILABLE', profile.unavailableReason);
      const targetStatus = action === 'connect' ? 'connected' : 'disconnected';
      if (profile.status === targetStatus) {
        result = { snapshot: before, confirmed: true };
      } else {
        if (!profile[action === 'connect' ? 'canConnect' : 'canDisconnect']) {
          throw new LocalVaultVpnError('VPN_STATUS_UNKNOWN', 'Windows has not confirmed a stable connection state. Refresh its status or use Windows VPN settings.');
        }
        // Scope-specific phonebooks avoid controlling a different same-name
        // entry from the other scope. Arguments go directly to rasdial.exe.
        const args = [entry.rawName, `/phonebook:${phonebook(profile.scope)}`];
        if (action === 'disconnect') args.push('/disconnect');
        activity.unshift({ timestamp: now().toISOString(), action });
        activity.length = Math.min(activity.length, 50);
        let commandFailed = false;
        try { await run(rasdial, args, 45000); } catch { commandFailed = true; }
        const after = await readProfiles();
        const actual = after.entries.find(item => item.public.id === profileId)?.public.status;
        const confirmed = after.available && actual === targetStatus;
        result = {
          snapshot: after, confirmed,
          ...(!confirmed ? { message: commandFailed
            ? 'Windows could not confirm this VPN action. Check the profile and its saved credentials in Windows VPN settings; no password is collected here.'
            : 'Windows has not yet confirmed the requested VPN state. Refresh status or check Windows VPN settings.' } : {}),
        };
      }
    } finally {
      actionInProgress = false;
    }
    return {
      ...publicStatus(result.snapshot),
      operation: { action, confirmed: result.confirmed },
      ...(result.message ? { message: result.message } : {}),
    };
  }

  // Only call these from explicit, authenticated user-button requests.
  // There is no auto-connect, credential store, traffic/IP logging, or polling
  // mutation. A reported connected profile is not an anonymity guarantee.
  return { status, connect: profileId => act('connect', profileId), disconnect: profileId => act('disconnect', profileId) };
}
