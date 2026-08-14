import { createHash, randomBytes, randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { authenticate, authorize, requireVerifiedEmail } from "../middleware/auth.js";
import { createBooking, getManilaDate, getRules } from "../services/booking.js";
import { customerForUser, runAutomationCampaign, updateLocalLeagueRatings } from "../services/growth.js";
import { sendTransactionalEmail } from "../services/email.js";
import { config } from "../config.js";
import { AppError } from "../utils/errors.js";
import { calculateBookingTotals } from "../utils/bookingRules.js";
import { selectPricingRule } from "../utils/growthRules.js";
import { evaluatePromotionForBooking } from "../utils/promotionRules.js";

export const growthRouter = Router();
const operations = ["SUPER_ADMIN", "ADMIN", "STAFF"] as const;
const admins = ["SUPER_ADMIN", "ADMIN"] as const;
const paymentMethods = ["CASH", "BANK_TRANSFER", "GCASH", "CARD", "ONLINE_PAYMENT"] as const;
const activeOpenPlayStatuses = ["OPEN", "FILLED", "CONFIRMED"] as const;
const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
const number = (value: unknown) => Number(value);
const openPlayInclude = { court: true, participants: { where: { status: { not: "CANCELLED" as const } }, include: { customer: { include: { user: { select: { firstName: true, lastName: true } } } } }, orderBy: { createdAt: "asc" as const } } };
const leagueInclude = { entries: { where: { status: { not: "WITHDRAWN" as const } }, include: { customer: { include: { user: { select: { firstName: true, lastName: true } } } } }, orderBy: [{ points: "desc" as const }, { wins: "desc" as const }] }, matches: { orderBy: { scheduledAt: "asc" as const } } };
type OpenPlayPayload = Prisma.OpenPlayGetPayload<{ include: typeof openPlayInclude }>;
type LeaguePayload = Prisma.LeagueGetPayload<{ include: typeof leagueInclude }>;

function serializeOpenPlay(openPlay: OpenPlayPayload) {
  return { ...openPlay, skillMin: number(openPlay.skillMin), skillMax: number(openPlay.skillMax), pricePerPlayer: number(openPlay.pricePerPlayer), startsAt: openPlay.startsAt.toISOString(), endsAt: openPlay.endsAt.toISOString(), participants: openPlay.participants.map((participant) => ({ ...participant, amount: number(participant.amount), paidAt: participant.paidAt?.toISOString() ?? null, customer: { ...participant.customer, skillRating: number(participant.customer.skillRating) } })) };
}

function serializeLeague(league: LeaguePayload) {
  return { ...league, skillMin: number(league.skillMin), skillMax: number(league.skillMax), entryFee: number(league.entryFee), startsAt: league.startsAt.toISOString(), endsAt: league.endsAt.toISOString(), entries: league.entries.map((entry) => ({ ...entry, customer: { ...entry.customer, skillRating: number(entry.customer.skillRating) } })), matches: league.matches.map((match) => ({ ...match, scheduledAt: match.scheduledAt.toISOString() })) };
}

growthRouter.get("/open-plays", async (_req, res, next) => {
  try {
    const openPlays = await prisma.openPlay.findMany({ where: { status: { in: [...activeOpenPlayStatuses] }, endsAt: { gt: new Date() } }, include: openPlayInclude, orderBy: { startsAt: "asc" }, take: 100 });
    res.json({ success: true, data: { openPlays: openPlays.map(serializeOpenPlay) } });
  } catch (error) { next(error); }
});

growthRouter.get("/leagues", async (_req, res, next) => {
  try {
    const leagues = await prisma.league.findMany({ where: { status: { in: ["REGISTRATION_OPEN", "ACTIVE", "COMPLETED"] } }, include: leagueInclude, orderBy: { startsAt: "desc" }, take: 100 });
    res.json({ success: true, data: { leagues: leagues.map(serializeLeague) } });
  } catch (error) { next(error); }
});

growthRouter.get("/packages", async (_req, res, next) => {
  try { const packages = await prisma.packagePlan.findMany({ where: { isActive: true }, orderBy: { price: "asc" } }); res.json({ success: true, data: { packages: packages.map((plan) => ({ ...plan, price: number(plan.price) })) } }); } catch (error) { next(error); }
});

const guestLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 5, standardHeaders: "draft-8", legacyHeaders: false, message: { success: false, message: "Too many guest verification attempts. Please wait 15 minutes.", errors: {} } });
growthRouter.post("/guest/request-code", guestLimiter, async (req, res, next) => {
  try {
    const input = z.object({ email: z.string().trim().toLowerCase().email(), firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80), phone: z.string().trim().min(6).max(30), source: z.string().trim().max(50).default("PUBLIC_BOOKING") }).parse(req.body);
    const code = String(randomInt(100000, 1_000_000));
    const lead = await prisma.guestLead.create({ data: { ...input, verificationCodeHash: tokenHash(code), verificationExpiresAt: new Date(Date.now() + 10 * 60_000) } });
    await sendTransactionalEmail({ to: input.email, subject: "Your Rally guest booking code", text: `Your guest booking code is ${code}. It expires in 10 minutes.`, html: `<p>Your Rally guest booking code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes.</p>` });
    res.status(201).json({ success: true, data: { leadId: lead.id, message: "Verification code sent. Check your email to continue." } });
  } catch (error) { next(error); }
});

