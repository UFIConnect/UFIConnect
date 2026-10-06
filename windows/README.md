# UFIConnect VPN for Windows

Native Windows Forms client for the UFIConnect managed VPN API. This is an initial **unsigned validation build**, with a reviewable installer bootstrap. Its C# code compiles using the built-in .NET Framework compiler, and local policy checks pass. Neither installer nor a real Windows tunnel has been run in this workspace.

## What is included

- Direct sign-in, Connect, Disconnect, and Sign out in UFIConnect VPN.
- Website Connect opens the installed app with a single-use connection link. The app consumes it through its own authenticated UFIConnect session before connecting. An already open app receives it through a local pipe restricted to the same Windows user.
- Local WireGuard key creation. The API receives only the public key.
- Current-user DPAPI encryption for the saved sign-in, plus an encrypted WireGuard configuration with administrator/System-only storage. Tunnel keys are excluded from the saved sign-in. The tunnel configuration uses DPAPI machine scope so the WireGuard LocalSystem service can read it.
- Five-minute maximum server authorization, renewed every 30 seconds. Native service state plus a recent server handshake is required to show Connected.
- Separate watchdog process checking the app process, heartbeat, monotonic deadline, and server expiry every second. It stops the owned tunnel if the app disappears, stalls, or expires. The app also stops if the watchdog exits. Server authorization expires independently if both processes disappear.
- Both default IP routes and gateway DNS. IPv6 is routed into the VPN and blocked at the gateway.
- The reserved service name is `WireGuardTunnel$UFIConnectManaged`. No other tunnel is managed.

