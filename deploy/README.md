# UFconnect — AWS Deployment Guide

## Architecture

```
Internet
    │
    ▼
Route 53 (DNS)
    │
    ▼
CloudFront CDN ──── S3 (React web build / static assets)
    │
    ▼ /api/*
Application Load Balancer
    │
    ▼
EC2 / Elastic Beanstalk  ←─── ECR (Docker image)
    │
    ▼
RDS PostgreSQL (Multi-AZ)
```

---

## Step-by-step AWS Launch

### 1 — Prerequisites

```bash
# Install AWS CLI and configure credentials
brew install awscli
aws configure   # enter Access Key ID, Secret, region (e.g. us-east-1)

# Install Docker (for building images)
brew install --cask docker
```

---

### 2 — Database (RDS PostgreSQL)

1. Open **RDS → Create database**
2. Engine: **PostgreSQL 16**
3. Template: **Free tier** (for initial launch) or **Production**
4. DB identifier: `uficonnect-db`
5. Master username: `pc_admin`   Password: (generate and save securely)
6. Instance: `db.t3.micro` (free tier) or `db.t3.small`
7. Storage: 20 GB gp3
8. VPC: default (or your custom VPC)
9. Public access: **No** (EC2 connects within VPC)
10. Create database → wait ~5 min

Then run the schema:

```bash
psql "postgresql://pc_admin:<password>@<rds-endpoint>:5432/postgres" \
  -c "CREATE DATABASE uficonnect;"

psql "postgresql://pc_admin:<password>@<rds-endpoint>:5432/uficonnect" \
  -f backend/schema.sql
```

---

### 3 — Backend (Elastic Beanstalk)

```bash
# Install EB CLI
pip install awsebcli

cd /path/to/app

# Initialise EB app
eb init uficonnect-backend --platform docker --region us-east-1

# Create environment
eb create uficonnect-backend-prod \
  --envvars \
    NODE_ENV=production,\
    PORT=3000,\
    JWT_SECRET=<your-long-secret>,\
    DATABASE_URL=postgresql://pc_admin:<pw>@<rds-endpoint>:5432/uficonnect,\
    ALLOWED_ORIGINS=https://uficonnect.org,https://www.uficonnect.org

# Deploy
eb deploy
```

The EB environment will use `Dockerfile.backend` automatically.

---

### 4 — Web Frontend (S3 + CloudFront)

```bash
# Build the production React app
cd web
VITE_API_URL=https://api.uficonnect.org npm run build

# Create S3 bucket
aws s3 mb s3://uficonnect-web --region us-east-1
aws s3 website s3://uficonnect-web/ --index-document index.html --error-document index.html

# Upload build
aws s3 sync dist/ s3://uficonnect-web/ --delete

# Create CloudFront distribution (console → CloudFront → Create distribution)
# Origin: uficonnect-web.s3-website-us-east-1.amazonaws.com
# Default root object: index.html
# Error pages: 403/404 → /index.html (SPA routing)
# Add HTTPS certificate via ACM (free)
```

---

### 5 — Domain (Route 53)

1. Buy or transfer domain → **Route 53 → Register domain**
2. Create A record → alias to CloudFront distribution (web)
3. Create A record `api.uficonnect.org` → alias to EB load balancer

---

### 6 — Environment variables checklist

| Variable | Where | Value |
|---|---|---|
| `JWT_SECRET` | EB / EC2 | Long random string (32+ chars) |
| `DATABASE_URL` | EB / EC2 | `postgresql://...` RDS endpoint |
| `ALLOWED_ORIGINS` | EB / EC2 | `https://www.uficonnect.org` |
| `VITE_API_URL` | S3 build | `https://api.uficonnect.org` |

---

### 7 — Local development (Docker Compose)

```bash
# First-time setup
cp backend/.env.example backend/.env
# Edit backend/.env — set JWT_SECRET

# Start everything (DB + backend + web)
docker compose up --build

# Open app
open http://localhost
```

---

### Cost estimate (starter)

| Service | Config | ~Monthly |
|---|---|---|
| RDS PostgreSQL | db.t3.micro, 20 GB | $15–25 |
| EC2 / EB | t3.small single instance | $15–20 |
| S3 + CloudFront | < 50 GB transfer | $2–5 |
| Route 53 | 1 hosted zone | $0.50 |
| **Total** | | **~$35–50/mo** |

Free tier covers most of the first 12 months if you use a new AWS account.