growthRouter.get("/guest/pricing/quote", async (req, res, next) => {
  try {
    const input = z.object({
      courtId: z.string().min(1),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
      durationMinutes: z.coerce.number().int().min(30).max(360),
      promoCode: z.string().trim().toUpperCase().min(3).max(30).optional()
    }).parse(req.query);
    const startsAt = getManilaDate(input.date, input.startTime);
    const [court, rules] = await Promise.all([prisma.court.findFirst({ where: { id: input.courtId, deletedAt: null, status: "AVAILABLE" } }), getRules(prisma as never)]);
    if (!court) throw new AppError(404, "Court not found or unavailable.");
    const weekday = new Date(`${input.date}T12:00:00+08:00`).getUTCDay();
    const leadHours = (startsAt.getTime() - Date.now()) / 3_600_000;
    const pricingRules = await prisma.dynamicPricingRule.findMany({ where: { isActive: true, OR: [{ courtId: null }, { courtId: input.courtId }], AND: [{ OR: [{ weekday: null }, { weekday }] }], startTime: { lte: input.startTime }, endTime: { gt: input.startTime } } });
    const pricingRule = selectPricingRule(pricingRules, leadHours);
    const adjustmentPercent = pricingRule ? number(pricingRule.adjustmentPercent) : 0;
    const effectiveHourlyRate = Math.max(0, number(court.hourlyRate) * (1 + adjustmentPercent / 100));
    const subtotal = effectiveHourlyRate * (input.durationMinutes / 60);
    const promotionRecord = input.promoCode ? await prisma.promotion.findUnique({ where: { code: input.promoCode } }) : null;
    const promotionEvaluation = input.promoCode ? evaluatePromotionForBooking(promotionRecord, { subtotal, courtId: input.courtId }) : null;
    if (promotionEvaluation && !promotionEvaluation.valid) throw new AppError(400, promotionEvaluation.message);
    const promotion = promotionEvaluation?.valid ? promotionEvaluation.promotion : null;
    const totals = calculateBookingTotals({ hourlyRate: effectiveHourlyRate, durationMinutes: input.durationMinutes, taxRate: rules.taxRate, promoDiscountPercent: promotion?.discountPercent ?? undefined, promoFixedDiscount: promotion?.fixedDiscount ?? undefined });
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, data: {
      currency: rules.currency,
      baseHourlyRate: number(court.hourlyRate),
      effectiveHourlyRate,
      pricingRule: pricingRule ? { id: pricingRule.id, name: pricingRule.name, adjustmentPercent } : null,
      subtotal: totals.subtotal,
      promotion: promotion ? { ...promotion, discount: totals.discount } : null,
      promotionDiscount: totals.discount,
      tax: totals.tax,
      total: totals.total
    } });
  } catch (error) { next(error); }
});

growthRouter.post("/guest/book", guestLimiter, async (req, res, next) => {
  try {
    const input = z.object({ leadId: z.string(), code: z.string().regex(/^\d{6}$/), courtId: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startTime: z.string().regex(/^\d{2}:\d{2}$/), durationMinutes: z.coerce.number().int(), promoCode: z.string().trim().toUpperCase().max(30).optional(), paymentMethod: z.enum(["BANK_TRANSFER", "GCASH", "CARD", "ONLINE_PAYMENT"]), transactionReference: z.string().trim().min(3).max(120), marketingConsent: z.boolean().default(false) }).parse(req.body);
    const lead = await prisma.guestLead.findUnique({ where: { id: input.leadId } });
    if (!lead || !lead.verificationCodeHash || lead.verificationCodeHash !== tokenHash(input.code) || !lead.verificationExpiresAt || lead.verificationExpiresAt <= new Date()) throw new AppError(400, "The guest verification code is invalid or expired.");
    let user = await prisma.user.findUnique({ where: { email: lead.email }, include: { customer: true } });
    let createdAccount = false;
    if (user && !user.customer) throw new AppError(409, "This email belongs to a staff account. Please sign in instead.");
    if (!user) {
      createdAccount = true;
      user = await prisma.user.create({ data: { email: lead.email, firstName: lead.firstName, lastName: lead.lastName, phone: lead.phone, emailVerifiedAt: new Date(), passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 12), roles: { create: { role: { connect: { code: "CUSTOMER" } } } }, customer: { create: { marketingConsent: input.marketingConsent } } }, include: { customer: true } });
    } else if (!user.emailVerifiedAt) user = await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() }, include: { customer: true } });
    const customer = user.customer!;
    await prisma.guestLead.update({ where: { id: lead.id }, data: { verifiedAt: new Date(), verificationCodeHash: null, verificationExpiresAt: null, convertedCustomerId: customer.id } });
    const booking = await createBooking({ customerId: customer.id, courtId: input.courtId, date: input.date, startTime: input.startTime, durationMinutes: input.durationMinutes, promoCode: input.promoCode, paymentMethod: input.paymentMethod, transactionReference: input.transactionReference });
    await prisma.guestLead.update({ where: { id: lead.id }, data: { bookingId: booking.id } });
    if (createdAccount) {
      const token = randomBytes(32).toString("hex");
      await prisma.user.update({ where: { id: user.id }, data: { passwordResetTokenHash: tokenHash(token), passwordResetExpiresAt: new Date(Date.now() + 24 * 60 * 60_000) } });
      const setupUrl = `${config.appUrl}/reset-password?token=${token}`;
      await sendTransactionalEmail({ to: user.email, subject: "Manage your Rally guest booking", text: `Your booking request ${booking.reference} was received. Set your password to manage it: ${setupUrl}`, html: `<p>Your booking request <strong>${booking.reference}</strong> was received.</p><p><a href="${setupUrl}">Set a password and manage your booking</a></p>` });
    }
    res.status(201).json({ success: true, data: { booking: { id: booking.id, reference: booking.reference, status: booking.status, total: booking.total }, accountCreated: createdAccount, message: "Guest booking request received. Staff will confirm the submitted payment." } });
  } catch (error) { next(error); }
});

growthRouter.use(authenticate);

