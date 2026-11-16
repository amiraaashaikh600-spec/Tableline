# Tableline

Tableline is a responsive multi-restaurant booking platform built with React, Express, MongoDB, JWT sessions and Socket.IO. Customers discover approved restaurants, ask the Gemini chat assistant for database-grounded suggestions, check live table availability and request reservations. Restaurant owners manage listings and tables. Administrators approve or reject restaurant registrations.

## Features

- Customer, owner and administrator accounts with role-based API authorization. Admin accounts are provisioned only through a private CLI command; public registration cannot select the admin role.
- Restaurant discovery from MongoDB with name, cuisine, location, party-size filters and sorting.
- Customer chatbox recommends only eligible restaurants returned by MongoDB. Its default database demo mode ranks cuisine, location, party size and preference keywords without an API key; optional Gemini mode provides generated suggestions. Both modes link to restaurant details and cannot book or confirm reservations.
- Owner dashboard for restaurant profiles, Cloudinary image upload/replacement/removal, tables and booking decisions.
- New owner listings stay pending and private until an administrator approves them.
- Booking lifecycle: pending, confirmed, rejected, cancelled and completed, with server-enforced actor/status transitions.
- In-app notifications for new bookings, booking changes and restaurant approval decisions. Optional SMTP email delivery is best-effort and cannot fail a booking.
- Socket.IO availability change events and notification delivery. Availability is revalidated on every booking request; polling remains as a client fallback.
- Reservations claim every occupied 30-minute block for a 90-minute seating inside MongoDB transactions. A unique slot index and per-table transactional write lock prevent overlapping and simultaneous double bookings; conflicts return HTTP 409.
- Secure image validation, server-side ownership checks, bounded request bodies, rate limits, Helmet headers and origin allowlists.

## Requirements

- Node.js 20 or newer
- MongoDB 7 or newer, running as a replica set (Atlas works)
- Cloudinary account for real restaurant image uploads
- Optional Gemini API key for generated recommendations. Database demo suggestions work without a key.
- SMTP credentials only if email notifications are wanted

This workspace has an ignored local `.env` with a generated development JWT secret and targets the installed MongoDB service at `127.0.0.1:27017`, database `tableline`, replica set `rs0`. Cloudinary, Gemini and SMTP credentials remain blank until you provide them. The workspace's local admin credentials are kept only in `.env`; a fresh clone must provision its own admin as described below. `.env.example` contains placeholders only.

## Local setup

1. Install the exact locked dependencies:

   ```powershell
   npm ci
   ```

   Set a unique `JWT_SECRET` of at least 32 characters. Never commit `.env`.

2. Configure the existing local MongoDB service as a single-node replica set. The current workspace has MongoDB 9.0 at `127.0.0.1:27017`, using `C:\Program Files\MongoDB\Server\9.0\data`; it contains other databases, which must be preserved. Open PowerShell as Administrator in the project folder and run:

   ```powershell
   .\scripts\configure-local-mongodb.ps1
   ```

   The script backs up the service config, adds only `replication.replSetName: rs0`, restarts MongoDB, safely initializes rs0 if needed, waits for PRIMARY, and seeds the demo data. It does not delete or reset database files. Tableline uses `mongodb://127.0.0.1:27017/tableline?replicaSet=rs0`; do not change the port or point it at another database. This one-time config change requires Windows administrator access. See MongoDB's [Windows installation](https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-windows/) and [standalone-to-replica-set guide](https://www.mongodb.com/docs/manual/tutorial/convert-standalone-to-replica-set/).

3. Create `.env` from the example only if it does not already exist, then configure `MONGODB_URI` and `JWT_SECRET`. The `RECOMMENDATION_PROVIDER=demo` default ranks local restaurant data without an external service. To use Gemini, set `RECOMMENDATION_PROVIDER=gemini` and provide an eligible account's `GEMINI_API_KEY`. Add Cloudinary credentials for image uploads. Optional SMTP values turn on email notifications.

   ```powershell
   if (!(Test-Path .env)) { Copy-Item .env.example .env }
   ```

4. Seed the local demo restaurants, tables and customer/owner accounts:

   ```powershell
   npm run seed
   ```

   The seed is repeatable and upserts the demo records. It refuses to run when `NODE_ENV=production`. Demo login (both use `tableline123`):

   - Customer: `hello@tableline.demo`
   - Restaurant owner: `owner@tableline.demo`

   Do not deploy these demo users/passwords.

