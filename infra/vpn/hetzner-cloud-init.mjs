import { stringify } from 'yaml';
import { isIP } from 'node:net';

export function renderGatewayCloudInit({ gatewayId, token, adminPublicKey, adminAddress, agentSource }) {
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(gatewayId)) throw new Error('Invalid gateway id');
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new Error('Gateway token must contain at least 32 random bytes');
  if (!/^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [A-Za-z0-9_.@-]+)?$/.test(adminPublicKey)) throw new Error('An Ed25519 administrator public key is required');
  if (isIP(adminAddress) !== 4) throw new Error('One administrator IPv4 address is required');
  if (typeof agentSource !== 'string' || !agentSource.length) throw new Error('Gateway agent source is required');
  const subnet = '10.80.0.0/24';
  const ipv6Subnet = 'fd80:80:0::/64';
  const files = [];
  const file = (path, content, permissions = '0600') => files.push({ path, owner: 'root:root', permissions, content });
  file('/etc/ufi-vpn/gateway.json', JSON.stringify({ gatewayId, token, apiOrigin: 'https://api.uficonnect.org', subnet, ipv6Subnet }) + '\n');
  file('/usr/local/lib/ufi-vpn/gateway-agent.mjs', agentSource, '0644');
  file('/etc/sysctl.d/90-ufi-vpn.conf', 'net.ipv4.ip_forward=1\nnet.ipv4.conf.all.accept_redirects=0\nnet.ipv4.conf.all.send_redirects=0\nnet.ipv6.conf.all.forwarding=0\nnet.ipv6.conf.all.accept_redirects=0\n');
  file('/etc/nftables.conf', `#!/usr/sbin/nft -f
flush ruleset
table inet ufi_vpn {
  chain input {
    type filter hook input priority filter; policy drop;
    iifname "lo" accept
    ct state established,related accept
    ip protocol icmp accept
    meta l4proto ipv6-icmp accept
    ip saddr ${adminAddress} tcp dport 22 accept
    udp dport 51820 accept
    iifname "ufi0" ip daddr 10.80.0.1 udp dport 53 accept
    iifname "ufi0" ip daddr 10.80.0.1 tcp dport { 53, 8787 } accept
  }
  chain forward {
    type filter hook forward priority filter; policy drop;
    iifname "ufi0" oifname "ufi0" drop
    iifname "ufi0" meta nfproto ipv6 drop
    iifname "ufi0" ip daddr { 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.0.0.0/24, 192.168.0.0/16, 224.0.0.0/4, 240.0.0.0/4 } drop
    iifname "ufi0" tcp dport 25 drop
    iifname "ufi0" accept
    oifname "ufi0" ct state established,related accept
  }
  chain output { type filter hook output priority filter; policy accept; }
}
table ip ufi_nat {
  chain postrouting { type nat hook postrouting priority srcnat; ip saddr ${subnet} oifname != "ufi0" masquerade; }
}
`, '0644');
  file('/etc/unbound/unbound.conf.d/ufi-vpn.conf', `server:
  interface: 10.80.0.1
  ip-freebind: yes
  access-control: ${subnet} allow
  access-control: 0.0.0.0/0 refuse
  do-ip6: no
  hide-identity: yes
  hide-version: yes
  verbosity: 0
  log-queries: no
  log-replies: no
  private-address: 10.0.0.0/8
  private-address: 172.16.0.0/12
  private-address: 192.168.0.0/16
  private-address: 169.254.0.0/16
  private-address: 127.0.0.0/8
`, '0644');
  file('/usr/local/sbin/ufi-vpn-setup', `#!/bin/sh
set -eu
umask 077
install -d -m 700 /etc/wireguard /etc/ufi-vpn
if [ ! -s /etc/wireguard/ufi0.key ]; then wg genkey > /etc/wireguard/ufi0.key; fi
wg pubkey < /etc/wireguard/ufi0.key > /etc/ufi-vpn/public.key
key="$(cat /etc/wireguard/ufi0.key)"
printf '[Interface]\\nAddress = 10.80.0.1/24, fd80:80:0::1/64\\nListenPort = 51820\\nPrivateKey = %s\\nSaveConfig = false\\n' "$key" > /etc/wireguard/ufi0.conf
unset key
sysctl --system >/dev/null
nft --check --file /etc/nftables.conf
systemctl enable --now nftables.service
systemctl enable --now wg-quick@ufi0.service
systemctl restart unbound.service
install -d -m 700 /run/ufi-vpn
node /usr/local/lib/ufi-vpn/gateway-agent.mjs --boot
systemctl enable --now ufi-vpn-poll.timer ufi-vpn-expiry.timer ufi-vpn-health.service
`, '0700');
  file('/etc/systemd/system/ufi-vpn-agent.service', `[Unit]
Description=UFI VPN authorized peer synchronization
After=network-online.target wg-quick@ufi0.service
Wants=network-online.target
Requires=wg-quick@ufi0.service nftables.service
[Service]
Type=oneshot
ExecStart=/usr/bin/flock -w 2 /run/ufi-vpn/agent.lock /usr/bin/node /usr/local/lib/ufi-vpn/gateway-agent.mjs --poll
TimeoutStartSec=25
RuntimeDirectory=ufi-vpn
RuntimeDirectoryMode=0700
RuntimeDirectoryPreserve=yes
UMask=0077
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=/run/ufi-vpn
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_BIND_SERVICE
`, '0644');
  file('/etc/systemd/system/ufi-vpn-poll.timer', '[Unit]\nDescription=Refresh UFI VPN paid access\n[Timer]\nOnBootSec=5\nOnUnitActiveSec=30\nAccuracySec=1\nUnit=ufi-vpn-agent.service\n[Install]\nWantedBy=timers.target\n', '0644');
  file('/etc/systemd/system/ufi-vpn-expiry.service', `[Unit]
Description=Remove expired UFI VPN authorization independently of the sync agent
After=wg-quick@ufi0.service
[Service]
Type=oneshot
ExecStart=/usr/bin/flock -w 20 /run/ufi-vpn/agent.lock /usr/bin/node /usr/local/lib/ufi-vpn/gateway-agent.mjs --expire
TimeoutStartSec=30
RuntimeDirectory=ufi-vpn
RuntimeDirectoryMode=0700
RuntimeDirectoryPreserve=yes
UMask=0077
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/run/ufi-vpn
CapabilityBoundingSet=CAP_NET_ADMIN
`, '0644');
  file('/etc/systemd/system/ufi-vpn-expiry.timer', '[Unit]\nDescription=Enforce UFI VPN expiry\n[Timer]\nOnBootSec=15\nOnUnitActiveSec=15\nAccuracySec=1\n[Install]\nWantedBy=timers.target\n', '0644');
  file('/usr/local/lib/ufi-vpn/health.mjs', `import http from 'node:http';\nhttp.createServer((req,res)=>{if(req.method!=='GET'||req.url!=='/health'){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({ok:true,gatewayId:${JSON.stringify(gatewayId)}}));}).listen(8787,'10.80.0.1');\n`, '0644');
  file('/etc/systemd/system/ufi-vpn-health.service', `[Unit]
Description=UFI VPN tunnel-only health check
After=wg-quick@ufi0.service
Requires=wg-quick@ufi0.service
[Service]
ExecStart=/usr/bin/node /usr/local/lib/ufi-vpn/health.mjs
User=nobody
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
Restart=on-failure
[Install]
WantedBy=multi-user.target
`, '0644');
  return '#cloud-config\n' + stringify({
    package_update: true,
    package_upgrade: true,
    packages: ['wireguard-tools', 'nftables', 'unbound', 'nodejs', 'ca-certificates', 'unattended-upgrades'],
    ssh_pwauth: false,
    disable_root: true,
    users: [{ name: 'ufivpn-admin', groups: ['sudo'], shell: '/bin/bash', sudo: 'ALL=(ALL) NOPASSWD:ALL', lock_passwd: true, ssh_authorized_keys: [adminPublicKey] }],
    write_files: files,
    runcmd: [['systemctl', 'daemon-reload'], ['/usr/local/sbin/ufi-vpn-setup']],
  });
}