growthRouter.get("/pricing/quote", async (req, res, next) => {
  try {
    const input = z.object({
      courtId: z.string().min(1),
      customerId: z.string().min(1).optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
      durationMinutes: z.coerce.number().int().min(30).max(360),
      promoCode: z.string().trim().toUpperCase().min(3).max(30).optional()
    }).parse(req.query);
    const isOperations = req.auth!.roles.some((role) => operations.includes(role as typeof operations[number]));
    const customer = isOperations && input.customerId
      ? await prisma.customer.findFirst({ where: { id: input.customerId, deletedAt: null } })
      : isOperations
        ? null
        : await customerForUser(req.auth!.userId);
    const startsAt = getManilaDate(input.date, input.startTime);
    const [court, rules] = await Promise.all([prisma.court.findFirst({ where: { id: input.courtId, deletedAt: null } }), getRules(prisma as never)]);
    if (!court) throw new AppError(404, "Court not found.");
    const weekday = new Date(`${input.date}T12:00:00+08:00`).getUTCDay();
    const leadHours = (startsAt.getTime() - Date.now()) / 3_600_000;
    const pricingRules = await prisma.dynamicPricingRule.findMany({ where: { isActive: true, OR: [{ courtId: null }, { courtId: input.courtId }], AND: [{ OR: [{ weekday: null }, { weekday }] }], startTime: { lte: input.startTime }, endTime: { gt: input.startTime } } });
    const pricingRule = selectPricingRule(pricingRules, leadHours);
    const adjustmentPercent = pricingRule ? number(pricingRule.adjustmentPercent) : 0;
    const effectiveHourlyRate = Math.max(0, number(court.hourlyRate) * (1 + adjustmentPercent / 100));
    const membership = customer ? await prisma.membership.findFirst({ where: { customerId: customer.id, status: "ACTIVE", startDate: { lte: startsAt }, endDate: { gte: startsAt } }, include: { plan: true }, orderBy: { endDate: "desc" } }) : null;
    const subtotal = effectiveHourlyRate * (input.durationMinutes / 60);
    const promotionRecord = input.promoCode ? await prisma.promotion.findUnique({ where: { code: input.promoCode } }) : null;
    const promotionEvaluation = input.promoCode ? evaluatePromotionForBooking(promotionRecord, { subtotal, courtId: input.courtId, membershipPlanId: membership?.planId }) : null;
    if (promotionEvaluation && !promotionEvaluation.valid) throw new AppError(400, promotionEvaluation.message);
    const promotion = promotionEvaluation?.valid ? promotionEvaluation.promotion : null;
    const membershipTotals = calculateBookingTotals({ hourlyRate: effectiveHourlyRate, durationMinutes: input.durationMinutes, taxRate: 0, membershipDiscountPercent: membership ? number(membership.plan.discountPercent) : undefined });
    const totals = calculateBookingTotals({ hourlyRate: effectiveHourlyRate, durationMinutes: input.durationMinutes, taxRate: rules.taxRate, membershipDiscountPercent: membership ? number(membership.plan.discountPercent) : undefined, promoDiscountPercent: promotion?.discountPercent ?? undefined, promoFixedDiscount: promotion?.fixedDiscount ?? undefined });
    const membershipDiscount = membershipTotals.discount;
    const promotionDiscount = Math.max(0, Math.round((totals.discount - membershipDiscount + Number.EPSILON) * 100) / 100);
    const packages = customer ? await prisma.packagePurchase.findMany({ where: { customerId: customer.id, status: "ACTIVE", creditsRemaining: { gt: 0 }, startsAt: { lte: startsAt }, expiresAt: { gte: startsAt } }, include: { packagePlan: true }, orderBy: { expiresAt: "asc" } }) : [];
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, data: {
      currency: rules.currency,
      baseHourlyRate: number(court.hourlyRate),
      effectiveHourlyRate,
      pricingRule: pricingRule ? { id: pricingRule.id, name: pricingRule.name, adjustmentPercent } : null,
      subtotal: totals.subtotal,
      membership: membership ? { id: membership.id, plan: { name: membership.plan.name, discountPercent: number(membership.plan.discountPercent) } } : null,
      membershipDiscount,
      promotion: promotion ? { ...promotion, discount: promotionDiscount } : null,
      promotionDiscount,
      discount: totals.discount,
      tax: totals.tax,
      total: totals.total,
      walletBalance: customer ? number(customer.walletBalance) : 0,
      packages: packages.map((purchase) => ({ id: purchase.id, creditsRemaining: purchase.creditsRemaining, expiresAt: purchase.expiresAt.toISOString(), packagePlan: { id: purchase.packagePlan.id, name: purchase.packagePlan.name } }))
    } });
  } catch (error) { next(error); }
});

