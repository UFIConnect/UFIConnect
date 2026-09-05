# UFconnect — App Store Launch Guide

This guide walks you through every step needed to submit UFconnect to the Apple App Store (and optionally Google Play). The code is ready; what remains is account setup and build commands.

---

## Prerequisites

### 1. Apple Developer Account ($99/year)
- Enroll at https://developer.apple.com/programs/
- Required to sign iOS builds and submit to the App Store
- Approval takes 24–48 hours

### 2. EAS Account (free)
- Create an account at https://expo.dev/signup
- Then log in from your terminal:
  ```
  eas login
  ```

### 3. Deployed Backend
The app currently points to `localhost:3000` during development. For a real production build you need the backend running on a public URL.

**Recommended: Railway (free tier available)**
1. Go to https://railway.app and sign up
2. Create a new project → "Deploy from GitHub" (push your backend to GitHub first)
   - Or use the Railway CLI: `npm install -g @railway/cli && railway login`
3. In Railway dashboard → your service → Variables, add:
   ```
   PORT=3000
   ```
4. Copy the generated public URL, e.g. `https://uficonnect-api.up.railway.app`

---

## One-Time Setup

### Step 1 — Initialize EAS
In your `mobile/` directory:
```bash
cd mobile
eas init
```
This creates a project on expo.dev and auto-fills the `projectId` in `app.config.js`.

### Step 2 — Set your production API URL
```bash
eas secret:create --scope project --name API_URL \
  --value https://YOUR-BACKEND-URL.up.railway.app
```
This injects `API_URL` into every production build automatically.

### Step 3 — Create your app in App Store Connect
1. Go to https://appstoreconnect.apple.com
2. Click **+** → **New App**
3. Fill in:
   - **Platform**: iOS
   - **Name**: UFconnect
   - **Bundle ID**: `org.uficonnect.app`
   - **SKU**: `uficonnect-001`
4. Copy the **Apple ID** shown (a numeric ID like `1234567890`) — you'll need it for `eas.json`

### Step 4 — Fill in eas.json submit config
Open `eas.json` and fill in the `submit.production.ios` section:
```json
"ios": {
  "appleId": "your-apple-id@email.com",
  "ascAppId": "1234567890",
  "appleTeamId": "ABCDEF1234"
}
```
Your Team ID is in https://developer.apple.com → Account → Membership.

---

## Building & Submitting

### Preview build (internal testing via TestFlight)
```bash
cd mobile
eas build --platform ios --profile preview
```
Once complete, install on your device via the Expo Go / EAS build link.

### Production build
```bash
eas build --platform ios --profile production
```
EAS builds in the cloud — no Xcode required. Takes ~10–15 minutes.

### Submit to App Store
```bash
eas submit --platform ios --latest
```
This uploads the build to App Store Connect and sends it for review.

---

## App Store Connect Listing (required before review)

After submission, go to App Store Connect and complete:

1. **App Information**
   - Category: Social Networking (or Business)
   - Age Rating: complete the questionnaire (select "No" for most items)

2. **Screenshots** (required sizes)
   - iPhone 6.5" (1284×2778) — at least 3 screenshots
   - iPhone 5.5" (1242×2208) — at least 3 screenshots
   - Tip: use the iOS Simulator → File → Take Screenshot

3. **App Preview** (optional but recommended — 15-30 sec video)

4. **Description** (suggestion):
   ```
   UFconnect is your all-in-one professional networking hub.
   
   • Discover jobs, gigs, grants, hackathons, and open source projects
   • Join interest-based groups and connect with professionals in your field
   • Get a unified feed aggregating opportunities from LinkedIn, Indeed, Reddit, and more
   • Direct messaging with file sharing
   • Skills-based profile matching
   
   No ads. No noise. Just opportunities.
   ```

5. **Keywords** (100 chars max):
   ```
   jobs,networking,professional,career,opportunities,grants,hackathons,freelance,groups
   ```

6. **Support URL**: your website or GitHub repo URL

7. **Privacy Policy URL**: required — create a simple one at https://app.privacypolicies.com (free)

---

## Review Timeline

Apple typically reviews apps within **1–3 business days**. Common rejection reasons to avoid:
- Missing privacy policy URL
- Placeholder / dummy content (fill in real data)
- Crashes on launch (test thoroughly on a real device first)

---

## Post-Launch Checklist

- [ ] Set up crash monitoring (https://sentry.io — free tier)
- [ ] Replace in-memory backend storage with a real database (PostgreSQL on Railway/Supabase)
- [ ] Add push notifications (Expo Push Notifications — free)
- [ ] Set up analytics (Expo Analytics or PostHog)
- [ ] Submit to Google Play (run `eas build --platform android --profile production`)

---

## Quick Reference Commands

```bash
# Log in to EAS
eas login

# Initialize project (first time only)
eas init

# Set production API URL secret
eas secret:create --scope project --name API_URL --value https://your-api.railway.app

# Build for TestFlight / internal testing
eas build --platform ios --profile preview

# Build for App Store
eas build --platform ios --profile production

# Submit most recent build
eas submit --platform ios --latest

# Check build status
eas build:list
```
