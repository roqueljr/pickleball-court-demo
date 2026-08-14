import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, authorize, requireVerifiedEmail } from "../middleware/auth.js";
import { AppError } from "../utils/errors.js";
import { getRules } from "../services/booking.js";

export const coachingRouter = Router();
coachingRouter.get("/coaches", async (_req, res, next) => { try { const coaches = await prisma.coach.findMany({ where: { status: "ACTIVE" }, include: { user: { select: { firstName: true, lastName: true, email: true } } }, orderBy: { createdAt: "asc" } }); res.json({ success: true, data: { coaches: coaches.map((coach) => ({ ...coach, hourlyRate: Number(coach.hourlyRate) })) } }); } catch (error) { next(error); } });
coachingRouter.use(authenticate);
coachingRouter.get("/manage", authorize("SUPER_ADMIN", "ADMIN"), async (_req, res, next) => { try { const coaches = await prisma.coach.findMany({ include: { user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true } } }, orderBy: { createdAt: "desc" } }); res.json({ success: true, data: { coaches: coaches.map((coach) => ({ ...coach, hourlyRate: Number(coach.hourlyRate) })) } }); } catch (error) { next(error); } });
coachingRouter.post("/manage", authorize("SUPER_ADMIN", "ADMIN"), async (req, res, next) => { try { const input = z.object({ userId: z.string(), biography: z.string().trim().max(1000).optional(), experience: z.string().trim().max(250).optional(), certifications: z.string().trim().max(500).optional(), hourlyRate: z.coerce.number().nonnegative(), status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE") }).parse(req.body); const coach = await prisma.coach.create({ data: input, include: { user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true } } } }); res.status(201).json({ success: true, data: { coach: { ...coach, hourlyRate: Number(coach.hourlyRate) } } }); } catch (error) { next(error); } });
coachingRouter.patch("/manage/:id", authorize("SUPER_ADMIN", "ADMIN"), async (req, res, next) => { try { const input = z.object({ biography: z.string().trim().max(1000).optional(), experience: z.string().trim().max(250).optional(), certifications: z.string().trim().max(500).optional(), hourlyRate: z.coerce.number().nonnegative().optional(), status: z.enum(["ACTIVE", "INACTIVE"]).optional() }).parse(req.body); const coach = await prisma.coach.update({ where: { id: String(req.params.id) }, data: input, include: { user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true } } } }); res.json({ success: true, data: { coach: { ...coach, hourlyRate: Number(coach.hourlyRate) } } }); } catch (error) { next(error); } });
coachingRouter.get("/sessions", async (req, res, next) => { try { const isOperations = req.auth!.roles.some((role) => ["SUPER_ADMIN", "ADMIN", "STAFF", "COACH"].includes(role)); const coach = req.auth!.roles.includes("COACH") ? await prisma.coach.findUnique({ where: { userId: req.auth!.userId } }) : null; const customer = !isOperations ? await prisma.customer.findUnique({ where: { userId: req.auth!.userId } }) : null; const sessions = await prisma.coachingSession.findMany({ where: { ...(coach ? { coachId: coach.id } : {}), ...(customer ? { customerId: customer.id } : {}), ...(typeof req.query.from === "string" ? { startsAt: { gte: new Date(req.query.from) } } : {}) }, include: { coach: { include: { user: { select: { firstName: true, lastName: true } } } }, customer: { include: { user: { select: { firstName: true, lastName: true, email: true } } } }, court: true }, orderBy: { startsAt: "asc" }, take: 100 }); res.json({ success: true, data: { sessions: sessions.map((session) => ({ ...session, rate: Number(session.rate), startsAt: session.startsAt.toISOString(), endsAt: session.endsAt.toISOString() })) } }); } catch (error) { next(error); } });
coachingRouter.post("/sessions", requireVerifiedEmail, async (req, res, next) => {
  try {
    const input = z.object({
      coachId: z.string(),
      courtId: z.string().optional(),
      startsAt: z.coerce.date(),
      endsAt: z.coerce.date(),
      paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "GCASH", "CARD", "ONLINE_PAYMENT"]),
      transactionReference: z.string().trim().max(120).optional(),
      notes: z.string().trim().max(1000).optional()
    }).parse(req.body);
    const customer = await prisma.customer.findUnique({ where: { userId: req.auth!.userId } });
    if (!customer) throw new AppError(403, "Customer profile not found.");
    const durationMinutes = (input.endsAt.getTime() - input.startsAt.getTime()) / 60_000;
    if (input.startsAt <= new Date() || durationMinutes < 30 || durationMinutes > 240 || !Number.isInteger(durationMinutes) || durationMinutes % 30 !== 0) {
      throw new AppError(400, "Choose a future coaching session lasting 30 minutes to 4 hours, in 30-minute increments.");
    }
    const session = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`coach:${input.coachId}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-session:${customer.id}`}))`;
      if (input.courtId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.courtId}))`;
      const coach = await tx.coach.findUnique({ where: { id: input.coachId } });
      if (!coach || coach.status !== "ACTIVE") throw new AppError(404, "Coach is not available.");
      const conflict = await tx.coachingSession.findFirst({
        where: {
          status: { in: ["PENDING", "CONFIRMED"] },
          startsAt: { lt: input.endsAt },
          endsAt: { gt: input.startsAt },
          OR: [{ coachId: coach.id }, { customerId: customer.id }, ...(input.courtId ? [{ courtId: input.courtId }] : [])]
        }
      });
      if (conflict) throw new AppError(409, "The coach, customer, or selected court already has an overlapping session.");
      if (input.courtId) {
        const court = await tx.court.findUnique({ where: { id: input.courtId } });
        if (!court || court.deletedAt || court.status !== "AVAILABLE") throw new AppError(409, "The selected court is not available.");
        const [bookingConflict, openPlayConflict] = await Promise.all([
          tx.booking.findFirst({ where: { courtId: input.courtId, status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] }, startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt } } }),
          tx.openPlay.findFirst({ where: { courtId: input.courtId, status: { in: ["OPEN", "FILLED", "CONFIRMED"] }, startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt } } })
        ]);
        if (bookingConflict || openPlayConflict) throw new AppError(409, "The selected court is already reserved for this time.");
      }
      const rules = await getRules(tx);
      const amount = Math.round(Number(coach.hourlyRate) * durationMinutes / 60 * 100) / 100;
      const tax = Math.round(amount * rules.taxRate * 100) / 100;
      const created = await tx.coachingSession.create({
        data: {
          coachId: coach.id,
          customerId: customer.id,
          courtId: input.courtId,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          notes: input.notes,
          rate: coach.hourlyRate,
          status: "PENDING",
          payment: { create: { customerId: customer.id, amount, tax, finalAmount: amount + tax, method: input.paymentMethod, transactionReference: input.transactionReference, status: "PENDING" } }
        },
        include: { coach: { include: { user: { select: { firstName: true, lastName: true } } } }, court: true, payment: true }
      });
      await tx.notification.create({ data: { userId: customer.userId, customerId: customer.id, type: "PAYMENT", title: "Coaching request received", message: "Your coaching slot is reserved while staff verifies payment.", actionUrl: "/app/payments", channel: "IN_APP" } });
      await tx.auditLog.create({ data: { userId: req.auth!.userId, action: "COACHING_SESSION_REQUESTED", entity: "CoachingSession", entityId: created.id, metadata: { coachId: coach.id, paymentId: created.payment?.id } } });
      return created;
    }, { isolationLevel: "Serializable" });
    res.status(201).json({ success: true, data: { session: { ...session, rate: Number(session.rate) } } });
  } catch (error) { next(error); }
});
coachingRouter.patch("/sessions/:id", authorize("SUPER_ADMIN", "ADMIN", "STAFF", "COACH"), async (req, res, next) => {
  try {
    const input = z.object({ status: z.enum(["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"]).optional(), notes: z.string().trim().max(1000).optional() }).parse(req.body);
    if (input.status === undefined && input.notes === undefined) throw new AppError(400, "Provide a status or session notes to update.");
    const sessionId = String(req.params.id);
    const session = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`coaching-session:${sessionId}`}))`;
      const current = await tx.coachingSession.findUnique({ where: { id: sessionId }, include: { coach: true, customer: true, payment: true } });
      if (!current) throw new AppError(404, "Coaching session not found.");
      if (req.auth!.roles.includes("COACH") && current.coach.userId !== req.auth!.userId) throw new AppError(403, "You can only update your assigned coaching sessions.");
      if (input.status && input.status !== current.status) {
        const transitions: Record<string, string[]> = { PENDING: ["CONFIRMED", "CANCELLED"], CONFIRMED: ["COMPLETED", "CANCELLED", "NO_SHOW"], COMPLETED: [], CANCELLED: [], NO_SHOW: [] };
        if (!transitions[current.status]?.includes(input.status)) throw new AppError(409, `A ${current.status.toLowerCase()} session cannot be changed to ${input.status.toLowerCase()}.`);
        if (input.status === "CONFIRMED" && current.payment?.status !== "PAID") throw new AppError(409, "Confirm the coaching payment from the Payments page first.");
        if (input.status === "COMPLETED" && current.endsAt > new Date()) throw new AppError(400, "A coaching session can only be completed after its scheduled end time.");
        if (input.status === "NO_SHOW" && current.startsAt > new Date()) throw new AppError(400, "A coaching session can only be marked no-show after its scheduled start time.");
      }
      const updated = await tx.coachingSession.update({ where: { id: current.id }, data: input });
      if (input.status === "CANCELLED" && current.payment?.status === "PENDING") await tx.payment.update({ where: { id: current.payment.id }, data: { status: "FAILED" } });
      if (input.status && input.status !== current.status) {
        await tx.notification.create({ data: { userId: current.customer.userId, customerId: current.customerId, type: "BOOKING", title: "Coaching session updated", message: `Your coaching session is now ${input.status.toLowerCase().replaceAll("_", " ")}.`, actionUrl: "/app/coaching", channel: "IN_APP" } });
        await tx.auditLog.create({ data: { userId: req.auth!.userId, action: "COACHING_SESSION_STATUS_UPDATED", entity: "CoachingSession", entityId: current.id, metadata: { from: current.status, to: input.status } } });
      }
      return updated;
    });
    res.json({ success: true, data: { session: { ...session, rate: Number(session.rate) } } });
  } catch (error) { next(error); }
});
