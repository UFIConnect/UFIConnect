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
  // Existing native clients retain their explicit, expiring client lease.
  // Imported profiles are a separate, owner-revocable registration; only the
  // gateway's independently verified short lease grants network access.
  `ALTER TABLE managed_vpn_devices ADD COLUMN IF NOT EXISTS enrollment_mode TEXT NOT NULL DEFAULT 'native'
    CHECK (enrollment_mode IN ('native','profile'))`,
  `ALTER TABLE managed_vpn_devices ADD COLUMN IF NOT EXISTS registration_auth_version INTEGER
    CHECK (registration_auth_version >= 0)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS managed_vpn_active_address_idx
    ON managed_vpn_devices(gateway_id,tunnel_address) WHERE revoked_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS managed_vpn_owner_idx ON managed_vpn_devices(user_id)`,
  `CREATE INDEX IF NOT EXISTS managed_vpn_gateway_idx ON managed_vpn_devices(gateway_id) WHERE revoked_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS managed_vpn_launches (
    token_hash TEXT PRIMARY KEY CHECK (length(token_hash)=64),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK (platform IN ('windows','ios','android')),
    auth_version INTEGER NOT NULL,
    initiating_session_id UUID REFERENCES auth_sessions(id) ON DELETE CASCADE,
    initiating_auth_subject TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    UNIQUE(user_id,platform)
  )`,
  `CREATE INDEX IF NOT EXISTS managed_vpn_launch_expiry_idx ON managed_vpn_launches(expires_at)`,
];

module.exports = { MANAGED_VPN_SCHEMA };