Closing the app or expiry stops the VPN and restores ordinary Windows networking. Normal close and Disconnect retain the encrypted sign-in; explicit Sign out deletes it and requests server session revocation. An expired/revoked sign-in requires login again. Closing does not leave a persistent traffic block after disconnection. The app collects no analytics, browsing history, packet logs, or WireGuard diagnostic logs. Account-linked public keys, labels, assigned VPN addresses, gateway selection, and authorization times support access and connection management. Hosting providers process traffic to deliver the service; VPN activity is not sold or used for advertising or AI training. See the [UFIConnect privacy policy](https://uficonnect.org/privacy).

## Connect from the website

1. Install the complete validation package once, accepting the Windows installation prompts.
2. On the UFIConnect VPN page, click Connect and allow the browser to open UFIConnect VPN.
3. On first use, allow UAC and sign in with the same UFIConnect account. The pending request connects automatically after sign-in. Subsequent requests reuse the open app and its saved sign-in.

Connection links expire after 180 seconds and are retained only in memory. Expired, replayed, malformed, wrong-account, or wrong-platform requests cannot start a tunnel. Codes are never saved to disk, copied to the clipboard, or logged. Signing out discards pending requests; closing or disconnecting invalidates in-flight connection attempts. Ordinary app startup does not reconnect automatically.

The installer registers only `uficonnect-vpn://connect?code=<canonical 43-character base64url code>` to a quoted, fixed GUI executable. The app rejects extra fields and arguments. The launcher forwards to an existing instance before requesting elevation. Its local pipe grants access only to the current Windows SID and verifies the sender's impersonated SID. A medium-integrity mandatory label permits the same user's normal browser launcher to reach the elevated GUI; remote pipe clients are rejected. There is no command shell or console in this flow.

## Prerequisites

Windows 10/11 x64, .NET Framework 4.8, and an administrator Windows account. The browser and app must run as the same Windows user; entering a different administrator's credentials at UAC is rejected. Extract the entire validation ZIP and open `UFIConnectVpnSetup.exe`. After Windows UAC and an explicit installation confirmation, the bootstrap installs the official WireGuard prerequisite if missing, copies UFIConnect VPN into Program Files, registers connection links, and creates a Start menu shortcut. It does not start a tunnel, request credentials, or launch the app automatically. Profiles do not need to be imported.

Setup pins the official HTTPS `wireguard-amd64-1.1.1.msi` download (3,293,184 bytes, SHA256 `7bfed60ad61b785c914b38b61555a975488e1d3ec472dbfb2fcdf498fca75242`). That reference package was downloaded and its signature verified as **Valid, WireGuard LLC** without executing it. Setup rejects redirects, changed hashes, untrusted signatures, unexpected publishers, unsafe paths, or modified client payloads. It uses `DO_NOT_LAUNCH=1` for the WireGuard MSI. Existing official signed WireGuard installations are preserved.

The client checks both installed `wireguard.exe` and `wg.exe` using Windows Authenticode trust validation and the WireGuard LLC publisher before creating a tunnel. Untrusted/missing binaries prevent connection.

The UFIConnect backend must expose the managed VPN routes and have a healthy gateway. VPN authorization requires an active paid membership. This first client supports UFIConnect email/password sessions; Auth0 browser sign-in is not implemented.

## Build without cloud credits

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File windows\build.ps1
```

The process-local execution policy option does not change the machine's policy. The script compiles `dist/UFIConnectVpn.exe` and `dist/UFIConnectVpnSetup.exe` with warnings as errors, runs 76 policy, DPAPI, real local pipe, and signature-rejection checks, and packages `dist/UFIConnect-VPN-Windows-x64-validation.zip`. Tests use an isolated pipe name and do not touch drivers, services, registry protocol settings, installed VPNs, or live accounts. Neither client nor installer is launched by the build script. The GUI starts as its caller so it can forward first; the installer retains its separate administrator manifest.

## Before distributing

1. Sign both executables with UFIConnect's Windows code-signing identity. Sign the client **before** generating the bootstrap's embedded client checksum, then compile and sign the bootstrap. The present binaries have no publisher signature.
2. Test on an isolated Windows 10 and Windows 11 VM with the official WireGuard installation: paid enrollment, actual handshake, DNS/IPv4 routing and IPv6 blocking, renewal, cancellation, network timeout, service failure, UI crash, watchdog termination, clock change, logout, and reboot. Confirm no unrelated tunnel is changed.
3. Verify the installed WireGuard tools' Authenticode publisher on the supported installer release; this client deliberately fails closed if the upstream publisher changes.
4. Test the bootstrap on a clean VM and on a VM with an existing WireGuard installation. Confirm declined approval, corrupted payload, signature/hash failure, and download errors never invoke MSI. This repository does not install a driver during builds.
5. Test a real browser protocol launch from medium integrity into the elevated GUI on both supported Windows versions, repeated Connect requests, different Windows users, cancelled UAC, signed-out/expired sessions, account mismatch, and close/disconnect during consumption. Unit checks cover the descriptor, sender identity, and same-user pipe transport; they do not execute UAC or replace this VM check.

The current window must stay open while connected. Automatic reconnect after startup/reboot, tray-only operation, simultaneous Windows-user tunnels, Auth0 browser sign-in, and code signing are not included in this validation build. The installer and browser registration are implemented but have not been executed or validated on a clean VM. The public API must also permit native authenticated requests without a browser challenge.

## Upstream references

- [WireGuard enterprise installation and tunnel service CLI](https://git.zx2c4.com/wireguard-windows/about/docs/enterprise.md)
- [Official embedding design](https://git.zx2c4.com/wireguard-windows/about/embeddable-dll-service/README.md)
- [WireGuard DPAPI name verification](https://git.zx2c4.com/wireguard-windows/plain/conf/dpapi/dpapi_windows.go)
- [WireGuard default-route firewall behavior](https://git.zx2c4.com/wireguard-windows/about/docs/netquirk.md)
- [Microsoft named-pipe client impersonation](https://learn.microsoft.com/en-us/windows/win32/ipc/impersonating-a-named-pipe-client)

The application uses the installed official tunnel service. It does not bundle an independently built `tunnel.dll` or implement a WireGuard protocol stack.
