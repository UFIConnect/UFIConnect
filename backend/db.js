/**
 * db.js — PostgreSQL connection with graceful in-memory fallback.
 *
 * If DATABASE_URL is set and reachable → useDB = true, all queries
 * run against PostgreSQL.  If the env var is missing or the first
 * connection attempt fails → useDB = false and the app continues
 * with the in-memory mock data already defined in index.js.
 */

const { Pool } = require('pg');

let pool = null;
let _connected = false;

async function initDB() {
  if (!process.env.DATABASE_URL) {
    console.log('ℹ️  DATABASE_URL not set — running with in-memory data.');
    return;
  }

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔗 Connecting to PostgreSQL (attempt ${attempt}/${maxRetries})...`);
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl:
          process.env.NODE_ENV === 'production'
            ? { rejectUnauthorized: false }   // AWS RDS / Heroku / Render
            : false,
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 15_000,    // Increased for Render
        statement_timeout: 30_000,           // Add statement timeout
      });

      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      _connected = true;
      console.log('✅ PostgreSQL connected');
      return;
    } catch (err) {
      console.warn(
        `⚠️  PostgreSQL connection failed (attempt ${attempt}/${maxRetries}):\n  ` +
        `Error: ${err.message}\n  Code: ${err.code || 'unknown'}`,
      );
      pool = null;
      _connected = false;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2000)); // Wait 2s before retry
      }
    }
  }
  console.warn('⚠️  PostgreSQL unavailable after all retries — using in-memory data.');
}

/** Run a parameterised query. Throws if DB is not connected. */
async function query(text, params) {
  if (!pool || !_connected) {
    throw new Error('DB not available');
  }
  return pool.query(text, params);
}

/** Whether the database connection is live. */
function isConnected() {
  return _connected;
}

module.exports = { initDB, query, isConnected };
