# UFIconnect

A starter workspace for an ad-free professional networking app that connects groups and people.

## Structure

- `mobile/` - Expo React Native app for iOS, Android, and web.
- `backend/` - Node.js + Express API for authentication, groups, and connections.

## Getting Started

1. Use Node.js 24 and install locked dependencies
   - `npm ci --prefix mobile`
   - `npm ci --prefix backend`
2. Create the backend environment file
   - `cd backend && cp .env.example .env`
3. Start the backend
   - `cd backend && npm start`
4. Start the mobile app
   - `cd mobile && npm start`

## Goals

- No advertising
- Professional networking focused on groups and people
- Freemium-friendly architecture

## Notes

Production authentication requires PostgreSQL, a strong JWT signing secret, and a separate token-encryption key. See [SECURITY.md](SECURITY.md) and the [security rollout requirements](docs/SECURITY-2026-09-15.md) before deployment. Local sample data is for development only.

Use Node.js 24 and `npm ci` with the committed lockfiles. Security checks are part of the verification workflow.