growthRouter.get("/me", async (req, res, next) => {
  try {
    const customer = await customerForUser(req.auth!.userId);
    const [waitlist, participations, walletTransactions, topUps, packagePurchases, leagueEntries] = await Promise.all([
      prisma.courtWaitlistEntry.findMany({ where: { customerId: customer.id }, include: { court: true, claimedBooking: { select: { reference: true } } }, orderBy: { createdAt: "desc" } }),
      prisma.openPlayParticipant.findMany({ where: { customerId: customer.id }, include: { openPlay: { include: openPlayInclude }, payment: true }, orderBy: { createdAt: "desc" } }),
      prisma.walletTransaction.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.walletTopUp.findMany({ where: { customerId: customer.id }, include: { payment: true }, orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.packagePurchase.findMany({ where: { customerId: customer.id }, include: { packagePlan: true, payments: true }, orderBy: { createdAt: "desc" } }),
      prisma.leagueEntry.findMany({ where: { customerId: customer.id }, include: { league: true }, orderBy: { createdAt: "desc" } })
    ]);
    res.json({ success: true, data: { profile: { skillRating: number(customer.skillRating), duprId: customer.duprId, walletBalance: number(customer.walletBalance), marketingConsent: customer.marketingConsent }, waitlist, participations: participations.map((item) => ({ ...item, amount: number(item.amount), openPlay: serializeOpenPlay(item.openPlay), payment: item.payment ? { ...item.payment, finalAmount: number(item.payment.finalAmount) } : null })), walletTransactions: walletTransactions.map((item) => ({ ...item, amount: number(item.amount), balanceAfter: number(item.balanceAfter) })), topUps: topUps.map((item) => ({ ...item, amount: number(item.amount), payment: { ...item.payment, finalAmount: number(item.payment.finalAmount) } })), packagePurchases: packagePurchases.map((item) => ({ ...item, packagePlan: { ...item.packagePlan, price: number(item.packagePlan.price) }, payments: item.payments.map((payment) => ({ ...payment, finalAmount: number(payment.finalAmount) })) })), leagueEntries: leagueEntries.map((entry) => ({ ...entry, league: serializeLeague({ ...entry.league, entries: [], matches: [] }) })) } });
  } catch (error) { next(error); }
});

growthRouter.patch("/profile", requireVerifiedEmail, async (req, res, next) => {
  try { const customer = await customerForUser(req.auth!.userId); const input = z.object({ skillRating: z.coerce.number().min(1).max(8).optional(), duprId: z.string().trim().max(60).nullable().optional(), marketingConsent: z.boolean().optional(), dateOfBirth: z.coerce.date().nullable().optional() }).parse(req.body); const updated = await prisma.customer.update({ where: { id: customer.id }, data: input }); res.json({ success: true, data: { profile: { ...updated, skillRating: number(updated.skillRating), walletBalance: number(updated.walletBalance) } } }); } catch (error) { next(error); }
});

growthRouter.post("/waitlist", requireVerifiedEmail, async (req, res, next) => {
  try {
    const customer = await customerForUser(req.auth!.userId); const input = z.object({ courtId: z.string(), startsAt: z.coerce.date(), durationMinutes: z.coerce.number().int().min(30).max(360) }).parse(req.body); const endsAt = new Date(input.startsAt.getTime() + input.durationMinutes * 60_000);
    const conflict = await prisma.booking.findFirst({ where: { courtId: input.courtId, status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] }, startsAt: { lt: endsAt }, endsAt: { gt: input.startsAt } } });
    if (!conflict) throw new AppError(409, "This time is currently available. Book it directly instead of joining a waitlist.");
    const entry = await prisma.courtWaitlistEntry.upsert({ where: { customerId_courtId_startsAt_durationMinutes: { customerId: customer.id, courtId: input.courtId, startsAt: input.startsAt, durationMinutes: input.durationMinutes } }, update: { status: "WAITING", offeredAt: null, offerExpiresAt: null }, create: { customerId: customer.id, ...input } });
    res.status(201).json({ success: true, data: { entry } });
  } catch (error) { next(error); }
});

growthRouter.post("/waitlist/:id/cancel", requireVerifiedEmail, async (req, res, next) => {
  try { const customer = await customerForUser(req.auth!.userId); const updated = await prisma.courtWaitlistEntry.updateMany({ where: { id: String(req.params.id), customerId: customer.id, status: { in: ["WAITING", "OFFERED"] } }, data: { status: "CANCELLED" } }); if (!updated.count) throw new AppError(409, "This waitlist entry can no longer be cancelled."); res.json({ success: true, data: { cancelled: true } }); } catch (error) { next(error); }
});

growthRouter.post("/waitlist/:id/claim", requireVerifiedEmail, async (req, res, next) => {
  try {
    const customer = await customerForUser(req.auth!.userId); const input = z.object({ paymentMethod: z.enum(paymentMethods), transactionReference: z.string().trim().max(120).optional() }).parse(req.body); const entry = await prisma.courtWaitlistEntry.findFirst({ where: { id: String(req.params.id), customerId: customer.id }, include: { court: true } });
    if (!entry || entry.status !== "OFFERED" || !entry.offerExpiresAt || entry.offerExpiresAt <= new Date()) throw new AppError(409, "This waitlist offer has expired or is no longer available.");
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }); const parts = formatter.formatToParts(entry.startsAt); const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ""; const date = `${part("year")}-${part("month")}-${part("day")}`; const startTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: false }).format(entry.startsAt);
    const booking = await createBooking({ customerId: customer.id, courtId: entry.courtId, date, startTime, durationMinutes: entry.durationMinutes, paymentMethod: input.paymentMethod, transactionReference: input.transactionReference });
    await prisma.courtWaitlistEntry.update({ where: { id: entry.id }, data: { status: "CLAIMED", claimedBookingId: booking.id } });
    res.status(201).json({ success: true, data: { booking: { id: booking.id, reference: booking.reference } } });
  } catch (error) { next(error); }
});

