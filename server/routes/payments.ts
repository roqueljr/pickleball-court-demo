import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { AppError } from "../utils/errors.js";
import { canConfirmPayment, getRefundStatus } from "../utils/membershipRules.js";
import { getRules } from "../services/booking.js";
import { isWithinRefundWindow } from "../utils/bookingRules.js";
import { createAccessPass } from "../services/growth.js";

export const paymentsRouter = Router();
paymentsRouter.use(authenticate);

function serializePayment(payment: { id: string; bookingId: string | null; membershipId?: string | null; customerId: string; amount: unknown; discount: unknown; tax: unknown; finalAmount: unknown; method: string; status: string; transactionReference: string | null; paidAt: Date | null; createdAt: Date; booking: { reference: string; status: string; court: { name: string } } | null; membership?: { plan: { name: string } } | null; packagePurchase?: { packagePlan: { name: string } } | null; openPlayParticipant?: { openPlay: { title: string } } | null; leagueEntry?: { league: { name: string } } | null; coachingSession?: { status: string; coach: { user: { firstName: string; lastName: string } } } | null; walletTopUp?: { amount: unknown } | null; refunds: { amount: unknown }[]; customer: { user: { firstName: string; lastName: string; email: string } } }) {
  const { refunds, ...record } = payment;
  return { ...record, amount: Number(payment.amount), discount: Number(payment.discount), tax: Number(payment.tax), finalAmount: Number(payment.finalAmount), refundedAmount: refunds.reduce((sum, refund) => sum + Number(refund.amount), 0), paidAt: payment.paidAt?.toISOString() ?? null, createdAt: payment.createdAt.toISOString() };
}

const paymentInclude = { booking: { select: { reference: true, status: true, court: { select: { name: true } } } }, membership: { select: { plan: { select: { name: true } } } }, packagePurchase: { select: { packagePlan: { select: { name: true } } } }, openPlayParticipant: { select: { openPlay: { select: { title: true } } } }, leagueEntry: { select: { league: { select: { name: true } } } }, coachingSession: { select: { status: true, coach: { select: { user: { select: { firstName: true, lastName: true } } } } } }, walletTopUp: { select: { amount: true } }, refunds: { select: { amount: true } }, customer: { include: { user: { select: { firstName: true, lastName: true, email: true } } } } };

paymentsRouter.get("/", async (req, res, next) => {
  try {
    const isOperations = req.auth!.roles.some((role) => ["SUPER_ADMIN", "ADMIN", "STAFF"].includes(role));
    const customer = isOperations ? null : await prisma.customer.findUnique({ where: { userId: req.auth!.userId } });
    if (!isOperations && !customer) throw new AppError(403, "Payment history is only available to customers and authorized operations staff.");
    const payments = await prisma.payment.findMany({ where: customer ? { customerId: customer.id } : {}, include: paymentInclude, orderBy: { createdAt: "desc" }, take: 100 });
    res.json({ success: true, data: { payments: payments.map(serializePayment) } });
  } catch (error) { next(error); }
});

