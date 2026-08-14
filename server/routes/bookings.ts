import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, authorize, requireVerifiedEmail } from "../middleware/auth.js";
import { AppError } from "../utils/errors.js";
import { createBooking, getManilaDate, getRules, serializeBooking } from "../services/booking.js";
import { canCancelBooking } from "../utils/membershipRules.js";
import { CHECKED_IN_RESCHEDULE_CUTOFF_MINUTES, canRescheduleBooking, isWithinRefundWindow } from "../utils/bookingRules.js";

export const bookingsRouter = Router();
bookingsRouter.use(authenticate);
bookingsRouter.use(requireVerifiedEmail);

const bookingInput = z.object({ customerId: z.string().min(1).optional(), courtId: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startTime: z.string().regex(/^\d{2}:\d{2}$/), durationMinutes: z.coerce.number().int(), promoCode: z.string().trim().max(30).optional(), paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "GCASH", "CARD", "ONLINE_PAYMENT"]).default("CASH"), transactionReference: z.string().trim().max(120).optional(), packagePurchaseId: z.string().optional(), walletAmount: z.coerce.number().nonnegative().optional() });

async function customerForRequest(userId: string) {
  const customer = await prisma.customer.findUnique({ where: { userId } });
  if (!customer) throw new AppError(403, "This account does not have a customer profile.");
  return customer;
}

bookingsRouter.get("/", async (req, res, next) => {
  try {
    const isAdmin = req.auth!.roles.some((role) => ["SUPER_ADMIN", "ADMIN", "STAFF"].includes(role));
    const customer = isAdmin ? null : await customerForRequest(req.auth!.userId);
    const input = z.object({ search: z.string().trim().max(100).optional(), status: z.enum(["PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED", "CANCELLED", "NO_SHOW", "REFUNDED"]).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }).parse(req.query);
    const search = input.search;
    const where = { ...(customer ? { customerId: customer.id } : {}), ...(input.status ? { status: input.status } : {}), ...(input.from || input.to ? { startsAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lt: input.to } : {}) } } : {}), ...(search ? { OR: [{ reference: { contains: search, mode: "insensitive" as const } }, { court: { name: { contains: search, mode: "insensitive" as const } } }, { customer: { user: { OR: [{ firstName: { contains: search, mode: "insensitive" as const } }, { lastName: { contains: search, mode: "insensitive" as const } }, { email: { contains: search, mode: "insensitive" as const } }] } } }] } : {}) };
    const [bookings, total] = await Promise.all([prisma.booking.findMany({ where, include: { court: true, customer: { include: { user: { select: { firstName: true, lastName: true, email: true } } } }, payments: true, accessPass: true }, orderBy: [{ createdAt: "desc" }, { startsAt: "desc" }], skip: (input.page - 1) * input.limit, take: input.limit }), prisma.booking.count({ where })]);
    const now = new Date();
    res.json({ success: true, data: { bookings: bookings.map((booking) => {
      const serialized = serializeBooking(booking);
      const availability = {
        canReschedule: canRescheduleBooking(booking.status, booking.startsAt, now),
        rescheduleDeadline: booking.status === "CHECKED_IN" ? new Date(booking.startsAt.getTime() - CHECKED_IN_RESCHEDULE_CUTOFF_MINUTES * 60_000).toISOString() : null
      };
      return !isAdmin && !["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(booking.status) ? { ...serialized, ...availability, qrToken: undefined } : { ...serialized, ...availability };
    }), pagination: { page: input.page, limit: input.limit, total, pages: Math.ceil(total / input.limit) } } });
  } catch (error) { next(error); }
});

