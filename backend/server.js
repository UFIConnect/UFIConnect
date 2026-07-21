/**
 * Cluster server wrapper — spawns worker processes for load balancing
 * without requiring additional infrastructure or PM2.
 *
 * On multi-core systems, this creates one worker per CPU core,
 * automatically distributing incoming requests across workers.
 */

const cluster = require('cluster');
const os = require('os');

const numWorkers = process.env.WORKERS || os.cpus().length;

if (cluster.isMaster) {
  console.log(`🚀 Master process starting ${numWorkers} worker(s)...`);

  // Spawn worker processes
  for (let i = 0; i < numWorkers; i++) {
    cluster.fork();
  }

  // Handle worker crashes — restart them
  cluster.on('exit', (worker, code, signal) => {
    console.warn(`⚠️  Worker ${worker.process.pid} died (${signal || code}). Respawning...`);
    cluster.fork();
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('📍 SIGTERM received, shutting down gracefully...');
    for (const id in cluster.workers) {
      cluster.workers[id].kill();
    }
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('📍 SIGINT received, shutting down gracefully...');
    for (const id in cluster.workers) {
      cluster.workers[id].kill();
    }
    process.exit(0);
  });
} else {
  // Worker process — run the actual application
  require('./index.js');
}
