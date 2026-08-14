import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { RoleCode } from "@prisma/client";
import { config } from "../config.js";
import { AppError } from "../utils/errors.js";
import { prisma } from "../db.js";

type Token = { sub: string; email: string; roles: RoleCode[] };

export function signAccessToken(payload: Token) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.accessTokenTtl });
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, config.jwtSecret) as Token;
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[config.cookieName] as string | undefined;
  if (!token) return next(new AppError(401, "Authentication required."));
  try {
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, email: true, status: true, roles: { select: { role: { select: { code: true } } } } } });
    if (!user || user.status !== "ACTIVE") return next(new AppError(401, "Your account is no longer active."));
    req.auth = { userId: user.id, email: user.email, roles: user.roles.map(({ role }) => role.code) };
    next();
  } catch {
    next(new AppError(401, "Your session has expired. Please sign in again."));
  }
}

export function authorize(...allowedRoles: RoleCode[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth || !req.auth.roles.some((role) => allowedRoles.includes(role))) {
      next(new AppError(403, "You do not have permission to perform this action."));
      return;
    }
    next();
  };
}

export async function requireVerifiedEmail(req: Request, _res: Response, next: NextFunction) {
  if (req.auth?.roles.some((role) => ["SUPER_ADMIN", "ADMIN", "STAFF", "COACH"].includes(role))) {
    next();
    return;
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId }, select: { emailVerifiedAt: true } });
    if (!user) return next(new AppError(401, "User account not found."));
    if (!user.emailVerifiedAt) return next(new AppError(403, "Please verify your email address before accessing bookings."));
    next();
  } catch (error) {
    next(error);
  }
}