growthRouter.post("/open-plays/:id/join", requireVerifiedEmail, async (req, res, next) => {
  try {
    const customer = await customerForUser(req.auth!.userId); const input = z.object({ paymentMethod: z.enum(paymentMethods), transactionReference: z.string().trim().max(120).optional() }).parse(req.body);
    const participant = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`openplay:${String(req.params.id)}`}))`;
      const openPlay = await tx.openPlay.findUnique({ where: { id: String(req.params.id) }, include: { participants: { where: { status: { not: "CANCELLED" } } } } });
      if (!openPlay || openPlay.status !== "OPEN" || openPlay.startsAt <= new Date()) throw new AppError(409, "This open play is not accepting players.");
      const rating = number(customer.skillRating); if (rating < number(openPlay.skillMin) || rating > number(openPlay.skillMax)) throw new AppError(400, `This match accepts ratings ${number(openPlay.skillMin).toFixed(1)}–${number(openPlay.skillMax).toFixed(1)}.`);
      if (openPlay.participants.length >= openPlay.capacity) throw new AppError(409, "This open play is full.");
      const created = await tx.openPlayParticipant.create({ data: { openPlayId: openPlay.id, customerId: customer.id, paymentMethod: input.paymentMethod, transactionReference: input.transactionReference, amount: openPlay.pricePerPlayer } });
      await tx.payment.create({ data: { customerId: customer.id, openPlayParticipantId: created.id, amount: openPlay.pricePerPlayer, finalAmount: openPlay.pricePerPlayer, method: input.paymentMethod, transactionReference: input.transactionReference, status: "PENDING" } });
      if (openPlay.participants.length + 1 >= openPlay.capacity) await tx.openPlay.update({ where: { id: openPlay.id }, data: { status: "FILLED" } });
      await tx.notification.create({ data: { userId: customer.userId, customerId: customer.id, type: "PAYMENT", title: "Open play spot requested", message: `${openPlay.title} is awaiting payment confirmation.`, actionUrl: "/app/growth", channel: "IN_APP" } });
      return created;
    });
    res.status(201).json({ success: true, data: { participant: { ...participant, amount: number(participant.amount) } } });
  } catch (error) { next(error); }
});

growthRouter.post("/open-plays/:id/leave", requireVerifiedEmail, async (req, res, next) => {
  try { const customer = await customerForUser(req.auth!.userId); const participant = await prisma.openPlayParticipant.findFirst({ where: { openPlayId: String(req.params.id), customerId: customer.id, status: { in: ["JOINED", "PAID"] } } }); if (!participant) throw new AppError(404, "Open play participation not found."); if (participant.status === "PAID") throw new AppError(409, "Contact the club to leave after payment has been confirmed."); await prisma.$transaction([prisma.openPlayParticipant.update({ where: { id: participant.id }, data: { status: "CANCELLED" } }), prisma.payment.updateMany({ where: { openPlayParticipantId: participant.id, status: "PENDING" }, data: { status: "FAILED" } }), prisma.openPlay.updateMany({ where: { id: participant.openPlayId, status: "FILLED" }, data: { status: "OPEN" } })]); res.json({ success: true, data: { cancelled: true } }); } catch (error) { next(error); }
});

growthRouter.post("/wallet/top-up", requireVerifiedEmail, async (req, res, next) => {
  try { const customer = await customerForUser(req.auth!.userId); const input = z.object({ amount: z.coerce.number().min(100).max(100000), paymentMethod: z.enum(paymentMethods), transactionReference: z.string().trim().max(120).optional() }).parse(req.body); const topUp = await prisma.$transaction(async (tx) => { const payment = await tx.payment.create({ data: { customerId: customer.id, amount: input.amount, finalAmount: input.amount, method: input.paymentMethod, transactionReference: input.transactionReference, status: "PENDING" } }); return tx.walletTopUp.create({ data: { customerId: customer.id, paymentId: payment.id, amount: input.amount }, include: { payment: true } }); }); res.status(201).json({ success: true, data: { topUp: { ...topUp, amount: number(topUp.amount) } } }); } catch (error) { next(error); }
});

growthRouter.post("/packages/:id/purchase", requireVerifiedEmail, async (req, res, next) => {
  try { const customer = await customerForUser(req.auth!.userId); const input = z.object({ paymentMethod: z.enum(paymentMethods), transactionReference: z.string().trim().max(120).optional() }).parse(req.body); const plan = await prisma.packagePlan.findFirst({ where: { id: String(req.params.id), isActive: true } }); if (!plan) throw new AppError(404, "Package is not available."); const purchase = await prisma.packagePurchase.create({ data: { customerId: customer.id, packagePlanId: plan.id, creditsRemaining: plan.bookingCredits, startsAt: new Date(), expiresAt: new Date(Date.now() + plan.validityDays * 86_400_000), payments: { create: { customerId: customer.id, amount: plan.price, finalAmount: plan.price, method: input.paymentMethod, transactionReference: input.transactionReference, status: "PENDING" } } }, include: { packagePlan: true, payments: true } }); res.status(201).json({ success: true, data: { purchase: { ...purchase, packagePlan: { ...purchase.packagePlan, price: number(purchase.packagePlan.price) } } } }); } catch (error) { next(error); }
});

growthRouter.post("/leagues/:id/join", requireVerifiedEmail, async (req, res, next) => {
  try {
    const customer = await customerForUser(req.auth!.userId);
    const input = z.object({ paymentMethod: z.enum(paymentMethods).optional(), transactionReference: z.string().trim().max(120).optional() }).parse(req.body ?? {});
    const leagueId = String(req.params.id);
    const entry = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`league:${leagueId}`}))`;
      const league = await tx.league.findUnique({ where: { id: leagueId }, include: { entries: { where: { status: { not: "WITHDRAWN" } } } } });
      if (!league || league.status !== "REGISTRATION_OPEN") throw new AppError(409, "League registration is closed.");
      if (league.entries.some((current) => current.customerId === customer.id)) throw new AppError(409, "You are already registered for this league.");
      const rating = number(customer.skillRating);
      if (rating < number(league.skillMin) || rating > number(league.skillMax)) throw new AppError(400, "Your current skill rating is outside this league division.");
      if (league.maxPlayers && league.entries.length >= league.maxPlayers) throw new AppError(409, "This league is full.");
      const entryFee = number(league.entryFee);
      if (entryFee > 0 && !input.paymentMethod) throw new AppError(400, "Choose a payment method for the league entry fee.");
      const created = await tx.leagueEntry.create({ data: { leagueId: league.id, customerId: customer.id, status: entryFee === 0 ? "ACTIVE" : "PENDING" } });
      if (entryFee > 0) await tx.payment.create({ data: { customerId: customer.id, leagueEntryId: created.id, amount: league.entryFee, finalAmount: league.entryFee, method: input.paymentMethod!, transactionReference: input.transactionReference, status: "PENDING" } });
      return { created, entryFee };
    });
    res.status(201).json({ success: true, data: { entry: entry.created, message: entry.entryFee === 0 ? "League registration confirmed." : "Registration received. Staff will confirm your submitted entry-fee payment." } });
  } catch (error) { next(error); }
});

