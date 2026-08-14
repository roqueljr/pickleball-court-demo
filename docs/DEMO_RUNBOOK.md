# Client demo runbook

Use this sequence after `npm run db:seed`. It shows the parts a court owner and a customer usually care about most, without relying on fake buttons or static screens.

## Demo accounts

All seeded accounts use `ChangeMe123!`.

| Use during demo | Account |
|---|---|
| Owner view | `admin@example.com` |
| Manager view | `manager@example.com` |
| Front-desk view | `staff@example.com` |
| Coach view | `coach@example.com` |
| Customer view | `customer@example.com` |

## Suggested 12-minute flow

1. Start on the public home page. Show the configured business name/logo, courts, memberships, coaches, contact/FAQ, public events, and the highlighted tournament registration.
2. Open `/play` to show open play and the public Growth offer. Open `/guest-book` to show that guest bookings are email-code verified before the booking is created.
3. Sign in as the customer. Show the dashboard's active Silver membership, membership benefits, upcoming bookings, notifications, wallet, packages, and payment history.
4. Open **Book a court**. Pick a date, court, time, duration, payment method, and `PICKLE10`. Point out that the server returns the price including membership discount, promo discount, and configured tax before submission.
5. Submit the booking. It stays **Pending** until payment is verified; this prevents a customer from treating a selected payment method as an automatic online charge.
6. In a separate browser/session, sign in as staff. Open **Payments**, select the pending booking payment, review its method/reference, and select **Confirm payment**.
7. Return to the customer. Refresh Bookings/Payments to show **Confirmed** status and the QR/access pass. The customer can display it at the club.
8. As staff, open **Check-in**, scan/paste the token, and show that a second check-in is rejected. This is the check-in/audit trail flow.
9. As the owner, show **Calendar**, **Reports**, **Customers**, **Payments**, **Equipment**, **POS**, **Expenses**, **Promotions**, **Tournaments**, **Growth center**, **Audit logs**, and **Settings**.
10. In **Growth center**, show waitlist recovery, open play, prepaid packages, wallet top-ups, dynamic pricing, leagues, and retention campaign controls. Explain that each paid item uses the same staff-confirmation model.
11. In **Coaching**, book a future session as the customer with a payment method. Then confirm its payment as staff; the session becomes confirmed. Log in as coach to show only the assigned schedule and session notes.
12. End in **Settings**: update a non-sensitive demo setting or logo crop to demonstrate owner-level branding control. Do not save real credentials or a production logo to a public demo database.

## High-value proof points

- **No double bookings:** create a pending slot, then attempt an overlapping booking of the same court. It must fail with a conflict message. Adjacent times are allowed.
- **Manual payment control:** payment choice records intent, but payment confirmation is an explicit staff action that activates the purchased service.
- **One-time entry:** QR/access-pass and normal staff check-in are transaction-locked and cannot check in the same booking twice.
- **Refund policy:** cancel a paid booking, then show the refund option only while it is within the configured refund window. Package credits, equipment reservations, and promo capacity are restored automatically on cancellation.
- **Membership benefits:** show that the active plan's court discount and booking limit are enforced during the price quote and booking creation.
- **Operations visibility:** customer booking/payment activity creates notifications and audit records for staff/owners.

## Before sharing a demo link

- Run the release gate from [DEPLOYMENT.md](../DEPLOYMENT.md).
- Verify SMTP/HTTP email using an email address you control.
- Confirm the public business name, logo, contact details, court photos, and sample tournament look appropriate.
- Keep demo data fictional and do not show personal production data.
- Tell the client that payment methods are operational/manual verification today; a real online payment gateway is an optional next integration.
