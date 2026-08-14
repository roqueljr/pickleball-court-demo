# Growth Center: eight standout features

## 1. Smart waitlist and cancellation recovery

Customers join a waitlist for a specific court, start time, and duration only when that slot is currently occupied. Cancellation or rescheduling starts a FIFO 15-minute offer. A background cycle expires unclaimed offers, rechecks court availability, and offers the slot to the next customer. Owners see waiting demand and recovered booking revenue.

## 2. Open-play matchmaker

Owners reserve court inventory as social or competitive open play with a rating range, player capacity, and per-player fee. Customers join individually. The session blocks ordinary court bookings, prevents over-capacity joins under a database lock, and confirms paid participants through the operations payment queue.

## 3. Guest booking and conversion funnel

Public visitors choose live court availability without registering first. The system sends a six-digit email code stored only as a hash. After verification, the standard booking transaction runs, a customer profile is created when needed, and a one-time set-password link is emailed. Guest leads and conversions remain reportable.

## 4. Payment-to-access automation

Bookings that still have an amount due remain pending until staff verifies payment. Confirmation creates a time-bound access pass and releases the QR check-in credential. Wallet- or package-covered bookings confirm immediately. Access use is one-time, ownership-scoped, validity-window checked, and audited.

## 5. Revenue autopilot

Administrators create court-specific or global percentage adjustments by weekday, time, and lead-time window. Server-side booking quotes show the applied rule before checkout, and booking creation recalculates it in the protected transaction. The Growth Center highlights low-utilization courts and suggests owner actions.

## 6. Membership wallet and booking packages

Customers can request wallet top-ups and buy configurable booking-credit packages. Staff verifies the payment before credit becomes usable. Wallet debits and package-credit consumption occur atomically with booking creation. Fully covered checkout creates no pending payment and confirms immediately.

## 7. Leagues, ladders, and provider-ready ratings

Owners create rated divisions, customers register, and paid entry fees flow through Payments. Administrators schedule fixtures; staff records scores. Standings and bounded local ratings update transactionally. External DUPR synchronization is intentionally labeled provider-ready until an approved provider integration is configured.

## 8. Retention automation

Owners create win-back, membership-expiry, birthday, and promotion campaigns. Audiences respect marketing consent. Scheduled runs are de-duplicated for 23 hours, create actionable in-app notifications, record recipient counts, and write audit logs. Campaigns can be paused, activated, or run manually.

## Role access

| Capability | Customer | Staff | Admin / Super Admin | Public guest |
|---|---:|---:|---:|---:|
| Join waitlist, open play, packages, wallet, leagues | Yes | Monitor | Manage | Discover only |
| Confirm linked payments | No | Yes | Yes | No |
| Use confirmed QR/access | Own booking | Check-in | Check-in | After account conversion |
| Dynamic pricing and packages | Use | View operations | Configure | Price applied |
| League results | View | Record | Schedule and record | View standings |
| Retention campaigns and insights | Receive if opted in | Operational view | Configure and run | No |

## Deployment note

These features add PostgreSQL tables and an OpenPlay exclusion constraint. Back up an existing production database, then run `npm run db:generate`, `npm run db:deploy`, and the seed command only when development/demo records are desired. Do not run demo seeding on a live customer database.
