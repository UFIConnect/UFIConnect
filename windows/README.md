# UFIConnect VPN for Windows

Native Windows Forms client for the UFIConnect managed VPN API. This is an initial **unsigned validation build**, with a reviewable installer bootstrap. Its C# code compiles using the built-in .NET Framework compiler, and local policy checks pass. Neither installer nor a real Windows tunnel has been run in this workspace.

## What is included

- Direct sign-in, Connect, Disconnect, and Sign out in UFIConnect VPN.
- Local WireGuard key creation. The API receives only the public key.
- Current-user DPAPI encryption for the local session/key file, plus an encrypted WireGuard configuration with administrator/System-only storage. The tunnel configuration uses DPAPI machine scope so the WireGuard LocalSystem service can read it.
- Five-minute maximum server authorization, renewed every 30 seconds. Native service state plus a recent server handshake is required to show Connected.
- Separate watchdog process checking the app process, heartbeat, monotonic deadline, and server expiry every second. It stops the owned tunnel if the app disappears, stalls, or expires. The app also stops if the watchdog exits. Server authorization expires independently if both processes disappear.
- Both default IP routes and gateway DNS. IPv6 is routed into the VPN and blocked at the gateway.
- The reserved service name is `WireGuardTunnel$UFIConnectManaged`. No other tunnel is managed.

Closing the app or expiry stops the VPN and restores ordinary Windows networking. This client does not claim to keep a persistent traffic block after disconnection. It does not collect browsing history, packet logs, or WireGuard diagnostic logs.

## Prerequisites

Windows 10/11 x64, .NET Framework 4.8, and administrator access. Extract the entire validation ZIP and open `UFIConnectVpnSetup.exe`. After Windows UAC and an explicit installation confirmation, the bootstrap installs the official WireGuard prerequisite if missing, copies UFIConnect VPN into Program Files, and creates a Start menu shortcut. It does not start a tunnel, request credentials, or launch the app automatically. Profiles do not need to be imported.

Setup pins the official HTTPS `wireguard-amd64-1.1.1.msi` download (3,293,184 bytes, SHA256 `7bfed60ad61b785c914b38b61555a975488e1d3ec472dbfb2fcdf498fca75242`). That reference package was downloaded and its signature verified as **Valid, WireGuard LLC** without executing it. Setup rejects redirects, changed hashes, untrusted signatures, unexpected publishers, unsafe paths, or modified client payloads. It uses `DO_NOT_LAUNCH=1` for the WireGuard MSI. Existing official signed WireGuard installations are preserved.

The client checks both installed `wireguard.exe` and `wg.exe` using Windows Authenticode trust validation and the WireGuard LLC publisher before creating a tunnel. Untrusted/missing binaries prevent connection.

The UFIConnect backend must expose the managed VPN routes and have a healthy gateway. VPN authorization requires an active paid membership. This first client supports UFIConnect email/password sessions; Auth0 browser sign-in is not implemented.

## Build without cloud credits

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File windows\build.ps1
```

The process-local execution policy option does not change the machine's policy. The script compiles `dist/UFIConnectVpn.exe` and `dist/UFIConnectVpnSetup.exe`, runs policy and signature-rejection checks, and packages `dist/UFIConnect-VPN-Windows-x64-validation.zip`. Tests do not touch drivers, services, installed VPNs, or live accounts. Neither client nor installer is launched by the build script.

## Before distributing

1. Sign both executables with UFIConnect's Windows code-signing identity. Sign the client **before** generating the bootstrap's embedded client checksum, then compile and sign the bootstrap. The present binaries have no publisher signature.
2. Test on an isolated Windows 10 and Windows 11 VM with the official WireGuard installation: paid enrollment, actual handshake, DNS/IPv4 routing and IPv6 blocking, renewal, cancellation, network timeout, service failure, UI crash, watchdog termination, clock change, logout, and reboot. Confirm no unrelated tunnel is changed.
3. Verify the installed WireGuard tools' Authenticode publisher on the supported installer release; this client deliberately fails closed if the upstream publisher changes.
4. Test the bootstrap on a clean VM and on a VM with an existing WireGuard installation. Confirm declined approval, corrupted payload, signature/hash failure, and download errors never invoke MSI. This repository does not install a driver during builds.

The current window must stay open while connected. Automatic reconnect after startup/reboot, tray-only operation, multiuser sessions, browser sign-in, and code signing are not included in this validation build. The installer is implemented but has not been executed or validated on a clean VM.

## Upstream references

- [WireGuard enterprise installation and tunnel service CLI](https://git.zx2c4.com/wireguard-windows/about/docs/enterprise.md)
- [Official embedding design](https://git.zx2c4.com/wireguard-windows/about/embeddable-dll-service/README.md)
- [WireGuard DPAPI name verification](https://git.zx2c4.com/wireguard-windows/plain/conf/dpapi/dpapi_windows.go)
- [WireGuard default-route firewall behavior](https://git.zx2c4.com/wireguard-windows/about/docs/netquirk.md)

The application uses the installed official tunnel service. It does not bundle an independently built `tunnel.dll` or implement a WireGuard protocol stack.
