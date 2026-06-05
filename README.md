# UFIConnect

A starter workspace for an ad-free professional networking app that connects groups and people.

## Structure

- `mobile/` - Expo React Native app for iOS, Android, and web.
- `backend/` - Node.js + Express API for authentication, groups, and connections.

## Getting Started

1. Install dependencies
   - `cd mobile && npm install`
   - `cd backend && npm install`
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

The backend uses in-memory sample data for initial development. Replace this with a database when moving toward production.
