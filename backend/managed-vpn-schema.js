'use strict';

const MANAGED_VPN_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS managed_vpn_devices (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gateway_id TEXT NOT NULL,
    public_key TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    tunnel_address TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    lease_expires_at TIMESTAMPTZ,
    CHECK (length(public_key) = 44),
    CHECK (length(label) BETWEEN 1 AND 80)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS managed_vpn_active_address_idx
    ON managed_vpn_devices(gateway_id,tunnel_address) WHERE revoked_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS managed_vpn_owner_idx ON managed_vpn_devices(user_id)`,
  `CREATE INDEX IF NOT EXISTS managed_vpn_gateway_idx ON managed_vpn_devices(gateway_id) WHERE revoked_at IS NULL`,
];

module.exports = { MANAGED_VPN_SCHEMA };
