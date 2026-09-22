// Authenticate at request entry, then re-check durable ownership immediately
// before a delayed write. Account deletion uses the same users row locks.
async function withActiveMembers(db, memberIds, work) {
  if (!db.isConnected()) throw Object.assign(new Error('Account storage is temporarily unavailable.'), { status: 503 });
  return db.withClient(async client => {
    await client.query('BEGIN');
    try {
      const members = new Map();
      // Stable ordering prevents two opposite-direction messages deadlocking.
      for (const id of [...new Set(memberIds)].sort()) {
        const { rows: [row] } = await client.query('SELECT id, name, billing_closed FROM users WHERE id=$1 FOR UPDATE', [id]);
        if (!row || row.billing_closed) throw Object.assign(new Error('This account is unavailable.'), { status: 404 });
        members.set(id, row);
      }
      const result = await work(client, members);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

module.exports = { withActiveMembers };
