'use strict';
const unavailable = () => Object.assign(new Error('Messaging account permissions are temporarily unavailable.'), {status:503});

function createMessageAccess({db,isDBId,localRelationship,localBlockedIds}) {
  async function relationship(userId,otherId,queryClient = db) {
    if (!isDBId(userId) || !isDBId(otherId)) return localRelationship(userId,otherId);
    if (!db.isConnected()) throw unavailable();
    try {
      const {rows:[row]} = await queryClient.query(`SELECT
        EXISTS(SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)) AS blocked,
        EXISTS(SELECT 1 FROM connections WHERE status='accepted' AND ((from_id=$1 AND to_id=$2) OR (from_id=$2 AND to_id=$1))) AS connected,
        EXISTS(SELECT 1 FROM follows WHERE (follower_id=$1 AND following_id=$2) OR (follower_id=$2 AND following_id=$1)) AS related,
        EXISTS(SELECT 1 FROM direct_messages WHERE (sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1)) AS existing`,[userId,otherId]);
      if (!row) throw unavailable();
      return {blocked:row.blocked,connected:row.connected,canViewPrivate:row.connected||row.related,existing:row.existing};
    } catch { throw unavailable(); }
  }
  async function blockedIds(userId) {
    if (!isDBId(userId)) return new Set(localBlockedIds(userId));
    if (!db.isConnected()) throw unavailable();
    try {
      const {rows} = await db.query('SELECT CASE WHEN blocker_id=$1 THEN blocked_id ELSE blocker_id END AS id FROM blocks WHERE blocker_id=$1 OR blocked_id=$1',[userId]);
      return new Set(rows.map(row=>row.id));
    } catch { throw unavailable(); }
  }
  return {relationship,blockedIds};
}
module.exports = {createMessageAccess};
