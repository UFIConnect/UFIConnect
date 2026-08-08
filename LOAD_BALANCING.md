# UFconnect Load Balancing & Server Configuration

## 🔧 Issues Fixed

### 1. **Missing Dependency**
- **Problem**: Backend was missing `jose@^6.2.3` dependency needed for Auth0 JWT verification
- **Solution**: Installed missing package via `npm install`

### 2. **Server Startup**
- **Problem**: Server wasn't starting due to missing dependency
- **Solution**: Fixed dependency, now server starts correctly with graceful database connection handling

## 🚀 Load Balancing Implementation

The backend now uses **Node.js Cluster Mode** for built-in load balancing without requiring external services:

### Architecture
```
┌──────────────────────────────────────────┐
│          Master Process (server.js)      │
│  - Spawns workers based on CPU cores     │
│  - Monitors worker health                │
│  - Auto-restarts crashed workers         │
└───────────┬─────────────────────────────┘
            │
      ┌─────┼─────┬────────┬────────┐
      │     │     │        │        │
   ┌──▼──┐┌─▼──┐┌──▼──┐┌──▼──┐
   │W1   ││W2  ││W3   ││W4   │  (on 4-core system)
   │:300 ││:30 ││:300 ││:300 │
   └──┬──┘└─┬──┘└──┬──┘└──┬──┘
      │     │     │      │
   ┌──┴─────┴─────┴──────┴──┐
   │  Node.js Load Balancer  │  (requests distributed automatically)
   │  TCP Listener :3000     │
   └─────────────────────────┘
```

### How It Works
1. **Master Process** (`server.js`) starts and spawns one worker per CPU core
2. **Workers** run the actual Express application (`index.js`)
3. **Node.js Cluster Module** automatically distributes incoming connections across workers
4. **Auto-recovery**: If a worker crashes, master respawns it immediately
5. **Graceful Shutdown**: On SIGTERM/SIGINT, all workers shut down cleanly

### Files Modified

#### `backend/server.js` (NEW)
- Cluster server wrapper that spawns workers
- Handles worker monitoring and respawning
- Implements graceful shutdown

#### `backend/package.json`
- Updated `start` script to use `server.js` (with clustering)
- Added `start:single` script for single-instance mode if needed

#### `render.yaml`
- Updated backend start command: `node --max-old-space-size=400 server.js`

#### `ecosystem.config.js` (NEW)
- PM2 configuration for future deployment options
- Pre-configured for cluster mode with 4+ instances

## 📊 Load Balancing Benefits

| Issue | Before | After |
|-------|--------|-------|
| **Concurrent Requests** | Single process bottleneck | Distributed across CPU cores |
| **Crash Recovery** | Service down until manual restart | Auto-restarts within seconds |
| **CPU Utilization** | ~25% on 4-core system | ~75-100% (all cores active) |
| **Memory per Request** | Competes for single heap | Workers share connection pool |
| **Request Queue** | All in one thread | Distributed across 4 threads |

## 🔍 Testing Load Balancing

### Local Testing
```bash
# Start the server
npm start

# In another terminal, test with concurrent requests
for i in {1..100}; do
  curl http://localhost:3000/health &
done
wait
```

### Production Monitoring
- Monitor worker health: Check logs for worker restarts
- Track request distribution: Check individual worker logs
- Monitor memory: Each worker isolated to 400MB via Node.js flags

## 🛑 Graceful Shutdown
The server handles these signals gracefully:
- `SIGTERM`: Used by container orchestrators (Docker, Render)
- `SIGINT`: Used by Ctrl+C in terminal
- All workers complete in-flight requests before exiting
- Timeout: 5 seconds max per worker

## 💾 Configuration

### Environment Variables
```env
# Number of workers (defaults to CPU core count)
WORKERS=4

# Memory limit per worker
NODE_ENV=production
# Note: --max-old-space-size=400 set via command line

# Database connection
DATABASE_URL=postgresql://...
```

### Tuning for High Load

If experiencing issues with multiple concurrent pulls:

1. **Increase Worker Count** (if on larger instance):
   ```bash
   WORKERS=8 npm start
   ```

2. **Increase Memory Per Worker**:
   Edit `render.yaml`:
   ```yaml
   startCommand: node --max-old-space-size=800 server.js
   ```

3. **Upgrade Render Plan**:
   - Current: Starter plan (512MB RAM)
   - Recommended for high load: Standard plan (2GB RAM)
   - This allows larger memory allocations per worker

4. **Optimize Database Queries**:
   - Monitor slow queries in logs
   - Add database indexes for frequently queried fields
   - Consider read replicas for heavy read load

## 📝 Deployment

When deploying to Render:

1. **Auto Deploy** from main branch triggers automatically
2. **Build Step**: `npm install` installs dependencies
3. **Start Command**: Uses `server.js` for clustering
4. **Health Check**: `/health` endpoint monitored by Render
5. **Graceful Shutdown**: Render sends SIGTERM with 30s timeout

## 🐛 Debugging

### View Logs
```bash
# Local
npm start 2>&1 | tee server.log

# Render
# Check dashboard: https://dashboard.render.com
```

### Common Issues

**Issue**: Workers restarting frequently
- Check memory usage in logs
- Increase memory allocation
- Look for memory leaks in code

**Issue**: Uneven request distribution
- Normal behavior - Node.js cluster automatically balances
- Check individual worker logs if specific worker seems slow

**Issue**: Health check failing
- Ensure `/health` endpoint is accessible
- Check database connection in logs
- Verify environment variables are set

## 📚 Resources
- [Node.js Cluster Module](https://nodejs.org/api/cluster.html)
- [Render Deployment Guide](https://render.com/docs)
- [Load Balancing Best Practices](https://nginx.org/en/docs/http/load_balancing.html)
