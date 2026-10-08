'use strict';

const { randomUUID } = require('node:crypto');

const GENERATION_LIMITS = Object.freeze({ video: 20, image: 50, resume: 30 });
const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS generation_usage (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('video', 'image', 'resume')),
    period_start DATE NOT NULL CHECK (EXTRACT(DAY FROM period_start) = 1),
    used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
    PRIMARY KEY (user_id, kind, period_start)
  )`,
  `CREATE TABLE IF NOT EXISTS generation_usage_reservations (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    kind TEXT NOT NULL,
    period_start DATE NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'completed', 'released')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (user_id, kind, period_start)
      REFERENCES generation_usage(user_id, kind, period_start) ON DELETE CASCADE
  )`,
];

function calendarMonth(value) {
  const date = new Date(value);
  return {
    startsAt: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString(),
    resetsAt: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString(),
  };
}

function publicUsage(period, counts) {
  return {
    period,
    limits: Object.fromEntries(Object.entries(GENERATION_LIMITS).map(([kind, limit]) => {
      const used = Number(counts[kind] || 0);
      return [kind, { limit, used, remaining: Math.max(0, limit - used) }];
    })),
  };
}

function createGenerationUsage({ query, connected, now = Date.now }) {
  async function run(sql, params) {
    try {
      if (!connected()) throw new Error('Database unavailable');
      return await query(sql, params);
    } catch {
      // Quotas must survive worker restarts and outages; never admit requests
      // using local counters when the authoritative database cannot be read.
      throw Object.assign(new Error('Generation limits are temporarily unavailable. Please try again.'), {
        status: 503, code: 'GENERATION_USAGE_UNAVAILABLE',
      });
    }
  }

  async function readUsage(userId, period) {
    const { rows } = await run('SELECT kind, used FROM generation_usage WHERE user_id=$1 AND period_start=$2::date',
      [userId, period.startsAt.slice(0, 10)]);
    return publicUsage(period, Object.fromEntries(rows.map(row => [row.kind, row.used])));
  }

  async function transition(reservation, state) {
    const params = [reservation.id, reservation.userId, reservation.kind, reservation.periodStart.slice(0, 10)];
    if (state === 'completed') {
      const { rows } = await run(`UPDATE generation_usage_reservations SET state='completed'
        WHERE id=$1 AND user_id=$2 AND kind=$3 AND period_start=$4::date AND state='pending' RETURNING id`, params);
      return rows.length > 0;
    }
    // The durable pending -> released transition owns the decrement. Repeated
    // or concurrent releases cannot decrement twice or release a completed job.
    const { rows } = await run(`WITH released AS (
      UPDATE generation_usage_reservations SET state='released'
      WHERE id=$1 AND user_id=$2 AND kind=$3 AND period_start=$4::date AND state='pending'
      RETURNING user_id, kind, period_start
    )
    UPDATE generation_usage AS usage SET used=usage.used-1 FROM released
    WHERE usage.user_id=released.user_id AND usage.kind=released.kind AND usage.period_start=released.period_start
    RETURNING usage.used`, params);
    return rows.length > 0;
  }

  return {
    usage(userId) { return readUsage(userId, calendarMonth(now())); },

    async reserve(userId, kind) {
      if (!Object.hasOwn(GENERATION_LIMITS, kind)) {
        throw Object.assign(new Error('Invalid generation type.'), { status: 400 });
      }
      const period = calendarMonth(now());
      const id = randomUUID();
      // ON CONFLICT locks the shared monthly counter and tests its latest value,
      // including other workers' pending requests. The reservation is inserted
      // in this same statement, so either both writes commit or neither does.
      const { rows } = await run(`WITH reserved_usage AS (
        INSERT INTO generation_usage AS usage (user_id, kind, period_start, used)
        VALUES ($1,$2,$3::date,1)
        ON CONFLICT (user_id, kind, period_start) DO UPDATE SET used=usage.used+1
        WHERE usage.used < $4 RETURNING used
      ), reservation AS (
        INSERT INTO generation_usage_reservations (id, user_id, kind, period_start)
        SELECT $5,$1,$2,$3::date FROM reserved_usage RETURNING id
      )
      SELECT reservation.id, reserved_usage.used AS reserved_used,
        COALESCE((SELECT used FROM generation_usage WHERE user_id=$1 AND kind='video' AND period_start=$3::date),0) AS video_used,
        COALESCE((SELECT used FROM generation_usage WHERE user_id=$1 AND kind='image' AND period_start=$3::date),0) AS image_used,
        COALESCE((SELECT used FROM generation_usage WHERE user_id=$1 AND kind='resume' AND period_start=$3::date),0) AS resume_used
      FROM reservation CROSS JOIN reserved_usage`,
      [userId, kind, period.startsAt.slice(0, 10), GENERATION_LIMITS[kind], id]);
      if (!rows.length) {
        // A fresh statement sees the committed count after a competing worker
        // filled the last slot; the original statement snapshot may be older.
        const usage = await readUsage(userId, period);
        throw Object.assign(new Error(`Your monthly ${kind} generation limit has been reached.`), {
          status: 429, code: 'MONTHLY_GENERATION_LIMIT', kind, usage, resetsAt: period.resetsAt,
        });
      }
      const row = rows[0];
      const counts = { video: row.video_used, image: row.image_used, resume: row.resume_used, [kind]: row.reserved_used };
      return { id: row.id, userId, kind, periodStart: period.startsAt, usage: publicUsage(period, counts) };
    },

    complete(reservation) { return transition(reservation, 'completed'); },
    release(reservation) { return transition(reservation, 'released'); },
  };
}

module.exports = { createGenerationUsage, GENERATION_LIMITS, schemaStatements };
