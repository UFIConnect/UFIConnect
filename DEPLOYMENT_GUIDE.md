# UFIConnect Deployment & Load Balancing Guide

## 🚀 Quick Start

### Production Deployment (Render)

The backend now automatically uses load balancing across CPU cores:

```bash
# Push to main branch — Render auto-deploys
git push origin main

# The deployment will:
# 1. Install dependencies
# 2. Start server with clustering (backend/server.js)
# 3. Spawn one worker per CPU core
# 4. Distribute incoming requests automatically
```

**Expected behavior after deployment:**
- ✅ Server starts in ~30-60 seconds
- ✅ Health check endpoint responds at `/health`
- ✅ Multiple workers visible in logs (one per core)
- ✅ Requests distributed automatically

---

## 🐳 Local Development

### Option 1: Simple Development (Single Process)

```bash
cd backend
npm install
npm run dev          # Watch mode
# or
npm start            # Production-like with clustering
```

### Option 2: Docker with Load Balancing

For realistic multi-worker testing locally:

```bash
# Uses nginx to load balance between 2 backend instances
docker-compose -f docker-compose.lb.yml up -d

# Services:
# - API on http://localhost:3000 (via nginx load balancer)
# - Postgres on localhost:5432
# - Web on http://localhost:80

# View logs
docker-compose -f docker-compose.lb.yml logs -f api-lb

# Stop
docker-compose -f docker-compose.lb.yml down
```

### Option 3: Standard Development (Single Container)

```bash
docker-compose up -d
# API: http://localhost:3000
# Web: http://localhost:80
# Postgres: localhost:5432
```

---

## 🧪 Testing Load Balancing

### Test 1: Concurrent Requests

```bash
# Generate 100 concurrent requests
for i in {1..100}; do
  curl -s http://localhost:3000/health &
done
wait

# All should complete successfully
# Multiple workers handle requests simultaneously
```

### Test 2: Worker Restart Behavior

```bash
# Find a worker process ID
ps aux | grep "node" | grep -v grep

# Kill it manually
kill -9 <PID>

# Watch logs — master immediately spawns replacement
npm start 2>&1 | grep -i "worker\|respawn"
```

### Test 3: Load Distribution

```bash
# In docker-compose.lb.yml setup:
docker-compose -f docker-compose.lb.yml logs -f api-lb | grep "upstream: "

# Each line shows which backend handled the request
# Should see both backend-1 and backend-2 in logs
```

---

## 📊 Monitoring & Debugging

### Check Server Health

```bash
# Health endpoint
curl http://localhost:3000/health

# Expected response:
# {"status":"ok","db":true}  ← Database connected
# {"status":"ok","db":false} ← Running on fallback data
```

### View Logs

**Production (Render):**
- Dashboard: https://dashboard.render.com
- Select uficonnect-api service
- View live logs

**Local:**
```bash
npm start 2>&1 | tee server.log
# or with docker
docker-compose logs -f backend
```

### Common Issues

**Issue: "Too many open files"**
```bash
# Increase system limits (macOS)
ulimit -n 65536

# Or start with reduced workers
WORKERS=2 npm start
```

**Issue: Port 3000 already in use**
```bash
# Find process on port 3000
lsof -i :3000

# Kill it
kill -9 <PID>
```

**Issue: Database connection timeout**
```bash
# Check DATABASE_URL is valid
echo $DATABASE_URL

# Test connection
psql $DATABASE_URL -c "SELECT 1"
```

---

## 🔧 Configuration Reference

### Render Environment Variables

Set in Render dashboard:
```
JWT_SECRET              → Your JWT signing key
DATABASE_URL            → PostgreSQL connection string
AUTH0_DOMAIN            → Auth0 domain
AUTH0_AUDIENCE          → Auth0 API identifier
ALLOWED_ORIGINS         → CORS origins (comma-separated)
NODE_ENV                → Set to "production"
```

### Server Configuration