paymentsRouter.post("/", authorize("SUPER_ADMIN", "ADMIN", "STAFF"), async (req, res, next) => {
  try {
    const input = z.object({ customerId: z.string(), bookingId: z.string().optional(), membershipId: z.string().optional(), amount: z.coerce.number().nonnegative(), discount: z.coerce.number().nonnegative().default(0), tax: z.coerce.number().nonnegative().default(0), finalAmount: z.coerce.number().nonnegative(), method: z.enum(["CASH", "BANK_TRANSFER", "GCASH", "CARD", "ONLINE_PAYMENT"]), status: z.enum(["PENDING", "PAID"]).default("PAID"), transactionReference: z.string().trim().max(120).optional() }).refine((value) => !(value.bookingId && value.membershipId), { message: "A payment can be linked to either a booking or a membership, not both." }).parse(req.body);
    const customer = await prisma.customer.findUnique({ where: { id: input.customerId } }); if (!customer) throw new AppError(404, "Customer not found.");
    const payment = await prisma.$transaction(async (tx) => {
      if (input.bookingId) {
        const booking = await tx.booking.findUnique({ where: { id: input.bookingId } });
        if (!booking || booking.customerId !== input.customerId) throw new AppError(400, "The selected booking does not belong to this customer.");
        if (input.status === "PAID" && booking.status !== "PENDING") throw new AppError(409, "Only a pending booking can be activated by a new payment.");
      }
      if (input.membershipId) {
        const membership = await tx.membership.findUnique({ where: { id: input.membershipId }, include: { plan: true } });
        if (!membership || membership.customerId !== input.customerId) throw new AppError(400, "The selected membership does not belong to this customer.");
        if (input.status === "PAID" && membership.status !== "PENDING") throw new AppError(409, "Only a pending membership can be activated by a new payment.");
      }
      const created = await tx.payment.create({ data: { ...input, recordedById: req.auth!.userId, paidAt: input.status === "PAID" ? new Date() : null }, include: paymentInclude });
      if (input.bookingId && input.status === "PAID") { const booking = await tx.booking.update({ where: { id: input.bookingId }, data: { status: "CONFIRMED" } }); await createAccessPass(tx, booking); }
      if (input.membershipId && input.status === "PAID") {
        const membership = await tx.membership.findUniqueOrThrow({ where: { id: input.membershipId }, include: { plan: true } });
        const now = new Date();
        await tx.membership.updateMany({ where: { customerId: input.customerId, id: { not: membership.id }, status: "ACTIVE" }, data: { status: "CANCELLED", endDate: now } });
        await tx.membership.update({ where: { id: membership.id }, data: { status: "ACTIVE", startDate: now, endDate: new Date(now.getTime() + membership.plan.durationDays * 86_400_000) } });
      }
      await tx.notification.create({ data: { userId: customer.userId, customerId: customer.id, type: "PAYMENT", title: "Payment recorded", message: `Payment of ₱${input.finalAmount.toLocaleString()} has been recorded.`, channel: "IN_APP" } });
      await tx.auditLog.create({ data: { userId: req.auth!.userId, action: "PAYMENT_CREATED", entity: "Payment", entityId: created.id, metadata: { amount: input.finalAmount } } });
      return created;
    });
    res.status(201).json({ success: true, data: { payment: serializePayment(payment) } });
  } catch (error) { next(error); }
});

