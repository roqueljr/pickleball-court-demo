import { Router, type Response } from "express";
import rateLimit from "express-rate-limit";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { AppError } from "../utils/errors.js";
import { authenticate, signAccessToken, verifyAccessToken } from "../middleware/auth.js";
import { sendTransactionalEmail } from "../services/email.js";
import { clientIp } from "../utils/request.js";

export const authRouter = Router();

function sensitiveActionLimiter(limit: number, message: string, skipSuccessfulRequests = false) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: "draft-8" as const,
    legacyHeaders: false,
    skipSuccessfulRequests,
    message: { success: false, message, errors: {} }
  });
}

const loginLimiter = sensitiveActionLimiter(config.authLoginRateLimit, "Too many unsuccessful login attempts. Please wait 15 minutes and try again.", true);
const registrationLimiter = sensitiveActionLimiter(config.authRegistrationRateLimit, "Too many registration attempts. Please wait 15 minutes and try again.");
const emailActionLimiter = sensitiveActionLimiter(config.authEmailRateLimit, "Too many email requests. Please wait 15 minutes and try again.");
const tokenActionLimiter = sensitiveActionLimiter(30, "Too many token attempts. Please wait 15 minutes and try again.");

authRouter.use("/forgot-password", emailActionLimiter);
authRouter.use("/request-verification", emailActionLimiter);
authRouter.use("/reset-password", tokenActionLimiter);
authRouter.use("/verify-email", tokenActionLimiter);

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128)
});

const registerSchema = credentialsSchema.extend({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(30).optional()
});

function setAuthCookie(res: Response, token: string) {
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.nodeEnv === "production",
    maxAge: 15 * 60 * 1000,
    path: "/"
  });
}

function publicUser(user: { id: string; email: string; firstName: string; lastName: string; phone: string | null; emailVerifiedAt: Date | null; roles: { role: { code: string } }[] }) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    emailVerified: Boolean(user.emailVerifiedAt),
    roles: user.roles.map(({ role }) => role.code)
  };
}

authRouter.post("/register", registrationLimiter, async (req, res, next) => {
  try {
    const input = registerSchema.parse(req.body);
    const exists = await prisma.user.findUnique({ where: { email: input.email } });
    if (exists) throw new AppError(409, "An account with this email already exists.");
    const passwordHash = await bcrypt.hash(input.password, 12);
    const role = await prisma.role.findUnique({ where: { code: "CUSTOMER" } });
    if (!role) throw new AppError(500, "Customer role is not configured.");
    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        customer: { create: {} },
        roles: { create: { roleId: role.id } }
      },
      include: { roles: { include: { role: true } } }
    });
    const token = signAccessToken({ sub: user.id, email: user.email, roles: ["CUSTOMER"] });
    setAuthCookie(res, token);
    res.status(201).json({ success: true, data: { user: publicUser(user) } });
  } catch (error) { next(error); }
});

authRouter.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const input = credentialsSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email }, include: { roles: { include: { role: true } } } });
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) throw new AppError(401, "Invalid email or password.");
    if (user.status !== "ACTIVE") throw new AppError(403, "This account is not active.");
    const roles = user.roles.map(({ role }) => role.code as import("@prisma/client").RoleCode);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
      prisma.auditLog.create({ data: { userId: user.id, action: "LOGIN", entity: "User", entityId: user.id, ipAddress: clientIp(req) } })
    ]);
    const token = signAccessToken({ sub: user.id, email: user.email, roles });
    setAuthCookie(res, token);
    res.json({ success: true, data: { user: publicUser(user) } });
  } catch (error) { next(error); }
});

authRouter.post("/logout", async (req, res) => {
  const token = req.cookies?.[config.cookieName] as string | undefined;
  if (token) {
    try {
      const payload = verifyAccessToken(token);
      await prisma.auditLog.create({ data: { userId: payload.sub, action: "LOGOUT", entity: "User", entityId: payload.sub, ipAddress: clientIp(req) } });
    } catch (error) {
      // An expired/invalid session must not prevent the cookie from being cleared.
      if (config.nodeEnv === "development" && error instanceof Error) console.warn(`[logout audit] ${error.message}`);
    }
  }
  res.clearCookie(config.cookieName, { httpOnly: true, sameSite: "lax", secure: config.nodeEnv === "production", path: "/" });
  res.json({ success: true, data: null });
});

authRouter.get("/me", authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId }, include: { roles: { include: { role: true } } } });
    if (!user) throw new AppError(401, "User account not found.");
    res.json({ success: true, data: { user: publicUser(user) } });
  } catch (error) { next(error); }
});

function tokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }

authRouter.post("/forgot-password", async (req, res, next) => { try { const input = z.object({ email: z.string().trim().toLowerCase().email() }).parse(req.body); const user = await prisma.user.findUnique({ where: { email: input.email } }); if (user) { const token = randomBytes(32).toString("hex"); await prisma.user.update({ where: { id: user.id }, data: { passwordResetTokenHash: tokenHash(token), passwordResetExpiresAt: new Date(Date.now() + 30 * 60_000) } }); const resetUrl = `${config.appUrl}/reset-password?token=${token}`; await prisma.auditLog.create({ data: { userId: user.id, action: "PASSWORD_RESET_REQUESTED", entity: "User", entityId: user.id, ipAddress: clientIp(req) } }); let emailDeliveryWarning: string | undefined; try { await sendTransactionalEmail({ to: user.email, subject: "Reset your Rally Court Club password", text: `Reset your password using this link: ${resetUrl}`, html: `<p>Reset your Rally Court Club password.</p><p><a href="${resetUrl}">Reset password</a></p>` }); } catch (error) { if (config.nodeEnv === "production") throw error; emailDeliveryWarning = error instanceof Error ? error.message : "Email delivery failed."; console.warn(`[development email warning] ${emailDeliveryWarning}`); } if (config.nodeEnv !== "production") { res.json({ success: true, data: { message: emailDeliveryWarning ? "Reset instructions were generated, but the email could not be delivered. Check the server email configuration." : "Reset instructions have been sent. Check your email.", emailDeliveryWarning } }); } else res.json({ success: true, data: { message: "If an account exists, reset instructions have been sent." } }); return; } res.json({ success: true, data: { message: "If an account exists, reset instructions have been sent." } }); } catch (error) { next(error); } });

authRouter.post("/reset-password", async (req, res, next) => { try { const input = z.object({ token: z.string().min(20), password: z.string().min(8).max(128) }).parse(req.body); const user = await prisma.user.findFirst({ where: { passwordResetTokenHash: tokenHash(input.token), passwordResetExpiresAt: { gt: new Date() } } }); if (!user) throw new AppError(400, "This reset link is invalid or expired."); await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(input.password, 12), passwordResetTokenHash: null, passwordResetExpiresAt: null } }); await prisma.auditLog.create({ data: { userId: user.id, action: "PASSWORD_RESET_COMPLETED", entity: "User", entityId: user.id } }); res.json({ success: true, data: null }); } catch (error) { next(error); } });

authRouter.post("/request-verification", authenticate, async (req, res, next) => { try { const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } }); if (!user) throw new AppError(404, "User account not found."); if (user.emailVerifiedAt) { res.json({ success: true, data: { message: "Email is already verified." } }); return; } const token = randomBytes(32).toString("hex"); await prisma.user.update({ where: { id: user.id }, data: { emailVerificationTokenHash: tokenHash(token), emailVerificationExpiresAt: new Date(Date.now() + 24 * 60 * 60_000) } }); const verificationUrl = `${config.appUrl}/verify-email?token=${token}`; await prisma.auditLog.create({ data: { userId: user.id, action: "EMAIL_VERIFICATION_REQUESTED", entity: "User", entityId: user.id, ipAddress: clientIp(req) } }); let emailDeliveryWarning: string | undefined; try { await sendTransactionalEmail({ to: user.email, subject: "Verify your Rally Court Club email", text: `Verify your email using this link: ${verificationUrl}`, html: `<p>Verify your Rally Court Club email address.</p><p><a href="${verificationUrl}">Verify email</a></p>` }); } catch (error) { if (config.nodeEnv === "production") throw error; emailDeliveryWarning = error instanceof Error ? error.message : "Email delivery failed."; console.warn(`[development email warning] ${emailDeliveryWarning}`); } if (config.nodeEnv !== "production") { res.json({ success: true, data: { message: emailDeliveryWarning ? "Verification instructions were generated, but the email could not be delivered. Check the server email configuration." : "Verification instructions have been sent. Check your email.", emailDeliveryWarning } }); return; } res.json({ success: true, data: { message: "Verification instructions have been sent." } }); } catch (error) { next(error); } });
authRouter.post("/verify-email", async (req, res, next) => { try { const input = z.object({ token: z.string().min(20) }).parse(req.body); const user = await prisma.user.findFirst({ where: { emailVerificationTokenHash: tokenHash(input.token), emailVerificationExpiresAt: { gt: new Date() } } }); if (!user) throw new AppError(400, "This verification token is invalid or expired."); await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date(), emailVerificationTokenHash: null, emailVerificationExpiresAt: null } }); await prisma.auditLog.create({ data: { userId: user.id, action: "EMAIL_VERIFIED", entity: "User", entityId: user.id, ipAddress: clientIp(req) } }); res.json({ success: true, data: { message: "Email verified successfully." } }); } catch (error) { next(error); } });
