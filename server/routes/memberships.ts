import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { AppError } from "../utils/errors.js";

export const membershipsRouter = Router();

function serializePlan(plan: { id: string; name: string; description: string | null; price: unknown; durationDays: number; discountPercent: unknown; maximumBookings: number | null; bookingPrivileges: unknown; isActive: boolean }) { return { ...plan, price: Number(plan.price), discountPercent: Number(plan.discountPercent), benefits: Array.isArray(plan.bookingPrivileges) ? plan.bookingPrivileges.filter((value): value is string => typeof value === "string") : [] }; }
function serializeMembership(membership: { id: string; startDate: Date; endDate: Date; status: string; plan: { id: string; name: string; price: unknown; discountPercent: unknown; durationDays: number; maximumBookings: number | null; bookingPrivileges: unknown } }) { return { ...membership, startDate: membership.startDate.toISOString(), endDate: membership.endDate.toISOString(), plan: { ...membership.plan, price: Number(membership.plan.price), discountPercent: Number(membership.plan.discountPercent), benefits: Array.isArray(membership.plan.bookingPrivileges) ? membership.plan.bookingPrivileges.filter((value): value is string => typeof value === "string") : [] } }; }

membershipsRouter.get("/plans", async (_req, res, next) => { try { const plans = await prisma.membershipPlan.findMany({ where: { isActive: true }, orderBy: { price: "asc" } }); res.json({ success: true, data: { plans: plans.map(serializePlan) } }); } catch (error) { next(error); } });

membershipsRouter.use(authenticate);

membershipsRouter.get("/me", async (req, res, next) => { try { const customer = await prisma.customer.findUnique({ where: { userId: req.auth!.userId } }); if (!customer) throw new AppError(403, "Customer profile not found."); const memberships = await prisma.membership.findMany({ where: { customerId: customer.id }, include: { plan: true }, orderBy: { endDate: "desc" } }); res.json({ success: true, data: { memberships: memberships.map(serializeMembership) } }); } catch (error) { next(error); } });

membershipsRouter.post("/purchase", async (req, res, next) => {
  try {
    const input = z.object({ planId: z.string(), paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "GCASH", "CARD", "ONLINE_PAYMENT"]).default("CASH") }).parse(req.body);
    const customer = await prisma.customer.findUnique({ where: { userId: req.auth!.userId } }); const plan = await prisma.membershipPlan.findUnique({ where: { id: input.planId } }); if (!customer || !plan || !plan.isActive) throw new AppError(404, "Membership plan is not available.");
    const membership = await prisma.$transaction(async (tx) => { const created = await tx.membership.create({ data: { customerId: customer.id, planId: plan.id, startDate: new Date(), endDate: new Date(Date.now() + plan.durationDays * 86_400_000), status: "PENDING", payments: { create: { customerId: customer.id, amount: plan.price, finalAmount: plan.price, method: input.paymentMethod, status: "PENDING" } } }, include: { plan: true } }); await tx.notification.create({ data: { userId: req.auth!.userId, customerId: customer.id, type: "MEMBERSHIP", title: "Membership purchase pending", message: `${plan.name} membership is awaiting payment confirmation.`, channel: "IN_APP" } }); return created; });
    res.status(201).json({ success: true, data: { membership: serializeMembership(membership) } });
  } catch (error) { next(error); }
});

membershipsRouter.get("/", authorize("SUPER_ADMIN", "ADMIN"), async (_req, res, next) => { try { const plans = await prisma.membershipPlan.findMany({ orderBy: { price: "asc" } }); res.json({ success: true, data: { plans: plans.map(serializePlan) } }); } catch (error) { next(error); } });
membershipsRouter.post("/", authorize("SUPER_ADMIN", "ADMIN"), async (req, res, next) => { try { const input = z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(500).optional(), price: z.coerce.number().nonnegative(), durationDays: z.coerce.number().int().positive(), discountPercent: z.coerce.number().min(0).max(100), maximumBookings: z.coerce.number().int().positive().optional(), benefits: z.array(z.string().trim().min(1).max(120)).max(20).default([]) }).parse(req.body); const { benefits, ...data } = input; const plan = await prisma.membershipPlan.create({ data: { ...data, bookingPrivileges: benefits } }); res.status(201).json({ success: true, data: { plan: serializePlan(plan) } }); } catch (error) { next(error); } });
membershipsRouter.put("/:id", authorize("SUPER_ADMIN", "ADMIN"), async (req, res, next) => { try { const input = z.object({ name: z.string().trim().min(2).max(80).optional(), description: z.string().trim().max(500).optional(), price: z.coerce.number().nonnegative().optional(), durationDays: z.coerce.number().int().positive().optional(), discountPercent: z.coerce.number().min(0).max(100).optional(), maximumBookings: z.coerce.number().int().positive().nullable().optional(), benefits: z.array(z.string().trim().min(1).max(120)).max(20).optional(), isActive: z.boolean().optional() }).parse(req.body); const { benefits, ...data } = input; const plan = await prisma.membershipPlan.update({ where: { id: String(req.params.id) }, data: { ...data, ...(benefits !== undefined ? { bookingPrivileges: benefits } : {}) } }); res.json({ success: true, data: { plan: serializePlan(plan) } }); } catch (error) { next(error); } });
