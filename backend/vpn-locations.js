const { randomUUID } = require('node:crypto');
const failure = (status, message) => Object.assign(new Error(message), { status });
const cleanLabel = value => typeof value === 'string' && value.trim().length >= 1
  && value.trim().length <= 80 && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : null;

function createVpnLocations({ db, billing }) {
  async function requireAccess(userId) {
    const status = await billing.status(userId);
    if (!status.vpnConnectorAddon) throw failure(403, 'Subscribe to UFI VPN Connector to save and sync your configured locations.');
  }
  async function list(userId) {
    // Read/delete remain available after cancellation so people retain control
    // of their saved metadata. Only creating synced labels is subscription-gated.
    if (!db.isConnected()) throw failure(503, 'Account storage is temporarily unavailable.');
    return { locations: (await db.query('SELECT id,platform,name,country FROM vault_vpn_locations WHERE user_id=$1 ORDER BY country,name,id', [userId])).rows };
  }
  async function add(userId, value) {
    await requireAccess(userId);
    if (!value || Object.keys(value).some(key => !['platform', 'name', 'country'].includes(key))
      || !['windows', 'linux', 'ios', 'android'].includes(value.platform)
      || !cleanLabel(value.name) || !cleanLabel(value.country)) {
      throw failure(400, 'Provide a device type, profile label and country only, each label up to 80 characters.');
    }
    return db.withClient(async client => {
      await client.query('BEGIN');
      try {
        // Lock the owner so parallel adds cannot exceed the per-account limit.
        const { rows: [owner] } = await client.query('SELECT vpn_connector_addon,billing_closed FROM users WHERE id=$1 FOR UPDATE', [userId]);
        if (!owner?.vpn_connector_addon || owner.billing_closed) throw failure(403, 'Your VPN Connector subscription is not active.');
        const { rows: [count] } = await client.query('SELECT count(*)::int AS total FROM vault_vpn_locations WHERE user_id=$1', [userId]);
        if (count.total >= 40) throw failure(409, 'You can save up to 40 VPN locations. Remove a location before adding another.');
        const { rows: [location] } = await client.query('INSERT INTO vault_vpn_locations(id,user_id,platform,name,country) VALUES($1,$2,$3,$4,$5) RETURNING id,platform,name,country', [randomUUID(), userId, value.platform, cleanLabel(value.name), cleanLabel(value.country)]);
        await client.query('COMMIT');
        return { location };
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    });
  }
  async function remove(userId, id) {
    // Owners may erase their saved metadata even after canceling the add-on.
    if (!db.isConnected()) throw failure(503, 'Account storage is temporarily unavailable.');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id || '')) throw failure(400, 'Choose a saved location.');
    await db.query('DELETE FROM vault_vpn_locations WHERE user_id=$1 AND id=$2', [userId, id]);
    return { removed: true };
  }
  return { list, add, remove };
}
module.exports = { createVpnLocations };
