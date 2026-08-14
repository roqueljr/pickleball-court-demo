import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { AppError } from "../utils/errors.js";

export const profileRouter = Router();
profileRouter.use(authenticate);

profileRouter.get("/", async (req, res, next) => { try { const user = await prisma.user.findUnique({ where: { id: req.auth!.userId }, include: { customer: true } }); if (!user) throw new AppError(404, "User profile not found."); res.json({ success: true, data: { profile: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, phone: user.phone, address: user.customer?.address ?? null, notes: user.customer?.notes ?? null, emailVerified: Boolean(user.emailVerifiedAt) } } }); } catch (error) { next(error); } });

profileRouter.put("/", async (req, res, next) => { try { const input = z.object({ firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80), phone: z.string().trim().max(30).optional(), address: z.string().trim().max(250).optional() }).parse(req.body); const user = await prisma.$transaction(async (tx) => { await tx.user.update({ where: { id: req.auth!.userId }, data: { firstName: input.firstName, lastName: input.lastName, phone: input.phone } }); const customer = await tx.customer.findUnique({ where: { userId: req.auth!.userId } }); if (customer) await tx.customer.update({ where: { id: customer.id }, data: { address: input.address } }); return tx.user.findUniqueOrThrow({ where: { id: req.auth!.userId }, include: { customer: true } }); }); await prisma.auditLog.create({ data: { userId: req.auth!.userId, action: "PROFILE_UPDATED", entity: "User", entityId: user.id } }); res.json({ success: true, data: { profile: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, phone: user.phone, address: user.customer?.address ?? null } } }); } catch (error) { next(error); } });

profileRouter.post("/change-password", async (req, res, next) => { try { const input = z.object({ currentPassword: z.string().min(8), newPassword: z.string().min(8).max(128) }).parse(req.body); const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } }); if (!user || !(await bcrypt.compare(input.currentPassword, user.passwordHash))) throw new AppError(400, "Current password is incorrect."); const passwordHash = await bcrypt.hash(input.newPassword, 12); await prisma.user.update({ where: { id: user.id }, data: { passwordHash } }); await prisma.auditLog.create({ data: { userId: user.id, action: "PASSWORD_CHANGED", entity: "User", entityId: user.id } }); res.json({ success: true, data: null }); } catch (error) { next(error); } });