growthRouter.post("/access/:token/use", requireVerifiedEmail, async (req, res, next) => {
  try {
    const token = String(req.params.token);
    const pass = await prisma.bookingAccessPass.findUnique({ where: { token }, include: { booking: { include: { customer: true } } } });
    if (!pass) throw new AppError(404, "Access pass not recognized.");
    const isOperations = req.auth!.roles.some((role) => operations.includes(role as typeof operations[number]));
    if (!isOperations && pass.booking.customer.userId !== req.auth!.userId) throw new AppError(403, "This access pass belongs to another customer.");
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`access-pass:${pass.id}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pass.bookingId}))`;
      const current = await tx.bookingAccessPass.findUnique({ where: { id: pass.id }, include: { booking: { include: { payments: true } } } });
      if (!current) throw new AppError(404, "Access pass not recognized.");
      const now = new Date();
      if (current.status !== "ACTIVE") throw new AppError(409, "This access pass has already been used or revoked.");
      if (now < current.validFrom || now > current.validUntil) throw new AppError(409, "This access pass is outside its valid time window.");
      const paymentRequired = current.booking.payments.length > 0;
      if ((paymentRequired && !current.booking.payments.some((payment) => payment.status === "PAID")) || current.booking.status !== "CONFIRMED") throw new AppError(409, "This booking is not paid and confirmed.");
      const existingCheckIn = await tx.bookingCheckIn.findUnique({ where: { bookingId: current.bookingId } });
      if (existingCheckIn) throw new AppError(409, "This booking has already been checked in.");
      await tx.bookingAccessPass.update({ where: { id: current.id }, data: { status: "USED", usedAt: now, usedById: req.auth!.userId } });
      await tx.bookingCheckIn.create({ data: { bookingId: current.bookingId, checkedById: req.auth!.userId } });
      await tx.booking.update({ where: { id: current.bookingId }, data: { status: "CHECKED_IN" } });
      await tx.auditLog.create({ data: { userId: req.auth!.userId, action: "ACCESS_PASS_USED", entity: "Booking", entityId: current.bookingId } });
    });
    res.json({ success: true, data: { message: "Access granted. Booking checked in successfully." } });
  } catch (error) { next(error); }
});

growthRouter.get("/manage", authorize(...operations), async (_req, res, next) => {
  try { const [waitlist, openPlays, packages, pricingRules, leagues, campaigns] = await Promise.all([prisma.courtWaitlistEntry.findMany({ include: { customer: { include: { user: true } }, court: true }, orderBy: { createdAt: "desc" }, take: 100 }), prisma.openPlay.findMany({ include: openPlayInclude, orderBy: { startsAt: "desc" }, take: 100 }), prisma.packagePlan.findMany({ orderBy: { createdAt: "desc" } }), prisma.dynamicPricingRule.findMany({ include: { court: true }, orderBy: { createdAt: "desc" } }), prisma.league.findMany({ include: leagueInclude, orderBy: { startsAt: "desc" } }), prisma.automationCampaign.findMany({ include: { runs: { orderBy: { createdAt: "desc" }, take: 5 } }, orderBy: { createdAt: "desc" } })]); res.json({ success: true, data: { waitlist, openPlays: openPlays.map(serializeOpenPlay), packages: packages.map((plan) => ({ ...plan, price: number(plan.price) })), pricingRules: pricingRules.map((rule) => ({ ...rule, adjustmentPercent: number(rule.adjustmentPercent) })), leagues: leagues.map(serializeLeague), campaigns } }); } catch (error) { next(error); }
});

growthRouter.get("/insights", authorize(...admins), async (_req, res, next) => {
  try {
    const now = new Date(); const from = new Date(now.getTime() - 30 * 86_400_000); const soon = new Date(now.getTime() + 14 * 86_400_000);
    const [courts, waitlistRecovered, waitlistWaiting, openPlays, dormantCustomers, expiringMemberships, guestLeads, walletLiability] = await Promise.all([
      prisma.court.findMany({ where: { deletedAt: null }, include: { bookings: { where: { startsAt: { gte: from, lte: now }, status: { in: ["CONFIRMED", "CHECKED_IN", "COMPLETED"] } }, select: { startsAt: true, endsAt: true } } } }),
      prisma.courtWaitlistEntry.findMany({ where: { status: "CLAIMED", updatedAt: { gte: from } }, include: { claimedBooking: { select: { total: true } } } }),
      prisma.courtWaitlistEntry.count({ where: { status: { in: ["WAITING", "OFFERED"] } } }),
      prisma.openPlay.findMany({ where: { startsAt: { gte: from } }, include: { participants: { where: { status: "PAID" } } } }),
      prisma.customer.count({ where: { deletedAt: null, OR: [{ lastActivityAt: { lte: from } }, { lastActivityAt: null, createdAt: { lte: from } }] } }),
      prisma.membership.count({ where: { status: "ACTIVE", endDate: { gte: now, lte: soon } } }),
      prisma.guestLead.count({ where: { createdAt: { gte: from } } }),
      prisma.customer.aggregate({ where: { deletedAt: null }, _sum: { walletBalance: true } })
    ]);
    const utilization = courts.map((court) => { const bookedHours = court.bookings.reduce((sum, booking) => sum + (booking.endsAt.getTime() - booking.startsAt.getTime()) / 3_600_000, 0); const [openH, openM] = court.openingTime.split(":").map(Number); const [closeH, closeM] = court.closingTime.split(":").map(Number); const availableHours = Math.max(1, ((closeH * 60 + closeM) - (openH * 60 + openM)) / 60 * 30); return { courtId: court.id, court: court.name, bookedHours, availableHours, utilizationPercent: Math.round(bookedHours / availableHours * 1000) / 10 }; });
    const recommendations = utilization.filter((court) => court.utilizationPercent < 40).map((court) => ({ type: "OFF_PEAK_PRICING", title: `Increase ${court.court} utilization`, message: `${court.court} used ${court.utilizationPercent}% of available hours in the last 30 days. Consider an off-peak pricing rule.`, actionUrl: "/app/growth" }));
    if (dormantCustomers) recommendations.push({ type: "WIN_BACK", title: "Re-engage inactive players", message: `${dormantCustomers} customers have not played in 30 days. Run a win-back automation.`, actionUrl: "/app/growth" });
    res.json({ success: true, data: { metrics: { waitlistRecoveredRevenue: waitlistRecovered.reduce((sum, entry) => sum + number(entry.claimedBooking?.total ?? 0), 0), waitlistWaiting, openPlayRevenue: openPlays.reduce((sum, play) => sum + play.participants.length * number(play.pricePerPlayer), 0), dormantCustomers, expiringMemberships, guestLeads, walletLiability: number(walletLiability._sum.walletBalance ?? 0) }, utilization, recommendations } });
  } catch (error) { next(error); }
});

