import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../db.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { AppError } from "../utils/errors.js";
import { BusinessLogoValidationError, validateBusinessLogo } from "../utils/imageValidation.js";
import { getManilaDate } from "../services/booking.js";
import { manilaDateKey } from "../utils/calendarRules.js";

export const adminRouter = Router();
adminRouter.use(authenticate);

adminRouter.get("/dashboard", authorize("SUPER_ADMIN", "ADMIN", "STAFF"), async (req, res, next) => {
  try {
    const now = new Date();
    const start = getManilaDate(manilaDateKey(now), "00:00");
    const end = new Date(start.getTime() + 86_400_000);
    const [bookings, revenue, customers, courts, cancelled, recentBookings, recentCustomers] = await Promise.all([
      prisma.booking.count({ where: { startsAt: { gte: start, lt: end }, status: { not: "CANCELLED" } } }),
      prisma.payment.aggregate({ where: { status: "PAID", paidAt: { gte: start, lt: end } }, _sum: { finalAmount: true } }),
      prisma.customer.count({ where: { deletedAt: null, user: { status: "ACTIVE" } } }),
      prisma.court.findMany({ where: { deletedAt: null }, select: { id: true, name: true, status: true, bookings: { where: { startsAt: { lte: now }, endsAt: { gt: now }, status: { in: ["CONFIRMED", "CHECKED_IN"] } }, select: { id: true } } } }),
      prisma.booking.count({ where: { startsAt: { gte: start, lt: end }, status: "CANCELLED" } }),
      prisma.booking.findMany({ take: 6, orderBy: { createdAt: "desc" }, include: { court: { select: { name: true } }, customer: { include: { user: { select: { firstName: true, lastName: true } } } } } }),
      prisma.customer.findMany({ where: { deletedAt: null, user: { status: "ACTIVE" } }, take: 5, orderBy: { createdAt: "desc" }, include: { user: { select: { firstName: true, lastName: true, email: true } } } })
    ]);
    res.json({ success: true, data: { stats: { bookings, revenue: Number(revenue._sum.finalAmount ?? 0), customers, availableCourts: courts.filter((court) => court.status === "AVAILABLE" && court.bookings.length === 0).length, occupiedCourts: courts.filter((court) => court.bookings.length > 0).length, cancelled }, courts: courts.map(({ bookings: occupiedBookings, ...court }) => ({ ...court, occupied: occupiedBookings.length > 0 })), recentBookings: recentBookings.map((booking) => ({ id: booking.id, reference: booking.reference, status: booking.status, total: Number(booking.total), startsAt: booking.startsAt.toISOString(), court: booking.court, customer: booking.customer ? { firstName: booking.customer.user.firstName, lastName: booking.customer.user.lastName } : null })), recentCustomers: recentCustomers.map((customer) => ({ id: customer.id, name: `${customer.user.firstName} ${customer.user.lastName}`, email: customer.user.email, createdAt: customer.createdAt.toISOString() })) } });
  } catch (error) { next(error); }
});

adminRouter.use(authorize("SUPER_ADMIN", "ADMIN"));

adminRouter.get("/users", async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({ include: { roles: { include: { role: true } }, customer: true, staff: true, coach: true }, orderBy: { createdAt: "desc" }, take: 200 });
    res.json({ success: true, data: { users: users.map((user) => ({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, phone: user.phone, status: user.status, createdAt: user.createdAt.toISOString(), roles: user.roles.map(({ role }) => role.code), profile: user.customer ? "CUSTOMER" : user.staff ? "STAFF" : user.coach ? "COACH" : null })) } });
  } catch (error) { next(error); }
});

adminRouter.post("/users", async (req, res, next) => {
  try {
    const input = z.object({ email: z.string().trim().toLowerCase().email(), firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80), phone: z.string().trim().max(30).optional(), password: z.string().min(8).max(128), role: z.enum(["SUPER_ADMIN", "ADMIN", "STAFF", "COACH", "CUSTOMER"]) }).parse(req.body);
    if (input.role === "SUPER_ADMIN" && !req.auth!.roles.includes("SUPER_ADMIN")) throw new AppError(403, "Only a Super Admin can create another Super Admin.");
    if (await prisma.user.findUnique({ where: { email: input.email } })) throw new AppError(409, "An account with this email already exists.");
    const role = await prisma.role.findUnique({ where: { code: input.role } });
    if (!role) throw new AppError(500, "The selected role is not configured.");
    const user = await prisma.user.create({ data: { email: input.email, firstName: input.firstName, lastName: input.lastName, phone: input.phone, passwordHash: await bcrypt.hash(input.password, 12), roles: { create: { roleId: role.id } }, ...(input.role === "CUSTOMER" ? { customer: { create: {} } } : {}), ...(input.role === "STAFF" ? { staff: { create: {} } } : {}), ...(input.role === "COACH" ? { coach: { create: { hourlyRate: 0 } } } : {}) } });
    await prisma.auditLog.create({ data: { userId: req.auth!.userId, action: "USER_CREATED", entity: "User", entityId: user.id, metadata: { role: input.role } } });
    res.status(201).json({ success: true, data: { user: { id: user.id, email: user.email, status: user.status } } });
  } catch (error) { next(error); }
});

