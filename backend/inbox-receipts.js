'use strict';

const INBOX_RECEIPTS_SCHEMA = `CREATE TABLE IF NOT EXISTS inbox_read_receipts (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, item_id)
)`;

function createInboxReceipts({ db, isDBId, getUser, saveUsers }) {
  function requireStorage(id) {
    if (isDBId(id) && !db.isConnected()) throw Object.assign(new Error('Inbox storage is temporarily unavailable.'), { status: 503 });
  }
  return {
    async read(userId, ids) {
      requireStorage(userId);
      if (!ids.length) return new Set();
      if (isDBId(userId)) {
        const { rows } = await db.query('SELECT item_id FROM inbox_read_receipts WHERE user_id=$1 AND item_id=ANY($2::text[])', [userId, ids]);
        return new Set(rows.map(row => row.item_id));
      }
      const user = await getUser(userId);
      return new Set(ids.filter(id => user?.inboxReadReceipts?.[id]));
    },
    async mark(userId, ids) {
      requireStorage(userId);
      ids = [...new Set(ids)].filter(id => typeof id === 'string' && id.length < 240).slice(0, 500);
      if (!ids.length) return [];
      if (isDBId(userId)) {
        await db.query(`INSERT INTO inbox_read_receipts (user_id,item_id)
          SELECT $1, unnest($2::text[]) ON CONFLICT (user_id,item_id) DO NOTHING`, [userId, ids]);
      } else {
        const user = await getUser(userId);
        if (!user) throw Object.assign(new Error('Account not found.'), { status: 404 });
        const previous = user.inboxReadReceipts;
        user.inboxReadReceipts = { ...previous, ...Object.fromEntries(ids.map(id => [id, new Date().toISOString()])) };
        try { saveUsers(); } catch (error) { user.inboxReadReceipts = previous; throw error; }
      }
      return ids;
    },
  };
}

module.exports = { INBOX_RECEIPTS_SCHEMA, createInboxReceipts };