growthRouter.post("/open-plays", authorize(...operations), async (req, res, next) => {
  try { const input = z.object({ courtId: z.string(), title: z.string().trim().min(3).max(100), startsAt: z.coerce.date(), endsAt: z.coerce.date(), skillMin: z.coerce.number().min(1).max(8), skillMax: z.coerce.number().min(1).max(8), capacity: z.coerce.number().int().min(2).max(16), pricePerPlayer: z.coerce.number().nonnegative(), competitive: z.boolean().default(false), notes: z.string().trim().max(500).optional() }).parse(req.body); if (input.endsAt <= input.startsAt || input.skillMax < input.skillMin) throw new AppError(400, "Check the event time and skill range."); const openPlay = await prisma.$transaction(async (tx) => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.courtId}))`; const bookingConflict = await tx.booking.findFirst({ where: { courtId: input.courtId, status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] }, startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt } } }); const playConflict = await tx.openPlay.findFirst({ where: { courtId: input.courtId, status: { in: [...activeOpenPlayStatuses] }, startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt } } }); if (bookingConflict || playConflict) throw new AppError(409, "The selected court already has an overlapping booking or open play."); return tx.openPlay.create({ data: { ...input, createdById: req.auth!.userId }, include: openPlayInclude }); }); res.status(201).json({ success: true, data: { openPlay: serializeOpenPlay(openPlay) } }); } catch (error) { next(error); }
});

growthRouter.post("/open-play-participants/:id/confirm", authorize(...operations), async (req, res, next) => {
  try {
    const participantId = String(req.params.id);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`open-play-participant:${participantId}`}))`;
      const participant = await tx.openPlayParticipant.findUnique({ where: { id: participantId }, include: { payment: true, openPlay: true, customer: true } });
      if (!participant || !participant.payment) throw new AppError(404, "Participant payment not found.");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment:${participant.payment.id}`}))`;
      if (participant.status !== "JOINED" || participant.payment.status !== "PENDING") throw new AppError(409, "Only pending participant payments can be confirmed.");
      if (["COMPLETED", "CANCELLED"].includes(participant.openPlay.status)) throw new AppError(409, "This open-play session is no longer accepting payment confirmations.");
      const paidAt = new Date();
      await tx.payment.update({ where: { id: participant.payment.id }, data: { status: "PAID", paidAt, recordedById: req.auth!.userId } });
      await tx.openPlayParticipant.update({ where: { id: participant.id }, data: { status: "PAID", paidAt } });
      const paid = await tx.openPlayParticipant.count({ where: { openPlayId: participant.openPlayId, status: "PAID" } });
      if (paid >= participant.openPlay.capacity) await tx.openPlay.update({ where: { id: participant.openPlayId }, data: { status: "CONFIRMED" } });
      await tx.notification.create({ data: { userId: participant.customer.userId, customerId: participant.customerId, type: "PAYMENT", title: "Open play spot confirmed", message: `${participant.openPlay.title} is confirmed for you.`, actionUrl: "/app/growth" } });
      await tx.auditLog.create({ data: { userId: req.auth!.userId, action: "OPEN_PLAY_PAYMENT_CONFIRMED", entity: "OpenPlayParticipant", entityId: participant.id, metadata: { paymentId: participant.payment.id } } });
    });
    res.json({ success: true, data: { confirmed: true } });
  } catch (error) { next(error); }
});

growthRouter.post("/wallet/adjust", authorize(...operations), async (req, res, next) => {
  try { const input = z.object({ customerId: z.string(), amount: z.coerce.number().refine((value) => value !== 0 && Math.abs(value) <= 100000), description: z.string().trim().min(3).max(200) }).parse(req.body); const result = await prisma.$transaction(async (tx) => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet:${input.customerId}`}))`; const customer = await tx.customer.findUnique({ where: { id: input.customerId } }); if (!customer) throw new AppError(404, "Customer not found."); const balance = number(customer.walletBalance) + input.amount; if (balance < 0) throw new AppError(400, "Wallet balance cannot become negative."); await tx.customer.update({ where: { id: customer.id }, data: { walletBalance: balance } }); return tx.walletTransaction.create({ data: { customerId: customer.id, type: input.amount > 0 ? "ADJUSTMENT" : "DEBIT", amount: Math.abs(input.amount), balanceAfter: balance, description: input.description } }); }); res.status(201).json({ success: true, data: { transaction: { ...result, amount: number(result.amount), balanceAfter: number(result.balanceAfter) } } }); } catch (error) { next(error); }
});

growthRouter.post("/packages", authorize(...admins), async (req, res, next) => {
  try { const input = z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(500).optional(), price: z.coerce.number().nonnegative(), bookingCredits: z.coerce.number().int().positive(), validityDays: z.coerce.number().int().positive() }).parse(req.body); const plan = await prisma.packagePlan.create({ data: input }); res.status(201).json({ success: true, data: { plan: { ...plan, price: number(plan.price) } } }); } catch (error) { next(error); }
});

growthRouter.post("/pricing-rules", authorize(...admins), async (req, res, next) => {
  try { const input = z.object({ name: z.string().trim().min(2).max(80), courtId: z.string().nullable().optional(), weekday: z.coerce.number().int().min(0).max(6).nullable().optional(), startTime: z.string().regex(/^\d{2}:\d{2}$/), endTime: z.string().regex(/^\d{2}:\d{2}$/), adjustmentPercent: z.coerce.number().min(-90).max(300), minimumLeadHours: z.coerce.number().int().nonnegative().nullable().optional(), maximumLeadHours: z.coerce.number().int().nonnegative().nullable().optional() }).parse(req.body); if (input.endTime <= input.startTime) throw new AppError(400, "Pricing rule end time must be after start time."); const rule = await prisma.dynamicPricingRule.create({ data: input, include: { court: true } }); res.status(201).json({ success: true, data: { rule: { ...rule, adjustmentPercent: number(rule.adjustmentPercent) } } }); } catch (error) { next(error); }
});

