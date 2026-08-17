# Deployment checklist

This guide is for a hosted demo or real deployment. Perform the demo verification before inviting a client, and use a separate PostgreSQL database for the demo.

## 1. Services

- Node.js 22+
- Persistent PostgreSQL 15+ with automatic backups
- HTTPS application URL
- SMTP mailbox or HTTP transactional-email provider

Replit can run the Node application, but use persistent external PostgreSQL rather than project files for business data.

## Free demo option (recommended)

Use **Render + Neon** for a client demo: Render hosts this full Node/Express application, while Neon stores the PostgreSQL data permanently. The repository now includes [render.yaml](./render.yaml), which applies the schema and loads demo data only when the selected database has no users yet.

1. Create a free Neon project at [neon.com](https://neon.com), create a database, then copy its PostgreSQL connection string. Add `schema=public` to the query string: use `?schema=public` when there is no query string, or `&schema=public` when Neon already provides one.
2. Create a private GitHub repository and push this project. Before pushing, confirm `.env` is ignored and never upload it. Rotate any email API key, SMTP/app password, or JWT secret that was ever copied into an example file or shared outside your password manager.
3. Create a free Render account at [render.com](https://render.com), choose **New → Blueprint**, select the GitHub repository, and accept the `render.yaml` configuration.
4. Create a free [SMTP2GO](https://www.smtp2go.com/pricing/) account, verify a sender email or sender domain, then create an SMTP user under **Sending → SMTP Users**. When Render asks for secrets, enter `DATABASE_URL`, `MAIL_USERNAME`, `MAIL_PASSWORD`, and `MAIL_FROM`. Render generates the JWT secret. The Blueprint uses SMTP2GO on port `2525`, because free Render web services block the usual SMTP ports 25, 465, and 587. SMTP2GO's free plan currently includes up to 1,000 emails per month.
5. Deploy. Render automatically uses its `RENDER_EXTERNAL_URL` as the application URL unless you later set `APP_URL` for a custom domain. The first build creates the schema and the demo data; later deployments preserve database records.
6. Open the generated `onrender.com` URL. Check `/api/health`, register a test customer, and complete the flows in [docs/DEMO_RUNBOOK.md](./docs/DEMO_RUNBOOK.md).

This is suitable for a **demo**, not a live club: Render's free web service sleeps after 15 minutes without traffic and can take about a minute to wake. Neon free databases scale to zero after inactivity and have free-plan limits. Render's own free PostgreSQL database expires after 30 days, so Neon is the better free demo database. See [Render free-service limits](https://render.com/docs/free) and [Neon pricing](https://neon.com/pricing).

If you prefer a longer idle period, Koyeb also offers one free web service but it sleeps after one hour and is limited to US or European regions. Replit Starter includes one free published app, but that deployment expires after 30 days. [Koyeb limits](https://www.koyeb.com/docs/reference/instances) and [Replit deployment pricing](https://docs.replit.com/billing/deployment-pricing) have the current terms.

## 2. Production environment

Create all values as deployment secrets, not repository files.

```ini
NODE_ENV=production
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public
JWT_SECRET=long-random-secret-at-least-32-characters
APP_URL=https://your-public-domain.example

# Choose SMTP OR the HTTP email provider.
# For a free Render deployment with SMTP2GO, use port 2525 and STARTTLS:
# MAIL_HOST=mail.smtp2go.com
# MAIL_PORT=2525
# MAIL_SMTPSecure=false
MAIL_HOST=smtp.example.com
MAIL_PORT=465
MAIL_USERNAME=no-reply@example.com
MAIL_PASSWORD=app-or-smtp-password
MAIL_SMTPSecure=ssl
MAIL_FROM=Rally Court Club <no-reply@example.com>

# Alternative HTTP provider
EMAIL_API_URL=https://api.resend.com/emails
EMAIL_API_KEY=re_...
EMAIL_FROM=Rally Court Club <no-reply@verified-domain.example>
```

`APP_URL` must be the exact HTTPS origin with no path, query string, or fragment. The app refuses to start in production without a valid database URL, HTTPS app URL, strong JWT secret, and complete email configuration.

## 3. New hosted demo database

From the project root:

```powershell
npm ci
npm run db:generate
npm run db:deploy
npm run db:seed
npm run deploy:build
npm start
```

`db:seed` is for a private demo/staging database only. It creates named fictional users and resets the seeded demo-account passwords to `ChangeMe123!`; never use it on a live customer database.

`db:deploy` runs Prisma schema synchronization and installs `booking_no_overlap` and `open_play_no_overlap`. Back up an existing deployment before every schema update. This project currently uses reviewed schema synchronization rather than a committed Prisma migration history, so test the exact update against a staging database first.

## 4. Existing Windows development database

If Prisma, Vite, or esbuild reports `spawn EPERM` while applying the schema or building:

1. Stop Prisma Studio and duplicate Node/Vite terminals, then use a fresh PowerShell window.
2. Allow Node.js plus the project's `node_modules/esbuild` and `node_modules/.prisma` helper executables in Windows security software.
3. Retry `npm run db:generate`, `npm run db:deploy`, and `npm run deploy:build`.
4. If the database already has the earlier project schema, run [release-hardening.sql](./prisma/release-hardening.sql) in pgAdmin Query Tool against the same database named in `DATABASE_URL`.
5. Run `npm run db:constraint`.

The fallback script is additive and idempotent. It is not a replacement for initial schema setup on a new database. A Replit/Linux build is the recommended fallback if Windows blocks Node helper processes after the retry.

## 5. Replit setup

- Build command: `npm run deploy:build`
- Run command: `npm start`
- Store every environment value in Replit Secrets.
- Set `APP_URL` to the final Replit HTTPS URL, then redeploy so CORS and email links use the correct origin.
- Run database setup from a shell connected to the same production secrets before starting the web process.

## 6. Release gate

Run these from a clean install before deployment:

```powershell
npx prisma validate
npm run typecheck
npm run lint
npm test
npm run deploy:build
npm run smoke:production
npm run smoke:demo-api
```

`smoke:demo-api` uses the seeded demo accounts and database. It verifies role-scoped API access and submits two concurrent requests for the same available court slot; exactly one must be accepted. It cancels and removes only the temporary records it created, so it does not clutter the demo. Do not run it against live customer data.

After deploying, verify:

- `GET /api/health` returns HTTP 200.
- `GET /api/health/ready` returns HTTP 200.
- Directly opening `/login`, `/events`, `/app`, and `/app/bookings` returns the app rather than a 404.
- A new customer can register, receive/complete verification, request a password reset, and receive mail.
- Customer booking remains pending until staff confirms the recorded payment.
- A confirmed QR/check-in can be used only once.
- A second booking that overlaps the same court/time receives HTTP 409.
- Mobile layout is checked at 390px and the desktop layout at 1440px.

## 7. First business configuration

Sign in as `admin@example.com` only on a private demo/staging database, then change the password. Configure:

- Business name/logo/public contact details/hours
- PHP, `Asia/Manila`, and tax/booking/refund rules
- Court images, court rates, schedules, and blocked maintenance time
- Staff accounts, coaches, membership plans, promotions, equipment, POS products, and payment instructions

Run the flow in [docs/DEMO_RUNBOOK.md](./docs/DEMO_RUNBOOK.md) with a real test email before sharing the demo URL.

## 8. Ongoing operations

- Keep daily database backups and perform a restore test before launch.
- Rotate a JWT secret, SMTP password, or API key immediately if it was shared or copied outside Secrets.
- Monitor readiness failures, email failures, payment confirmation audit logs, low stock, and waitlist notifications.
- Disable or replace every seeded demo account before collecting real customer data.
- Do not advertise instant card/GCash charging until a real payment-provider adapter has been integrated and tested.