**Master process** (`backend/server.js`):
- Forks workers (one per CPU core by default)
- Monitors worker health
- Respawns crashed workers
- Handles graceful shutdown

**Worker configuration** in `server.js`:
```javascript
const numWorkers = process.env.WORKERS || os.cpus().length;
// Spawn numWorkers processes
// Each gets full Express app (index.js)
```

**Memory allocation** in `render.yaml`:
```yaml
startCommand: node --max-old-space-size=400 server.js
```

---

## 🚦 Scaling Strategy

### Current Setup (Starter Plan)
- **Instances**: 1 Render web service
- **Workers**: 1-4 per CPU core in starter plan (~2 cores)
- **Memory**: 512MB total
- **Throughput**: ~100 concurrent requests

### For Higher Load

**Option 1: Scale Vertically (Recommended)**
```bash
# Upgrade Render plan: Starter → Standard
# Standard: 2GB RAM, allows more workers and larger heap
# Update render.yaml:
startCommand: node --max-old-space-size=1024 server.js
```

**Option 2: Scale Horizontally**
```bash
# Add multiple Render services behind a load balancer
# Requires external load balancer (AWS ALB, Cloudflare, etc.)
# More complex setup, better for enterprise scale
```

**Option 3: Hybrid (Best)**
```bash
# Use larger Render plan (Standard/Pro)
# Keep clustering enabled (multiple workers per instance)
# Combine vertical + horizontal scaling
```

---

## 📈 Performance Tuning

### Database Optimization
1. **Connection Pooling**: Already configured in `db.js`
   - Max 10 connections per worker
   - Idle timeout: 30s
   - Connection timeout: 15s

2. **Query Optimization**
   - Check slow query logs
   - Add indexes on frequently filtered columns
   - Use EXPLAIN ANALYZE on slow queries

3. **Read Replicas** (PostgreSQL)
   - For heavy read workloads
   - Route GET requests to replicas
   - Reduces load on primary

### Request Optimization
1. **Caching**
   - Add Redis for session/data caching
   - Cache API responses in memory
   - Use HTTP caching headers

2. **Compression**
   - Already enabled: gzip compression
   - Saves 70-90% on JSON responses

3. **Rate Limiting**
   - Consider adding to prevent abuse
   - Protects against DDoS

---

## 🔄 CI/CD Deployment Flow

```
┌─────────────────┐
│  Push to main   │
└────────┬────────┘
         │
┌────────▼─────────────┐
│  Render Build Starts  │
│  npm install ✓        │
└────────┬─────────────┘
         │
┌────────▼──────────────────────┐
│  Start Command Executes        │
│  node --max-old-space...       │
│  server.js (clustering)        │
└────────┬──────────────────────┘
         │
┌────────▼────────────────────────┐
│  Master Process Starts          │
│  Spawns N workers               │
│  Health check: /health          │
└────────┬────────────────────────┘
         │
┌────────▼──────────────────────┐
│  Render Routes Traffic         │
│  uficonnect-api.onrender.com   │
│  Ready for production traffic   │
└────────────────────────────────┘
```

---

## 💡 Tips & Best Practices

1. **Always test locally first**
   - Use docker-compose.lb.yml for multi-worker testing
   - Catch issues before production

2. **Monitor logs**
   - Set up log aggregation (e.g., Papertrail)
   - Watch for worker crashes
   - Track error patterns

3. **Gradual rollout**
   - Deploy during low-traffic period
   - Monitor for 10-15 minutes
   - Have rollback plan ready

4. **Regular maintenance**
   - Update dependencies monthly
   - Check for security patches
   - Review and optimize slow queries

5. **Document changes**
   - Update this guide when changing configuration
   - Keep environment variables documented
   - Record deployment decisions

---

## 📞 Support & Resources

- **Node.js Cluster**: https://nodejs.org/api/cluster.html
- **Render Documentation**: https://render.com/docs
- **PostgreSQL Optimization**: https://www.postgresql.org/docs/current/
- **Express.js Guide**: https://expressjs.com/