adminRouter.patch("/users/:id", async (req, res, next) => {
  try {
    const input = z.object({ status: z.enum(["ACTIVE", "INVITED", "SUSPENDED", "DEACTIVATED"]).optional(), roles: z.array(z.enum(["SUPER_ADMIN", "ADMIN", "STAFF", "COACH", "CUSTOMER"])).min(1).optional() }).parse(req.body);
    const targetId = String(req.params.id); const target = await prisma.user.findUnique({ where: { id: targetId }, include: { roles: { include: { role: true } } } });
    if (!target) throw new AppError(404, "User not found.");
    const targetHasSuperAdmin = target.roles.some(({ role }) => role.code === "SUPER_ADMIN"); const requesterIsSuperAdmin = req.auth!.roles.includes("SUPER_ADMIN");
    if (targetHasSuperAdmin && !requesterIsSuperAdmin) throw new AppError(403, "Only a Super Admin can modify a Super Admin account.");
    if (input.roles?.includes("SUPER_ADMIN") && !requesterIsSuperAdmin) throw new AppError(403, "Only a Super Admin can assign the Super Admin role.");
    if (targetId === req.auth!.userId && input.status && input.status !== "ACTIVE") throw new AppError(400, "You cannot suspend or deactivate your own account.");
    const removesSuperAdmin = Boolean(input.roles && !input.roles.includes("SUPER_ADMIN"));
    const disablesSuperAdmin = Boolean(input.status && input.status !== "ACTIVE");
    if (targetHasSuperAdmin && target.status === "ACTIVE" && (removesSuperAdmin || disablesSuperAdmin)) {
      const otherActiveSuperAdmins = await prisma.user.count({ where: { id: { not: targetId }, status: "ACTIVE", roles: { some: { role: { code: "SUPER_ADMIN" } } } } });
      if (otherActiveSuperAdmins === 0) throw new AppError(409, "Create another active Super Admin before removing access from the last Super Admin account.");
    }
    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id: targetId }, data: { status: input.status } });
      if (input.roles) {
        const roles = await tx.role.findMany({ where: { code: { in: input.roles } } });
        await tx.userRole.deleteMany({ where: { userId: targetId } });
        await tx.userRole.createMany({ data: roles.map((role) => ({ userId: targetId, roleId: role.id })) });
        if (input.roles.includes("CUSTOMER")) await tx.customer.upsert({ where: { userId: targetId }, update: { deletedAt: null }, create: { userId: targetId } });
        if (input.roles.includes("STAFF")) await tx.staff.upsert({ where: { userId: targetId }, update: {}, create: { userId: targetId } });
        if (input.roles.includes("COACH")) await tx.coach.upsert({ where: { userId: targetId }, update: {}, create: { userId: targetId, hourlyRate: 0 } });
      }
      await tx.auditLog.create({ data: { userId: req.auth!.userId, action: "USER_PERMISSIONS_UPDATED", entity: "User", entityId: targetId, metadata: { status: input.status, roles: input.roles } } });
      return user;
    });
    res.json({ success: true, data: { user: { id: updated.id, email: updated.email, status: updated.status } } });
  } catch (error) { next(error); }
});

adminRouter.get("/settings", async (_req, res, next) => { try { const settings = await prisma.businessSetting.findMany({ orderBy: { key: "asc" } }); res.json({ success: true, data: { settings } }); } catch (error) { next(error); } });
adminRouter.put("/settings/:key", async (req, res, next) => { try { const input = z.object({ value: z.unknown() }).parse(req.body); const key = String(req.params.key); const numericRules: Record<string, { min: number; max: number }> = { tax_rate: { min: 0, max: 1 }, minimum_booking_minutes: { min: 30, max: 1440 }, maximum_booking_minutes: { min: 30, max: 1440 }, minimum_advance_minutes: { min: 0, max: 10080 }, maximum_advance_days: { min: 1, max: 365 }, cancellation_hours: { min: 0, max: 168 }, refund_window_hours: { min: 0, max: 168 } }; const rule = numericRules[key]; const value = rule ? (() => { const numeric = Number(input.value); if (!Number.isFinite(numeric) || numeric < rule.min || numeric > rule.max) throw new AppError(400, `${key.replaceAll("_", " ")} must be between ${rule.min} and ${rule.max}.`); return numeric; })() : key === "business_name" ? z.string().trim().min(2, "Business name is required.").max(120, "Business name must be 120 characters or fewer.").parse(input.value) : key === "business_logo" ? (() => { try { return validateBusinessLogo(input.value); } catch (error) { if (error instanceof BusinessLogoValidationError) throw new AppError(400, error.message); throw error; } })() : input.value as Prisma.InputJsonValue; const setting = await prisma.businessSetting.upsert({ where: { key }, update: { value: value as Prisma.InputJsonValue }, create: { key, value: value as Prisma.InputJsonValue } }); await prisma.auditLog.create({ data: { userId: req.auth!.userId, action: "SETTING_UPDATED", entity: "BusinessSetting", entityId: setting.id, metadata: { key: setting.key } } }); res.json({ success: true, data: { setting } }); } catch (error) { next(error); } });

adminRouter.get("/audit-logs", async (req, res, next) => { try { const logs = await prisma.auditLog.findMany({ include: { user: { select: { firstName: true, lastName: true, email: true } } }, orderBy: { createdAt: "desc" }, take: Math.min(Number(req.query.limit) || 100, 250) }); res.json({ success: true, data: { logs: logs.map((log) => ({ ...log, createdAt: log.createdAt.toISOString() })) } }); } catch (error) { next(error); } });