bookingsRouter.post("/", async (req, res, next) => {
  try {
    const input = bookingInput.parse(req.body);
    const isOperations = req.auth!.roles.some((role) => ["SUPER_ADMIN", "ADMIN", "STAFF"].includes(role));
    if (isOperations && !input.customerId) throw new AppError(400, "Select a customer for this booking.");
    const customer = isOperations
      ? await prisma.customer.findFirst({ where: { id: input.customerId, deletedAt: null, user: { status: "ACTIVE" } } })
      : await customerForRequest(req.auth!.userId);
    if (!customer) throw new AppError(404, "An active customer must be selected.");
    const booking = await createBooking({ ...input, customerId: customer.id, createdById: req.auth!.userId });
    res.status(201).json({ success: true, data: { booking: { ...booking, qrToken: undefined }, message: booking.status === "CONFIRMED" ? "Booking confirmed using your club credit. Your time-bound access pass is ready." : "Booking request received. Staff must confirm your payment before the booking is confirmed and the QR code becomes available." } });
  } catch (error) { next(error); }
});

bookingsRouter.post("/:id/reschedule", async (req, res, next) => {
  try {
    const input = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startTime: z.string().regex(/^\d{2}:\d{2}$/) }).parse(req.body);
    const booking = await prisma.booking.findUnique({ where: { id: String(req.params.id) }, include: { customer: true, court: true } });
    if (!booking) throw new AppError(404, "Booking not found.");
    const isOperations = req.auth!.roles.some((role) => ["SUPER_ADMIN", "ADMIN", "STAFF"].includes(role));
    if (!isOperations && booking.customer.userId !== req.auth!.userId) throw new AppError(403, "You cannot reschedule this booking.");
    if (!canRescheduleBooking(booking.status, booking.startsAt, new Date())) {
      if (booking.status === "CHECKED_IN") throw new AppError(409, `Checked-in bookings can only be rescheduled while more than ${CHECKED_IN_RESCHEDULE_CUTOFF_MINUTES} minutes remain before the original start time.`);
      throw new AppError(409, "Only pending, confirmed, or sufficiently early checked-in bookings can be rescheduled.");
    }
    const rules = await getRules(prisma as never); const startsAt = getManilaDate(input.date, input.startTime); const endsAt = new Date(startsAt.getTime() + booking.durationMinutes * 60_000);
    if (startsAt.getTime() < Date.now() + rules.minimumAdvanceMinutes * 60_000) throw new AppError(400, `Bookings must be made at least ${rules.minimumAdvanceMinutes} minutes ahead.`);
    if (startsAt.getTime() > Date.now() + rules.maximumAdvanceDays * 86_400_000) throw new AppError(400, `Bookings can only be made ${rules.maximumAdvanceDays} days ahead.`);
    const [openingHours, closingHours] = [booking.court.openingTime.split(":").map(Number), booking.court.closingTime.split(":").map(Number)]; const startMinutes = Number(input.startTime.slice(0, 2)) * 60 + Number(input.startTime.slice(3)); const closeMinutes = closingHours[0] * 60 + closingHours[1]; const openMinutes = openingHours[0] * 60 + openingHours[1];
    if (startMinutes < openMinutes || startMinutes + booking.durationMinutes > closeMinutes) throw new AppError(400, `This court is open from ${booking.court.openingTime} to ${booking.court.closingTime}.`);
    const weekday = new Date(`${input.date}T12:00:00+08:00`).getUTCDay();
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${booking.id}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${booking.courtId}))`;
      const current = await tx.booking.findUnique({ where: { id: booking.id }, select: { status: true, startsAt: true } });
      if (!current || !canRescheduleBooking(current.status, current.startsAt, new Date())) {
        if (current?.status === "CHECKED_IN") throw new AppError(409, `The ${CHECKED_IN_RESCHEDULE_CUTOFF_MINUTES}-minute checked-in reschedule cutoff has passed.`);
        throw new AppError(409, "This booking has changed and can no longer be rescheduled.");
      }
      const currentCourt = await tx.court.findUnique({ where: { id: booking.courtId } });
      if (!currentCourt || currentCourt.deletedAt || currentCourt.status !== "AVAILABLE") throw new AppError(409, "This court is not currently available for rescheduling.");
      const currentOpen = currentCourt.openingTime.split(":").map(Number); const currentClose = currentCourt.closingTime.split(":").map(Number);
      const currentOpenMinutes = currentOpen[0] * 60 + currentOpen[1]; const currentCloseMinutes = currentClose[0] * 60 + currentClose[1];
      if (startMinutes < currentOpenMinutes || startMinutes + booking.durationMinutes > currentCloseMinutes) throw new AppError(400, `This court is open from ${currentCourt.openingTime} to ${currentCourt.closingTime}.`);
      const blockedSchedules = await tx.courtSchedule.findMany({
        where: { courtId: booking.courtId, weekday, isBlocked: true },
        select: { startTime: true, endTime: true }
      });
      const toMinutes = (value: string) => { const [hours, minutes] = value.split(":").map(Number); return hours * 60 + minutes; };
      const scheduleConflicts = blockedSchedules.some((schedule) => toMinutes(schedule.startTime) < startMinutes + booking.durationMinutes && toMinutes(schedule.endTime) > startMinutes);
      if (scheduleConflicts) throw new AppError(409, "This court is blocked for the selected time.");
      const conflict = await tx.booking.findFirst({ where: { id: { not: booking.id }, courtId: booking.courtId, status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } });
      if (conflict) throw new AppError(409, "Court is already booked for this time.");
      const openPlayConflict = await tx.openPlay.findFirst({ where: { courtId: booking.courtId, status: { in: ["OPEN", "FILLED", "CONFIRMED"] }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } });
      if (openPlayConflict) throw new AppError(409, "This court is reserved for an open-play session at that time.");
      const earlyCheckInReversed = current.status === "CHECKED_IN";
      if (earlyCheckInReversed) await tx.bookingCheckIn.deleteMany({ where: { bookingId: booking.id } });
      const next = await tx.booking.update({ where: { id: booking.id }, data: { startsAt, endsAt, ...(earlyCheckInReversed ? { status: "CONFIRMED" as const } : {}) } });
      await tx.bookingAccessPass.updateMany({ where: { bookingId: booking.id, status: "ACTIVE" }, data: { validFrom: new Date(startsAt.getTime() - 30 * 60_000), validUntil: new Date(endsAt.getTime() + 30 * 60_000) } });
      await tx.equipmentRental.updateMany({ where: { bookingId: booking.id }, data: { startsAt, endsAt } });
      await tx.notification.create({ data: { userId: booking.customer.userId, customerId: booking.customerId, type: "BOOKING", title: "Booking rescheduled", message: `${booking.reference} has a new time: ${input.date} ${input.startTime}.${earlyCheckInReversed ? " Your early check-in was reset; please check in again for the new schedule." : ""}`, channel: "IN_APP" } });
      await tx.auditLog.create({ data: { userId: req.auth!.userId, action: "BOOKING_RESCHEDULED", entity: "Booking", entityId: booking.id, metadata: { reference: booking.reference, date: input.date, startTime: input.startTime, earlyCheckInReversed } } });
      return next;
    });
    await import("../services/growth.js").then(({ offerWaitlistForSlot }) => offerWaitlistForSlot(booking.courtId, booking.startsAt, booking.durationMinutes)).catch(() => null);
    res.json({ success: true, data: { booking: serializeBooking(updated) } });
  } catch (error) { next(error); }
});

bookingsRouter.post("/:id/cancel", async (req, res, next) => {
  try {
    const body = z.object({ reason: z.string().trim().max(250).optional() }).parse(req.body ?? {});
    const bookingId = String(req.params.id);
    const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { customer: true, packagePurchase: true, payments: { select: { status: true } } } });
    if (!booking) throw new AppError(404, "Booking not found.");
    const isAdmin = req.auth!.roles.some((role) => ["SUPER_ADMIN", "ADMIN", "STAFF"].includes(role));
    if (!isAdmin && booking.customer.userId !== req.auth!.userId) throw new AppError(403, "You cannot modify this booking.");
    if (!canCancelBooking(booking.status)) throw new AppError(409, "Only pending or confirmed bookings can be cancelled.");
    const rules = await getRules(prisma as never);
    const hoursUntilStart = (booking.startsAt.getTime() - Date.now()) / 3_600_000;
    if (!isAdmin && hoursUntilStart < rules.cancellationHours) throw new AppError(400, `Bookings must be cancelled at least ${rules.cancellationHours} hours before start time.`);
    const hasPaidPayment = booking.payments.some((payment) => payment.status === "PAID");
    const refundEligible = hasPaidPayment && isWithinRefundWindow(booking.createdAt, new Date(), rules.refundWindowHours);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${booking.id}))`;
      const current = await tx.booking.findUnique({ where: { id: booking.id }, select: { status: true } });
      if (!current || !canCancelBooking(current.status)) throw new AppError(409, "This booking has already changed and can no longer be cancelled.");
      await tx.bookingAccessPass.updateMany({ where: { bookingId: booking.id, status: "ACTIVE" }, data: { status: "REVOKED" } });
      const rentals = await tx.equipmentRental.findMany({ where: { bookingId: booking.id, status: "RESERVED" }, include: { equipment: true }, orderBy: { equipmentId: "asc" } });
      for (const rental of rentals) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`equipment:${rental.equipmentId}`}))`;
        const equipment = await tx.equipment.findUniqueOrThrow({ where: { id: rental.equipmentId } });
        await tx.equipment.update({ where: { id: rental.equipmentId }, data: { availableQuantity: Math.min(equipment.quantity, equipment.availableQuantity + rental.quantity) } });
        await tx.equipmentRental.update({ where: { id: rental.id }, data: { status: "CANCELLED", returnedAt: new Date() } });
      }
      if (booking.packagePurchaseId && booking.packagePurchase) {
        const packageStatus = booking.packagePurchase.expiresAt > new Date() ? "ACTIVE" as const : "EXPIRED" as const;
        await tx.packagePurchase.update({ where: { id: booking.packagePurchaseId }, data: { creditsRemaining: { increment: 1 }, status: packageStatus } });
      }
      const walletDebit = await tx.walletTransaction.findFirst({ where: { customerId: booking.customerId, type: "DEBIT", reference: booking.reference } });
      if (walletDebit) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet:${booking.customerId}`}))`;
        const restoredAlready = await tx.walletTransaction.findFirst({ where: { customerId: booking.customerId, type: "REFUND", reference: `CANCEL:${booking.reference}` } });
        if (!restoredAlready) {
          const customer = await tx.customer.findUniqueOrThrow({ where: { id: booking.customerId } });
          const balanceAfter = Number(customer.walletBalance) + Number(walletDebit.amount);
          await tx.customer.update({ where: { id: booking.customerId }, data: { walletBalance: balanceAfter } });
          await tx.walletTransaction.create({ data: { customerId: booking.customerId, type: "REFUND", amount: walletDebit.amount, balanceAfter, description: `Credit restored after cancelling ${booking.reference}`, reference: `CANCEL:${booking.reference}` } });
        }
      }
      const promotionUsages = await tx.promotionUsage.findMany({ where: { bookingId: booking.id }, select: { id: true, promotionId: true } });
      for (const usage of promotionUsages) await tx.promotion.updateMany({ where: { id: usage.promotionId, usedCount: { gt: 0 } }, data: { usedCount: { decrement: 1 } } });
      if (promotionUsages.length) await tx.promotionUsage.deleteMany({ where: { id: { in: promotionUsages.map((usage) => usage.id) } } });
      const next = await tx.booking.update({ where: { id: booking.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledReason: body.reason } });
      await tx.notification.create({ data: { userId: booking.customer.userId, customerId: booking.customerId, type: "BOOKING", title: "Booking cancelled", message: `${booking.reference} has been cancelled.`, channel: "IN_APP" } });
      await tx.auditLog.create({ data: { userId: req.auth!.userId, action: "BOOKING_CANCELLED", entity: "Booking", entityId: booking.id, metadata: { reference: booking.reference, reason: body.reason } } });
      return next;
    });
    await import("../services/growth.js").then(({ offerWaitlistForSlot }) => offerWaitlistForSlot(booking.courtId, booking.startsAt, booking.durationMinutes)).catch(() => null);
    const message = refundEligible
      ? "Booking cancelled. The paid payment is eligible for a refund. Club credits and reserved equipment were restored automatically."
      : hasPaidPayment
        ? "Booking cancelled. The paid payment is outside the automatic refund window. Club credits and reserved equipment were restored automatically."
        : "Booking cancelled. Club credits and reserved equipment were restored automatically.";
    res.json({ success: true, data: { booking: serializeBooking(updated), refundEligible, refundWindowHours: rules.refundWindowHours, message } });
  } catch (error) { next(error); }
});

bookingsRouter.post("/:id/check-in", authorize("SUPER_ADMIN", "ADMIN", "STAFF"), async (req, res, next) => {
  try {
    const bookingId = String(req.params.id);
    const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { payments: { select: { status: true } } } });
    if (!booking) throw new AppError(404, "Booking not found.");
    if (booking.status !== "CONFIRMED") throw new AppError(409, "Only confirmed bookings can be checked in. Staff must confirm payment first.");
    if (!booking.payments.some((payment) => payment.status === "PAID")) throw new AppError(409, "Payment has not been confirmed for this booking.");
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${booking.id}))`;
      const current = await tx.booking.findUnique({ where: { id: booking.id }, include: { payments: { select: { status: true } } } });
      if (!current) throw new AppError(404, "Booking not found.");
      if (current.status !== "CONFIRMED") throw new AppError(409, "This booking is no longer available for check-in.");
      if (!current.payments.some((payment) => payment.status === "PAID")) throw new AppError(409, "Payment has not been confirmed for this booking.");
      const existing = await tx.bookingCheckIn.findUnique({ where: { bookingId: booking.id } });
      if (existing) throw new AppError(409, "This booking has already been checked in.");
      await tx.bookingCheckIn.create({ data: { bookingId: booking.id, checkedById: req.auth!.userId } });
      await tx.bookingAccessPass.updateMany({ where: { bookingId: booking.id, status: "ACTIVE" }, data: { status: "USED", usedAt: new Date(), usedById: req.auth!.userId } });
      return tx.booking.update({ where: { id: booking.id }, data: { status: "CHECKED_IN" } });
    });
    res.json({ success: true, data: { booking: serializeBooking(updated) } });
  } catch (error) { next(error); }
});

