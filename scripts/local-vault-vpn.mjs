import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Local Windows/NetworkManager adapter only. The preview server must authenticate callers and
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
const NM_SERVICES = new Map([['org.freedesktop.NetworkManager.openvpn', 'OpenVPN']]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

// nmcli terse output escapes both colons and backslashes. No shell parsing.
export function parseNmcliRow(line) {
  const values = [''];
  let escaped = false;
  for (const char of line) {
    if (escaped) { values[values.length - 1] += char; escaped = false; }
    else if (char === '\\') escaped = true;
    else if (char === ':') values.push('');
    else values[values.length - 1] += char;
  }
  if (escaped) values[values.length - 1] += '\\';
  return values;
}

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
  const osLabel = platform === 'win32' ? 'Windows' : 'NetworkManager';
  const nmcli = '/usr/bin/nmcli';
  const activity = [];
  let actionInProgress = false;
  let statusRequest = null;

  function run(file, args, timeout) {
    return new Promise((resolve, reject) => {
      const child = execFileImpl(file, args, {
        shell: false, windowsHide: true, encoding: 'utf8',
        env: { ...env, LC_ALL: 'C', LANG: 'C' },
        timeout, maxBuffer: 256 * 1024,
      }, (error, stdout) => {
        // Do not propagate child stdout/stderr/errors: RAS diagnostics may
        // include account names, endpoints, or Windows credential details.
        if (error) reject(new Error('VPN command could not complete.'));
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

  async function readLinuxProfiles() {
    try {
      // Explicit metadata fields only. Never request --show-secrets, vpn.data,
      // IP addresses, gateway endpoints, or WireGuard private keys.
      const output = await run(nmcli, ['--terse', '--escape', 'yes', '--fields', 'UUID,TYPE,NAME,STATE', 'connection', 'show'], 12000);
      const rows = String(output).trim().split(/\r?\n/).filter(Boolean).map(parseNmcliRow);
      if (rows.length > 200) throw new Error('Too many profiles.');
      const vpnRows = rows.filter(([uuid, type]) => UUID.test(uuid) && ['vpn', 'wireguard'].includes(type));
      const protocols = new Map();
      const deadline = Date.now() + 12000;
      let nextRow = 0;
      // Limit concurrent processes and total enumeration time. A partial list
      // must never be treated as complete when checking for another active VPN.
      await Promise.all(Array.from({ length: Math.min(4, vpnRows.length) }, async () => {
        while (nextRow < vpnRows.length) {
          if (Date.now() >= deadline) throw new Error('VPN enumeration timed out.');
          const [uuid, type] = vpnRows[nextRow++];
          if (type === 'wireguard') protocols.set(uuid, 'WireGuard');
          else {
            const service = String(await run(nmcli, ['--get-values', 'vpn.service-type', 'connection', 'show', 'uuid', uuid], Math.max(1, Math.min(4000, deadline - Date.now())))).trim();
            protocols.set(uuid, NM_SERVICES.get(service) || 'Unsupported VPN');
          }
        }
      }));
      const entries = [];
      for (const [uuid, , name, state] of vpnRows) {
        const protocol = protocols.get(uuid);
        const status = ({ activated: 'connected', activating: 'connecting', deactivating: 'disconnecting', deactivated: 'disconnected', '': 'disconnected' })[state] || 'unknown';
        const unavailableReason = protocol === 'Unsupported VPN' ? 'Use a WireGuard or OpenVPN profile in NetworkManager. Manage other protocols in your VPN app.' : '';
        entries.push({ rawName: uuid, public: {
          id: createHash('sha256').update(`linux\0${uuid}`).digest('hex').slice(0, 32), name: cleanText(name),
          scope: 'networkManager', protocol, status, splitTunneling: null,
          canConnect: !unavailableReason && status === 'disconnected',
          canDisconnect: !unavailableReason && status === 'connected', unavailableReason,
        } });
      }
      return { available: true, entries, ...(!entries.length ? { message: 'No VPN profiles are configured in NetworkManager. Add an existing provider profile in your system network settings.' } : {}) };
    } catch {
      return { available: false, entries: [], message: 'NetworkManager VPN status is unavailable. Open your VPN app or system network settings.' };
    }
  }

  async function readProfiles() {
    if (platform === 'linux') return readLinuxProfiles();
    if (platform !== 'win32') return { available: false, entries: [], message: 'Local controls require Windows or Linux with NetworkManager. Use your VPN app or device settings.' };
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
    if (actionInProgress) throw new LocalVaultVpnError('VPN_BUSY', 'A VPN action is already running. Wait for its status before trying again.');
    if (typeof profileId !== 'string' || !/^[a-f0-9]{32}$/.test(profileId)) throw new LocalVaultVpnError('VPN_PROFILE_NOT_FOUND', 'Select a currently configured VPN profile.', 404);
    actionInProgress = true;
    let result;
    try {
      // Never trust a browser-supplied name, protocol, path, or a stale list.
      const before = await readProfiles();
      if (!before.available) throw new LocalVaultVpnError('VPN_UNAVAILABLE', before.message, 503);
      const entry = before.entries.find(item => item.public.id === profileId);
      if (!entry) throw new LocalVaultVpnError('VPN_PROFILE_NOT_FOUND', 'The selected VPN profile is no longer available on this device.', 404);
      const profile = entry.public;
      if (profile.unavailableReason) throw new LocalVaultVpnError('VPN_PROFILE_UNAVAILABLE', profile.unavailableReason);
      if (action === 'connect' && before.entries.some(item => item.public.id !== profileId && ['connected', 'connecting', 'disconnecting'].includes(item.public.status))) {
        throw new LocalVaultVpnError('VPN_OTHER_ACTIVE', 'Disconnect the other VPN profile before switching. Enable your provider’s kill switch in its app to protect traffic between connections.');
      }
      const targetStatus = action === 'connect' ? 'connected' : 'disconnected';
      if (profile.status === targetStatus) {
        result = { snapshot: before, confirmed: true };
      } else {
        if (!profile[action === 'connect' ? 'canConnect' : 'canDisconnect']) {
          throw new LocalVaultVpnError('VPN_STATUS_UNKNOWN', `${osLabel} has not confirmed a stable connection state. Refresh its status or use your VPN settings.`);
        }
        // Scope-specific phonebooks avoid controlling a different same-name
        // entry from the other scope. Arguments go directly to rasdial.exe.
        const args = [entry.rawName, `/phonebook:${phonebook(profile.scope)}`];
        if (action === 'disconnect') args.push('/disconnect');
        activity.unshift({ timestamp: now().toISOString(), action });
        activity.length = Math.min(activity.length, 50);
        let commandFailed = false;
        try {
          if (platform === 'linux') await run(nmcli, ['--wait', '40', 'connection', action === 'connect' ? 'up' : 'down', 'uuid', entry.rawName], 45000);
          else await run(rasdial, args, 45000);
        } catch { commandFailed = true; }
        const after = await readProfiles();
        const actual = after.entries.find(item => item.public.id === profileId)?.public.status;
        const confirmed = after.available && actual === targetStatus;
        result = {
          snapshot: after, confirmed,
          ...(!confirmed ? { message: commandFailed
            ? `${osLabel} could not confirm this VPN action. Check the profile and saved credentials in your VPN settings; no password is collected here.`
            : `${osLabel} has not yet confirmed the requested VPN state. Refresh status or check your VPN settings.` } : {}),
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
