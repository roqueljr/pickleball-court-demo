import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { AppError } from "../utils/errors.js";

export const customersRouter = Router();
customersRouter.use(authenticate, authorize("SUPER_ADMIN", "ADMIN", "STAFF"));

const customerInput = z.object({ firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80), email: z.string().trim().toLowerCase().email(), phone: z.string().trim().max(30).optional(), address: z.string().trim().max(250).optional(), notes: z.string().trim().max(1000).optional(), password: z.string().min(8).max(128).optional() });

function serializeCustomer(customer: { id: string; address: string | null; notes: string | null; deletedAt: Date | null; createdAt: Date; user: { id: string; email: string; firstName: string; lastName: string; phone: string | null; status: string }; memberships: { id: string; status: string; startDate: Date; endDate: Date; plan: { name: string; discountPercent: unknown } }[]; _count: { bookings: number; payments: number } }) {
  const currentMembership = customer.memberships.find((membership) => membership.status === "ACTIVE" && membership.endDate >= new Date());
  return { id: customer.id, firstName: customer.user.firstName, lastName: customer.user.lastName, email: customer.user.email, phone: customer.user.phone, address: customer.address, notes: customer.notes, status: customer.deletedAt || customer.user.status !== "ACTIVE" ? "INACTIVE" : "ACTIVE", registeredAt: customer.createdAt.toISOString(), membership: currentMembership ? { ...currentMembership, discountPercent: Number(currentMembership.plan.discountPercent), startDate: currentMembership.startDate.toISOString(), endDate: currentMembership.endDate.toISOString() } : null, bookingsCount: customer._count.bookings, paymentsCount: customer._count.payments };
}

const includeCustomer = { user: { select: { id: true, email: true, firstName: true, lastName: true, phone: true, status: true } }, memberships: { include: { plan: { select: { name: true, discountPercent: true } } }, orderBy: { endDate: "desc" as const }, take: 5 }, _count: { select: { bookings: true, payments: true } } };

customersRouter.get("/", async (req, res, next) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const customers = await prisma.customer.findMany({ where: { ...(req.query.includeInactive === "true" ? {} : { deletedAt: null }), ...(search ? { OR: [{ user: { firstName: { contains: search, mode: "insensitive" } } }, { user: { lastName: { contains: search, mode: "insensitive" } } }, { user: { email: { contains: search, mode: "insensitive" } } }, { user: { phone: { contains: search } } }] } : {}) }, include: includeCustomer, orderBy: { createdAt: "desc" }, take: 100 });
    res.json({ success: true, data: { customers: customers.map(serializeCustomer) } });
  } catch (error) { next(error); }
});

customersRouter.post("/", async (req, res, next) => {
  try {
    const input = customerInput.extend({ password: z.string().min(8).max(128) }).parse(req.body); const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new AppError(409, "An account with this email already exists.");
    const role = await prisma.role.findUnique({ where: { code: "CUSTOMER" } }); if (!role) throw new AppError(500, "Customer role is not configured.");
    const passwordHash = await bcrypt.hash(input.password, 12);
    const customer = await prisma.customer.create({ data: { address: input.address, notes: input.notes, user: { create: { email: input.email, firstName: input.firstName, lastName: input.lastName, phone: input.phone, passwordHash, roles: { create: { roleId: role.id } } } } , }, include: includeCustomer });
    await prisma.auditLog.create({ data: { userId: req.auth!.userId, action: "CUSTOMER_CREATED", entity: "Customer", entityId: customer.id } });
    res.status(201).json({ success: true, data: { customer: serializeCustomer(customer) } });
  } catch (error) { next(error); }
});

customersRouter.put("/:id", async (req, res, next) => {
  try {
    const input = customerInput.partial().parse(req.body); const customer = await prisma.customer.findUnique({ where: { id: String(req.params.id) } }); if (!customer) throw new AppError(404, "Customer not found.");
    const updated = await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: customer.userId }, data: { ...(input.firstName !== undefined ? { firstName: input.firstName } : {}), ...(input.lastName !== undefined ? { lastName: input.lastName } : {}), ...(input.email !== undefined ? { email: input.email } : {}), ...(input.phone !== undefined ? { phone: input.phone } : {}), ...(input.password ? { passwordHash: await bcrypt.hash(input.password, 12) } : {}) } });
      return tx.customer.update({ where: { id: customer.id }, data: { ...(input.address !== undefined ? { address: input.address } : {}), ...(input.notes !== undefined ? { notes: input.notes } : {}) }, include: includeCustomer });
    });
    await prisma.auditLog.create({ data: { userId: req.auth!.userId, action: "CUSTOMER_UPDATED", entity: "Customer", entityId: customer.id } });
    res.json({ success: true, data: { customer: serializeCustomer(updated) } });
  } catch (error) { next(error); }
});

customersRouter.delete("/:id", authorize("SUPER_ADMIN", "ADMIN"), async (req, res, next) => {
  try {
    const customer = await prisma.customer.findUnique({ where: { id: String(req.params.id) } }); if (!customer) throw new AppError(404, "Customer not found.");
    await prisma.$transaction([prisma.customer.update({ where: { id: customer.id }, data: { deletedAt: new Date() } }), prisma.user.update({ where: { id: customer.userId }, data: { status: "DEACTIVATED" } }), prisma.auditLog.create({ data: { userId: req.auth!.userId, action: "CUSTOMER_DEACTIVATED", entity: "Customer", entityId: customer.id } })]);
    res.json({ success: true, data: { customerId: customer.id } });
  } catch (error) { next(error); }
});