bookingsRouter.post("/check-in/qr", authorize("SUPER_ADMIN", "ADMIN", "STAFF"), async (req, res, next) => {
  try {
    const input = z.object({ qrToken: z.string().min(1) }).parse(req.body);
    const booking = await prisma.booking.findUnique({ where: { qrToken: input.qrToken }, include: { payments: { select: { status: true } } } });
    if (!booking) throw new AppError(404, "Booking QR code was not recognized.");
    if (booking.status !== "CONFIRMED") throw new AppError(409, "This booking is not confirmed. Staff must confirm payment before check-in.");
    if (!booking.payments.some((payment) => payment.status === "PAID")) throw new AppError(409, "Payment has not been confirmed for this booking.");
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${booking.id}))`;
      const current = await tx.booking.findUnique({ where: { id: booking.id }, include: { payments: { select: { status: true } } } });
      if (!current) throw new AppError(404, "Booking not found.");
      if (current.status !== "CONFIRMED") throw new AppError(409, "This booking is no longer available for check-in.");
      if (!current.payments.some((payment) => payment.status === "PAID")) throw new AppError(409, "Payment has not been confirmed for this booking.");
      const existing = await tx.bookingCheckIn.findUnique({ where: { bookingId: booking.id } });
      if (existing) throw new AppError(409, "This booking has already been checked in.");
      await tx.bookingCheckIn.create({ data: { bookingId: booking.id, checkedById: req.auth!.userId } });
      await tx.bookingAccessPass.updateMany({ where: { bookingId: booking.id, status: "ACTIVE" }, data: { status: "USED", usedAt: new Date(), usedById: req.auth!.userId } });
      return tx.booking.update({ where: { id: booking.id }, data: { status: "CHECKED_IN" } });
    });
    res.json({ success: true, data: { booking: serializeBooking(updated) } });
  } catch (error) { next(error); }
});

async function updateOperationalStatus(req: Request, res: Response, next: NextFunction, status: "CONFIRMED" | "COMPLETED" | "NO_SHOW") {
  try {
    const booking = await prisma.booking.findUnique({ where: { id: String(req.params.id) }, include: { customer: true, payments: { select: { status: true } } } });
    if (!booking) throw new AppError(404, "Booking not found.");
    if (booking.status === "CANCELLED" || booking.status === "REFUNDED") throw new AppError(409, "Cancelled or refunded bookings cannot be updated.");
    const allowed: Record<typeof status, string[]> = { CONFIRMED: ["PENDING"], COMPLETED: ["CONFIRMED", "CHECKED_IN"], NO_SHOW: ["PENDING", "CONFIRMED"] };
    if (status === "CONFIRMED" && !booking.payments.some((payment) => payment.status === "PAID")) throw new AppError(409, "Payment must be confirmed before this booking can be confirmed.");
    if (!allowed[status].includes(booking.status)) throw new AppError(409, `A ${booking.status.toLowerCase().replaceAll("_", " ")} booking cannot be marked ${status.toLowerCase().replaceAll("_", " ")}.`);
    if (status === "NO_SHOW" && booking.startsAt > new Date()) throw new AppError(400, "A booking can only be marked no-show after its start time.");
    if (status === "COMPLETED" && booking.endsAt > new Date()) throw new AppError(400, "A booking can only be completed after its scheduled end time.");
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${booking.id}))`;
      const current = await tx.booking.findUnique({ where: { id: booking.id }, include: { payments: { select: { status: true } } } });
      if (!current) throw new AppError(404, "Booking not found.");
      if (!allowed[status].includes(current.status)) throw new AppError(409, "This booking changed while the request was being processed. Refresh and try again.");
      if (status === "CONFIRMED" && !current.payments.some((payment) => payment.status === "PAID")) throw new AppError(409, "Payment must be confirmed before this booking can be confirmed.");
      if (status === "NO_SHOW" && current.startsAt > new Date()) throw new AppError(400, "A booking can only be marked no-show after its start time.");
      if (status === "COMPLETED" && current.endsAt > new Date()) throw new AppError(400, "A booking can only be completed after its scheduled end time.");
      const nextBooking = await tx.booking.update({ where: { id: current.id }, data: { status } });
      if (["COMPLETED", "NO_SHOW"].includes(status)) await tx.bookingAccessPass.updateMany({ where: { bookingId: current.id, status: "ACTIVE" }, data: { status: "EXPIRED" } });
      await tx.notification.create({ data: { userId: booking.customer.userId, customerId: booking.customerId, type: "BOOKING", title: `Booking ${status.toLowerCase().replace("_", " ")}`, message: `${booking.reference} is now ${status.toLowerCase().replace("_", " ")}.`, actionUrl: "/app/bookings", channel: "IN_APP" } });
      await tx.auditLog.create({ data: { userId: req.auth!.userId, action: `BOOKING_${status}`, entity: "Booking", entityId: booking.id, metadata: { reference: booking.reference } } });
      return nextBooking;
    });
    res.json({ success: true, data: { booking: serializeBooking(updated) } });
  } catch (error) { next(error); }
}

bookingsRouter.post("/:id/confirm", authorize("SUPER_ADMIN", "ADMIN", "STAFF"), (req, res, next) => void updateOperationalStatus(req, res, next, "CONFIRMED"));
bookingsRouter.post("/:id/complete", authorize("SUPER_ADMIN", "ADMIN", "STAFF"), (req, res, next) => void updateOperationalStatus(req, res, next, "COMPLETED"));
bookingsRouter.post("/:id/no-show", authorize("SUPER_ADMIN", "ADMIN", "STAFF"), (req, res, next) => void updateOperationalStatus(req, res, next, "NO_SHOW"));