paymentsRouter.post("/:id/confirm", authorize("SUPER_ADMIN", "ADMIN", "STAFF"), async (req, res, next) => {
  try {
    const input = z.object({ method: z.enum(["CASH", "BANK_TRANSFER", "GCASH", "CARD", "ONLINE_PAYMENT"]).optional(), transactionReference: z.string().trim().max(120).optional() }).parse(req.body ?? {});
    const paymentId = String(req.params.id);
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment:${paymentId}`}))`;
      const current = await tx.payment.findUnique({ where: { id: paymentId }, include: { membership: { include: { plan: true } }, packagePurchase: { include: { packagePlan: true } }, openPlayParticipant: { include: { openPlay: true } }, leagueEntry: { include: { league: true } }, coachingSession: { include: { coach: { include: { user: true } } } }, walletTopUp: true, booking: true, customer: true } });
      if (!current) throw new AppError(404, "Payment not found.");
      const hasPurchase = Boolean(current.membershipId || current.bookingId || current.packagePurchaseId || current.openPlayParticipantId || current.leagueEntryId || current.coachingSessionId || current.walletTopUp);
      if (!canConfirmPayment(current.status, hasPurchase)) throw new AppError(409, current.status !== "PENDING" ? "Only pending payments can be confirmed." : "This payment is not linked to a confirmable purchase.");
      if (current.booking && current.booking.status !== "PENDING") throw new AppError(409, "The linked booking is no longer awaiting payment.");
      if (current.membership && current.membership.status !== "PENDING") throw new AppError(409, "The linked membership is no longer awaiting payment.");
      if (current.packagePurchase && current.packagePurchase.status !== "PENDING") throw new AppError(409, "The linked package is no longer awaiting payment.");
      if (current.openPlayParticipant && current.openPlayParticipant.status !== "JOINED") throw new AppError(409, "The linked open-play registration is no longer awaiting payment.");
      if (current.leagueEntry && current.leagueEntry.status !== "PENDING") throw new AppError(409, "The linked league entry is no longer awaiting payment.");
      if (current.coachingSession && current.coachingSession.status !== "PENDING") throw new AppError(409, "The linked coaching session is no longer awaiting payment.");
      if (current.walletTopUp && current.walletTopUp.status !== "PENDING") throw new AppError(409, "The linked wallet top-up is no longer awaiting payment.");

      const updated = await tx.payment.update({ where: { id: current.id }, data: { status: "PAID", paidAt: new Date(), recordedById: req.auth!.userId, ...(input.method ? { method: input.method } : {}), ...(input.transactionReference !== undefined ? { transactionReference: input.transactionReference || null } : {}) }, include: paymentInclude });
      if (current.membershipId) {
        const now = new Date();
        await tx.membership.updateMany({ where: { customerId: current.customerId, id: { not: current.membershipId }, status: "ACTIVE" }, data: { status: "CANCELLED", endDate: now } });
        await tx.membership.update({ where: { id: current.membershipId }, data: { status: "ACTIVE", startDate: now, endDate: new Date(now.getTime() + (current.membership?.plan.durationDays ?? 30) * 86_400_000) } });
      }
      if (current.packagePurchaseId) await tx.packagePurchase.update({ where: { id: current.packagePurchaseId }, data: { status: "ACTIVE", startsAt: new Date(), expiresAt: new Date(Date.now() + (current.packagePurchase?.packagePlan.validityDays ?? 30) * 86_400_000) } });
      if (current.walletTopUp) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet:${current.customerId}`}))`;
        const customer = await tx.customer.findUniqueOrThrow({ where: { id: current.customerId } });
        const balanceAfter = Number(customer.walletBalance) + Number(current.walletTopUp.amount);
        await tx.customer.update({ where: { id: customer.id }, data: { walletBalance: balanceAfter } });
        await tx.walletTopUp.update({ where: { id: current.walletTopUp.id }, data: { status: "PAID" } });
        await tx.walletTransaction.create({ data: { customerId: customer.id, type: "CREDIT", amount: current.walletTopUp.amount, balanceAfter, description: "Wallet top-up", reference: input.transactionReference || current.transactionReference } });
      }
      if (current.openPlayParticipant) {
        await tx.openPlayParticipant.update({ where: { id: current.openPlayParticipant.id }, data: { status: "PAID", paidAt: new Date() } });
        const paidCount = await tx.openPlayParticipant.count({ where: { openPlayId: current.openPlayParticipant.openPlayId, OR: [{ id: current.openPlayParticipant.id }, { status: "PAID" }] } });
        if (paidCount >= current.openPlayParticipant.openPlay.capacity) await tx.openPlay.update({ where: { id: current.openPlayParticipant.openPlayId }, data: { status: "CONFIRMED" } });
      }
      if (current.leagueEntry) await tx.leagueEntry.update({ where: { id: current.leagueEntry.id }, data: { status: "ACTIVE" } });
      if (current.coachingSession) await tx.coachingSession.update({ where: { id: current.coachingSession.id }, data: { status: "CONFIRMED" } });
      if (current.bookingId) {
        const booking = await tx.booking.update({ where: { id: current.bookingId }, data: { status: "CONFIRMED" }, include: { court: true } });
        await createAccessPass(tx, booking);
        await tx.notification.create({ data: { userId: current.customer.userId, customerId: current.customerId, type: "BOOKING", title: "Booking confirmed", message: `${booking.reference} is confirmed. Your time-bound access pass is ready.`, actionUrl: "/app/bookings", channel: "IN_APP" } });
      }
      const coachingName = current.coachingSession ? `Coaching with ${current.coachingSession.coach.user.firstName} ${current.coachingSession.coach.user.lastName}` : undefined;
      const purchaseName = current.membership?.plan.name ?? current.packagePurchase?.packagePlan.name ?? current.openPlayParticipant?.openPlay.title ?? current.leagueEntry?.league.name ?? coachingName;
      await tx.notification.create({ data: { userId: current.customer.userId, customerId: current.customerId, type: current.membership ? "MEMBERSHIP" : "PAYMENT", title: purchaseName ? `${purchaseName} payment confirmed` : "Payment confirmed", message: current.walletTopUp ? `₱${Number(current.finalAmount).toLocaleString()} was added to your club wallet.` : purchaseName ? `${purchaseName} is now active and confirmed.` : `Payment of ₱${Number(current.finalAmount).toLocaleString()} has been confirmed.`, actionUrl: current.bookingId ? "/app/bookings" : current.membershipId ? "/app/memberships" : current.coachingSessionId ? "/app/coaching" : "/app/growth", channel: "IN_APP" } });
      await tx.auditLog.create({ data: { userId: req.auth!.userId, action: "PAYMENT_CONFIRMED", entity: "Payment", entityId: current.id, metadata: { amount: Number(current.finalAmount), membershipId: current.membershipId, bookingId: current.bookingId } } });
      return updated;
    });
    res.json({ success: true, data: { payment: serializePayment(result) } });
  } catch (error) { next(error); }
});

