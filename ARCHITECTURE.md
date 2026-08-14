# Rally Court Club architecture

## System shape

```text
React/Vite client
  ├─ Public website, events, guest booking
  └─ Authenticated role workspaces
          │ HTTP-only cookie + JSON API
Express API
  ├─ Authentication, authorization, validation, rate limits
  ├─ Booking, payment, inventory, growth, reporting services
  └─ Email and scheduler adapters
          │ Prisma
PostgreSQL
  ├─ Relational business records and audit history
  └─ GiST exclusion constraints for court/open-play overlap safety
```

## Frontend

The client lives in `src/`.

- `App.tsx` defines public and protected routes. `Protected`, `RoleRequired`, and `VerifiedEmailRequired` improve the client experience but never replace API authorization.
- `layouts/PublicLayout.tsx` renders the public site. `layouts/AppLayout.tsx` provides role-specific navigation, responsive sidebar behavior, and the notification menu.
- `pages/` contains feature screens. Larger growth pages are separated under `pages/growth/`.
- `auth/AuthProvider.tsx` owns the current session query. API data is owned by TanStack Query and invalidated after mutations.
- `lib/api.ts` centralizes JSON requests and consistent API errors. `types.ts` contains client-facing contracts.

The responsive design uses full tables when space allows and stacked cards/actions on small screens. Main routes are lazy-loaded to keep the public startup bundle small.

## Backend

The Express application starts in `server/index.ts`; `server/app.ts` configures JSON limits, Helmet, CORS, cookies, rate limits, API routes, production SPA serving, and consistent errors.

Routes in `server/routes/` own transport concerns: Zod validation, HTTP status codes, request scoping, and role checks. Domain services in `server/services/` hold reusable booking, email, automation, access-pass, waitlist, and rating logic. Prisma is the only database access layer.

All expected API failures use this contract:

```json
{
  "success": false,
  "message": "Human-readable message",
  "errors": {}
}
```

## Authentication and authorization

Passwords are hashed with bcrypt. Sign-in creates a short-lived JWT stored only in an HTTP-only, same-site cookie. Authentication reloads the current database user and role assignments on every protected request, so a suspended user or changed role loses API access immediately.

Email-verification and password-reset tokens are random, expire, and are stored only as SHA-256 hashes. The browser removes consumed tokens from the visible URL. Sensitive auth endpoints have dedicated rate limits. Important auth actions are written to the audit log.

Roles are enforced at the API:

| Role | Main authority |
|---|---|
| Super Admin | Full system administration, users, settings, audit logs, refunds |
| Admin | Business management except Super Admin control |
| Staff | Front desk, bookings, payments, check-in, POS, customers, equipment |
| Coach | Assigned coaching sessions and notes only |
| Customer | Own profile, bookings, payments, memberships, growth activity, and notifications |

## Database

`prisma/schema.prisma` is the source of truth. It models:

- Identity: users, roles, permissions, customer/staff/coach profiles, audit logs
- Courts: courts, court schedules, bookings, booking items, check-ins, QR/access passes
- Finance: payments, refunds, memberships/plans, promotions/usages, expenses, products, sales, equipment rentals
- Coaching and events: coaches, coaching sessions/payments, tournaments, registrations, participants
- Growth: waitlists, open play, packages, wallets, guest leads, price rules, leagues, ratings, campaigns, and campaign runs
- Operations: notifications and business settings

Foreign keys, unique constraints, soft deletion for important records, and targeted indexes support safe reporting and role-scoped queries.

## Court booking consistency

The booking service is the authority for court reservations. It validates:

1. Authenticated customer ownership or authorized staff creation.
2. Court active state, operating hours, blocks, advance rules, booking duration, membership limits, and price rules.
3. Promotion eligibility, tax, membership discount, wallet/package balance, and final amount.
4. Overlap against bookings and open-play sessions.

Each court write uses a PostgreSQL advisory lock. The final database guarantee is the GiST exclusion constraint in `prisma/booking-overlap.sql`, which rejects overlapping `PENDING`, `CONFIRMED`, or `CHECKED_IN` bookings even if two requests arrive at the same moment.

Rescheduling performs the same server/database checks. Check-in and access-pass use are also locked and re-read inside their transactions so the same booking cannot be checked in twice.

## Payments, refunds, and activation

The current provider model is manual verification. Customers select Cash, Bank Transfer, GCash, Card, or Online Payment and may submit a reference. The system records a pending payment; an operations user confirms it from Payments.

Confirmation locks the payment, rechecks the linked purchase, and activates exactly one linked workflow: court booking, membership, coaching session, package, wallet top-up, open-play entry, or league entry. A confirmed court booking receives a time-bound access pass. Paid coaching requests become confirmed coaching sessions.

Refunds are locked and aggregate prior refunds inside the transaction, preventing an over-refund. A booking must first be cancelled and meet the configured refund window. Cancelling a booking restores package credits, reserved equipment, and promotion capacity exactly once.

## Inventory and coaching

Product sales use conditional stock updates inside a transaction. Equipment rental availability is decremented at reservation time, restored on booking cancellation, and restored by staff through the explicit return action.

Coaching requests require a verified customer email and a payment method. They lock coach/customer/court availability before creating a pending session and payment. Staff payment confirmation confirms the session; coaches can only change their own sessions and record notes.

## Notifications and automation

Business actions create in-app notifications with an optional destination URL. The app header polls unread notifications and opens the relevant page when one is selected.

The background scheduler runs with the API process. It rolls expired waitlist offers, expires stale access passes, and runs eligible retention campaigns. Email/SMS/push delivery remains adapter-based: SMTP and an HTTP email provider are supported now; SMS/push can be added without altering business records.

## Reporting

Reports use live database records for paid payment revenue less refunds, completed POS sales, active equipment rentals, expenses, booking-status counts, and court utilization. Coaching revenue is payment-based, so it is not reported until staff confirms the coaching payment. Court utilization clips booking time to the chosen report interval.

The current operational timezone is `Asia/Manila` and default currency is PHP. Keep the timezone setting at `Asia/Manila` in this release; it is the business timezone used by the booking and calendar flows.

## Production runtime

`npm run deploy:build` creates `dist/` for the React SPA and `dist-server/` for Express. `npm start` serves both from one process, including SPA fallback for direct client routes. `GET /api/health` verifies process health and `GET /api/health/ready` checks the PostgreSQL connection.

Configuration is entirely environment-based. No database password, JWT secret, email password, or provider API key belongs in the repository.
