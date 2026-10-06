'use strict';

// Account-wide session revocation and VPN revocation must commit together.
// Enrollment locks the same owner before allocating a device, so a concurrent
// password reset cannot leave a previously authorized device active.
async function mutateAccountAndRevokeVpn(db, userId, change) {
  return db.withClient(async client => {
    await client.query('BEGIN');
    try {
      const { rows } = await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      if (!rows[0]) throw Object.assign(new Error('Account unavailable.'), { status: 404 });
      const result = await change(client);
      await client.query(`UPDATE managed_vpn_devices SET revoked_at=NOW(),lease_expires_at=NOW()
        WHERE user_id=$1 AND revoked_at IS NULL`, [userId]);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}
module.exports = { mutateAccountAndRevokeVpn };