5. Start both app processes:

   ```powershell
   npm run dev
   ```

   Open [http://localhost:5173](http://localhost:5173). The Vite server proxies `/api` and `/socket.io` to Express on port 5000. You can start the pieces separately with `npm run dev:client` and `npm run dev:server`.

## Admin account

Admin accounts cannot be created through public registration. Set a separate administrator email and a password of at least 16 characters as `ADMIN_EMAIL` and `ADMIN_PASSWORD` in the private environment, then run:

```powershell
npm run admin:create
```

This command connects to the configured database and provisions only that admin account; it refuses to change an existing non-admin user into an administrator. It can be run manually against a production database. Do not put admin credentials into GitHub or an automatic build step.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `development` locally, `production` on the host. |
| `PORT` | Express port; defaults to 5000. |
| `MONGODB_URI` | MongoDB replica-set URI. Transaction support is required for reservations. |
| `MONGODB_TEST_URI` | Optional disposable replica-set database for tests. Database name must include `test`; the test suite clears its collections. |
| `JWT_SECRET` | Private session signing secret, minimum 32 characters. |
| `CLIENT_URL` | Allowed browser origin(s), comma-separated. |
| `RECOMMENDATION_PROVIDER` | `demo` ranks MongoDB listings locally with no key; `gemini` uses Gemini when `GEMINI_API_KEY` is configured. Defaults to Gemini only when a key exists, otherwise demo. |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Server-only Cloudinary credentials. JPEG, PNG and WebP, maximum 5 MB. |
| `GEMINI_API_KEY` | Optional key for Gemini-generated recommendations through the official `@google/genai` SDK and Interactions API. Keep it server-side. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Optional SMTP email delivery. All values must be set to enable it. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Private inputs to the explicit `npm run admin:create` command. Not used by public registration. |

Never use Vite-prefixed variables for server secrets. Keep `.env` files out of source control.

## Commands

```powershell
npm ci
npm run dev
npm run dev:client
npm run dev:server
npm run build
npm start
npm test
npm run seed
npm run admin:create
npm run db:init
```

`npm start` expects a completed `npm run build`, a configured replica-set database and a strong `JWT_SECRET`. Express serves the SPA and API from one origin. Deploy behind HTTPS so the session cookie is secure.

The integration suite starts a temporary MongoDB replica set with `mongodb-memory-server-core` when `MONGODB_TEST_URI` is blank. Running the tests for the first time may download a MongoDB test binary into the ignored `.cache` directory; `npm ci` does not download or start a database. Do not point `MONGODB_TEST_URI` at a shared or production database.

## Integrations and test limits

Automated tests use injected Cloudinary and Gemini clients to verify integration behavior without credentials or billable external calls. The database demo recommender needs no external service; its results are clearly labeled as not AI-generated. Live image uploads, Gemini responses and email delivery require real service configuration. The booking-concurrency tests use a real temporary MongoDB replica set and exercise transactions, unique slot claims and HTTP 409 conflicts. Socket.IO tests exercise a real local socket connection.

## Production deployment

1. Provision a Node.js 20+ host and MongoDB Atlas replica-set cluster. Create a dedicated database user and restrict network access to the application host.
2. Configure `NODE_ENV=production`, `PORT` if required, `MONGODB_URI`, `JWT_SECRET`, and the deployed browser origin as `CLIENT_URL`.
3. Configure Cloudinary and SMTP credentials when those features are needed. Gemini is optional: set `RECOMMENDATION_PROVIDER=gemini` and configure its server-side key to enable generated recommendations; otherwise the database demo mode remains available. Configure TLS/HTTPS at the host or reverse proxy.
4. Build and start the web service:

   ```bash
   npm ci --include=dev
   npm run build
   npm start
   ```

5. Provision the administrator explicitly with `ADMIN_EMAIL` and `ADMIN_PASSWORD`, then run `npm run admin:create` as a one-off release/admin task. Never run the demo seed in production.
6. Verify `/api/health`, login/session cookies over HTTPS, public restaurant listing, admin review, image upload, notifications and a reservation conflict before inviting users.

No cloud host, production database, Cloudinary account or Gemini key is configured in this workspace, so the app has not been deployed and live integrations have not been called.

## Seed fixtures

Restaurant and table fixtures are in [`server/seed-data.js`](server/seed-data.js). `server/seed.js` upserts six demo restaurants, twenty tables, and the customer/owner demo accounts. Seeded restaurants are marked approved for local discovery. It optionally provisions an admin only if both admin environment variables are set, but production use should provision the administrator with `npm run admin:create`.
