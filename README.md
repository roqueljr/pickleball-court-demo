# Rally Court Club

Rally Court Club is a full-stack pickleball court booking and business-management system. It provides a public club website plus role-based workspaces for customers, coaches, front-desk staff, managers, and Super Admins.

## What is working

- Secure registration, sign-in/out, password reset, email verification, HTTP-only JWT cookies, rate limits, and role-based API authorization
- Conflict-safe court booking with database-enforced no-overlap protection, server-side pricing, configurable tax and booking rules, promotions, memberships, packages, and club wallet credit
- Manual payment workflow: a customer chooses a method and submits a reference; staff verifies the payment; the booking, membership, coaching session, open-play entry, league entry, wallet top-up, or package activates in the same transaction
- One-time QR/access-pass check-in, booking rescheduling/cancellation rules, refund controls, waitlist offers, and in-app notifications
- Customer, court, calendar, coaching, equipment return, products/POS, expenses, payments, memberships, promotions, users, audit logs, reports, tournaments, and Growth Center workflows
- Responsive customer, staff, coach, manager, and owner interfaces with public events, open play, guest booking, leagues, retention campaigns, and reporting

## Stack

- React 19, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query, React Hook Form, Zod, Lucide
- Node.js, Express 5, TypeScript, Prisma
- PostgreSQL
- bcrypt, JWT cookies, Helmet, CORS, Nodemailer/HTTP email adapter, and express-rate-limit

## Quick start (local demo)

1. Install Node.js 22+ and PostgreSQL 15+.
2. Create a database. PostgreSQL port `5433` is valid if that is the port your installation uses.

   ```sql
   CREATE DATABASE pickleball_business;
   ```

3. Copy `.env.example` to `.env`, then set `DATABASE_URL` and a real `JWT_SECRET`.
4. Install, generate the Prisma client, apply the schema, load demo data, and start the app.

   ```powershell
   npm install
   npm run db:generate
   npm run db:deploy
   npm run db:seed
   npm run dev
   ```

The web app is available at `http://localhost:5173` and the API at `http://localhost:4000`.

`db:deploy` uses Prisma schema synchronization and installs the PostgreSQL booking/open-play overlap constraints. It is additive for this demo project but should always be run against a backup/staging copy before a live-business update.

## Environment variables

Use [.env.example](./.env.example) as the complete template. The important values are:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string; keep `:5433` if that is your installed PostgreSQL port. |
| `JWT_SECRET` | Unique random secret, at least 32 characters. |
| `APP_URL` | Exact client origin, for example `http://localhost:5173` locally or `https://your-app.replit.app` in production. |
| SMTP values | `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_SMTPSecure`, `MAIL_FROM`. |
| HTTP email values | Alternative to SMTP: `EMAIL_API_URL`, `EMAIL_API_KEY`, and `EMAIL_FROM`. |
| `NODE_ENV` | Use `production` only on the hosted deployment. |

Never commit `.env`, email credentials, API keys, or a production JWT secret.

## Windows build / Prisma `EPERM` recovery

Some Windows antivirus, Controlled Folder Access, or file-lock configurations prevent Node tools from launching a helper executable. This can affect Prisma, `tsx`, or Vite/esbuild. If `npm run db:push`, `npm run db:generate`, or `npm run build` reports `spawn EPERM`:

1. Stop Prisma Studio and every duplicate `npm run dev` / Vite terminal, then open a fresh PowerShell in the project folder.
2. Allow Node.js and the project's `node_modules/esbuild` and `node_modules/.prisma` helpers in your Windows security product; do not disable security globally.
3. Run `npm run db:generate` and `npm run deploy:build` again.
4. For an existing database already on the prior project schema, open [release-hardening.sql](./prisma/release-hardening.sql) in pgAdmin Query Tool and run it against the exact database in `DATABASE_URL`.
5. Run `npm run db:constraint`.

The fallback SQL is idempotent and only adds the equipment-return and coaching-payment fields introduced by the latest release. For older Growth Center upgrades, use [growth-release.sql](./prisma/growth-release.sql) first. A brand-new database still needs a successful `npm run db:deploy`. If Windows continues to block Node child processes, build and deploy from Replit or another Linux-based host instead.

`npm run db:seed` intentionally uses the compiled JavaScript seed path, so it avoids the Windows `tsx`/esbuild launch issue.

## Demo accounts

All seeded accounts use `ChangeMe123!`. These are demo-only credentials and must be changed or disabled before real use.

| Role | Email |
|---|---|
| Super Admin | `admin@example.com` |
| Admin / Manager | `manager@example.com` |
| Staff | `staff@example.com` |
| Coach | `coach@example.com` |
| Customer | `customer@example.com` |

The seed also creates a second staff member, second coach, ten fictional customers, four courts, plans, products, equipment, sample bookings/payments/expenses, a promotion, a published tournament, open play, a league, and retention campaigns.

## Useful commands

```powershell
npm run dev                 # Client and API in development
npm run db:generate         # Regenerate Prisma Client
npm run db:deploy           # Synchronize schema and install overlap constraints
npm run db:constraint       # Reinstall only the overlap constraints safely
npm run db:seed             # Load/refresh idempotent demo data
npm run typecheck
npm run lint
npm test
npm run deploy:build        # Production client + API build
npm run smoke:production    # Starts a production smoke server on port 4100
npm run smoke:demo-api      # Seeded-role/concurrent-booking smoke test; removes its test data
```

## Deployment and demo guidance

- [Deployment checklist](./DEPLOYMENT.md)
- [Architecture](./ARCHITECTURE.md)
- [Demo runbook](./docs/DEMO_RUNBOOK.md)
- [Growth feature guide](./docs/GROWTH_FEATURES.md)
- [Database schema](./prisma/schema.prisma)

## Current integration boundaries

- Payment choices are fully recorded and staff-confirmed, but no live card/GCash gateway is charged yet. A payment-provider adapter can be added later without changing purchase ownership or activation rules.
- Email is live when SMTP or the HTTP provider is configured. In local development with no provider, messages are logged instead.
- The business is configured for PHP and `Asia/Manila`; keep the operational timezone at `Asia/Manila` for the current booking and calendar release.
- Local league ratings are ready for a future DUPR integration; no external DUPR synchronization is claimed until credentials and an approved provider integration are added.