paymentsRouter.post("/:id/refund", authorize("SUPER_ADMIN", "ADMIN"), async (req, res, next) => {
  try {
    const input = z.object({ amount: z.coerce.number().positive(), reason: z.string().trim().max(250).optional() }).parse(req.body);
    const paymentId = String(req.params.id);
    const rules = await getRules(prisma as never);
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment:${paymentId}`}))`;
      const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { booking: true, coachingSession: true, customer: true, walletTopUp: true } });
      if (!payment) throw new AppError(404, "Payment not found.");
      if (payment.booking) {
        if (payment.booking.status !== "CANCELLED") throw new AppError(409, "A booking payment can only be refunded after the booking is cancelled.");
        if (!isWithinRefundWindow(payment.booking.createdAt, new Date(), rules.refundWindowHours)) throw new AppError(400, `This booking is outside the ${rules.refundWindowHours}-hour refund window.`);
      }
      if (payment.coachingSession && payment.coachingSession.status !== "CANCELLED") throw new AppError(409, "Cancel the coaching session before refunding its payment.");
      const existingRefunds = await tx.refund.aggregate({ where: { paymentId: payment.id }, _sum: { amount: true } });
      const refunded = Number(existingRefunds._sum.amount ?? 0);
      const refundDecision = getRefundStatus(payment.status, Number(payment.finalAmount), refunded, input.amount);
      if (!refundDecision.valid) throw new AppError(400, refundDecision.reason);
      const nextStatus = refundDecision.status;
      if (payment.walletTopUp) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet:${payment.customerId}`}))`;
        const customer = await tx.customer.findUniqueOrThrow({ where: { id: payment.customerId } });
        if (Number(customer.walletBalance) < input.amount) throw new AppError(409, "The wallet balance is too low to reverse this top-up because some of the credit has already been spent.");
        const balanceAfter = Number(customer.walletBalance) - input.amount;
        await tx.customer.update({ where: { id: customer.id }, data: { walletBalance: balanceAfter } });
        await tx.walletTransaction.create({ data: { customerId: customer.id, type: "DEBIT", amount: input.amount, balanceAfter, description: "Wallet top-up refund", reference: `REFUND:${payment.id}` } });
      }
      const refund = await tx.refund.create({ data: { paymentId: payment.id, processedById: req.auth!.userId, amount: input.amount, reason: input.reason } });
      const updated = await tx.payment.update({ where: { id: payment.id }, data: { status: nextStatus } });
      if (payment.bookingId && nextStatus === "REFUNDED") {
        await tx.booking.update({ where: { id: payment.bookingId }, data: { status: "REFUNDED" } });
        await tx.bookingAccessPass.updateMany({ where: { bookingId: payment.bookingId, status: "ACTIVE" }, data: { status: "REVOKED" } });
      }
      if (nextStatus === "REFUNDED") {
        if (payment.membershipId) await tx.membership.update({ where: { id: payment.membershipId }, data: { status: "CANCELLED", endDate: new Date() } });
        if (payment.packagePurchaseId) await tx.packagePurchase.update({ where: { id: payment.packagePurchaseId }, data: { status: "CANCELLED" } });
        if (payment.openPlayParticipantId) await tx.openPlayParticipant.update({ where: { id: payment.openPlayParticipantId }, data: { status: "CANCELLED" } });
        if (payment.leagueEntryId) await tx.leagueEntry.update({ where: { id: payment.leagueEntryId }, data: { status: "WITHDRAWN" } });
        if (payment.coachingSessionId) await tx.coachingSession.update({ where: { id: payment.coachingSessionId }, data: { status: "CANCELLED" } });
        if (payment.walletTopUp) await tx.walletTopUp.update({ where: { id: payment.walletTopUp.id }, data: { status: "REFUNDED" } });
      }
      await tx.notification.create({ data: { userId: payment.customer.userId, customerId: payment.customerId, type: "PAYMENT", title: nextStatus === "REFUNDED" ? "Payment refunded" : "Payment partially refunded", message: `A refund of ₱${input.amount.toLocaleString("en-PH", { minimumFractionDigits: 2 })} was recorded.`, actionUrl: "/app/payments", channel: "IN_APP" } });
      await tx.auditLog.create({ data: { userId: req.auth!.userId, action: "PAYMENT_REFUNDED", entity: "Payment", entityId: payment.id, metadata: { amount: input.amount, reason: input.reason } } });
      return { refund, payment: updated };
    });
    res.status(201).json({ success: true, data: { refund: { ...result.refund, amount: Number(result.refund.amount) }, payment: { ...result.payment, finalAmount: Number(result.payment.finalAmount) } } });
  } catch (error) { next(error); }
});