growthRouter.patch("/pricing-rules/:id", authorize(...admins), async (req, res, next) => {
  try { const input = z.object({ isActive: z.boolean() }).parse(req.body); const rule = await prisma.dynamicPricingRule.update({ where: { id: String(req.params.id) }, data: input }); res.json({ success: true, data: { rule: { ...rule, adjustmentPercent: number(rule.adjustmentPercent) } } }); } catch (error) { next(error); }
});

growthRouter.post("/leagues", authorize(...admins), async (req, res, next) => {
  try { const input = z.object({ name: z.string().trim().min(3).max(100), description: z.string().trim().max(800).optional(), skillMin: z.coerce.number().min(1).max(8), skillMax: z.coerce.number().min(1).max(8), startsAt: z.coerce.date(), endsAt: z.coerce.date(), maxPlayers: z.coerce.number().int().positive().nullable().optional(), entryFee: z.coerce.number().nonnegative(), status: z.enum(["DRAFT", "REGISTRATION_OPEN", "ACTIVE", "COMPLETED", "CANCELLED"]).default("DRAFT") }).parse(req.body); if (input.endsAt <= input.startsAt || input.skillMax < input.skillMin) throw new AppError(400, "Check the league dates and skill range."); const league = await prisma.league.create({ data: input }); res.status(201).json({ success: true, data: { league: serializeLeague({ ...league, entries: [], matches: [] }) } }); } catch (error) { next(error); }
});

growthRouter.post("/league-entries/:id/confirm", authorize(...operations), async (req, res, next) => {
  try { const existing = await prisma.leagueEntry.findUnique({ where: { id: String(req.params.id) }, include: { league: true, payment: true } }); if (!existing) throw new AppError(404, "League entry not found."); if (number(existing.league.entryFee) > 0 && existing.payment?.status !== "PAID") throw new AppError(409, "Confirm the league entry payment from the Payments page first."); const entry = await prisma.leagueEntry.update({ where: { id: existing.id }, data: { status: "ACTIVE" } }); res.json({ success: true, data: { entry } }); } catch (error) { next(error); }
});

growthRouter.post("/leagues/:id/matches", authorize(...admins), async (req, res, next) => {
  try { const input = z.object({ homeEntryId: z.string(), awayEntryId: z.string(), scheduledAt: z.coerce.date() }).parse(req.body); if (input.homeEntryId === input.awayEntryId) throw new AppError(400, "Choose two different players."); const entries = await prisma.leagueEntry.count({ where: { id: { in: [input.homeEntryId, input.awayEntryId] }, leagueId: String(req.params.id), status: "ACTIVE" } }); if (entries !== 2) throw new AppError(400, "Both players must be active entries in this league."); const match = await prisma.leagueMatch.create({ data: { leagueId: String(req.params.id), ...input } }); res.status(201).json({ success: true, data: { match } }); } catch (error) { next(error); }
});

growthRouter.post("/league-matches/:id/result", authorize(...operations), async (req, res, next) => {
  try { const input = z.object({ homeScore: z.coerce.number().int().nonnegative(), awayScore: z.coerce.number().int().nonnegative() }).refine((value) => value.homeScore !== value.awayScore, "League matches cannot end tied.").parse(req.body); const match = await prisma.leagueMatch.findUnique({ where: { id: String(req.params.id) }, include: { homeEntry: true, awayEntry: true } }); if (!match || match.status !== "SCHEDULED") throw new AppError(409, "This match cannot accept a result."); const homeWon = input.homeScore > input.awayScore; const winnerEntryId = homeWon ? match.homeEntryId : match.awayEntryId; await prisma.$transaction(async (tx) => { await tx.leagueMatch.update({ where: { id: match.id }, data: { ...input, winnerEntryId, status: "COMPLETED", ratingSyncedAt: new Date() } }); await tx.leagueEntry.update({ where: { id: winnerEntryId }, data: { wins: { increment: 1 }, points: { increment: 3 } } }); await tx.leagueEntry.update({ where: { id: homeWon ? match.awayEntryId : match.homeEntryId }, data: { losses: { increment: 1 } } }); const ratings = await updateLocalLeagueRatings(tx, match.homeEntry.customerId, match.awayEntry.customerId, homeWon); await tx.auditLog.create({ data: { userId: req.auth!.userId, action: "LEAGUE_RESULT_RECORDED", entity: "LeagueMatch", entityId: match.id, metadata: { ...input, ratings, provider: "LOCAL_DUPR_READY" } } }); }); res.json({ success: true, data: { completed: true, ratingProvider: "LOCAL", duprSync: "READY_FOR_PROVIDER_CONFIGURATION" } }); } catch (error) { next(error); }
});

growthRouter.post("/campaigns", authorize(...admins), async (req, res, next) => {
  try { const input = z.object({ name: z.string().trim().min(3).max(100), kind: z.enum(["WIN_BACK", "MEMBERSHIP_EXPIRY", "BIRTHDAY", "PROMOTION"]), subject: z.string().trim().min(3).max(120), message: z.string().trim().min(3).max(500), actionUrl: z.string().trim().max(200).optional(), triggerDays: z.coerce.number().int().min(0).max(365) }).parse(req.body); const campaign = await prisma.automationCampaign.create({ data: { ...input, createdById: req.auth!.userId } }); res.status(201).json({ success: true, data: { campaign } }); } catch (error) { next(error); }
});

growthRouter.patch("/campaigns/:id", authorize(...admins), async (req, res, next) => {
  try { const input = z.object({ status: z.enum(["ACTIVE", "PAUSED"]) }).parse(req.body); const campaign = await prisma.automationCampaign.update({ where: { id: String(req.params.id) }, data: input }); res.json({ success: true, data: { campaign } }); } catch (error) { next(error); }
});

growthRouter.post("/campaigns/:id/run", authorize(...admins), async (req, res, next) => {
  try { const result = await runAutomationCampaign(String(req.params.id), req.auth!.userId, true); res.json({ success: true, data: result }); } catch (error) { next(error); }
});
