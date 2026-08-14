import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { config } from "../config.js";

export class AppError extends Error {
  constructor(public statusCode: number, message: string, public errors: Record<string, unknown> = {}) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound: RequestHandler = (_req, _res, next) => next(new AppError(404, "Route not found"));

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  void _next;
  if (error instanceof ZodError) {
    res.status(400).json({ success: false, message: "Validation failed.", errors: error.flatten().fieldErrors });
    return;
  }
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ success: false, message: error.message, errors: error.errors });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") { res.status(409).json({ success: false, message: "A record with this unique value already exists.", errors: {} }); return; }
    if (error.code === "P2025") { res.status(404).json({ success: false, message: "The requested record was not found.", errors: {} }); return; }
    if (error.code === "P2003") { res.status(400).json({ success: false, message: "This change references a missing or protected record.", errors: {} }); return; }
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    console.error("Database connection failed.", error);
    res.status(503).json({ success: false, message: "Database connection unavailable. Check DATABASE_URL and restart the server.", errors: {} });
    return;
  }
  if (error instanceof SyntaxError && "status" in error && error.status === 400) {
    res.status(400).json({ success: false, message: "Request body contains invalid JSON.", errors: {} });
    return;
  }
  console.error(error);
  const message = config.nodeEnv === "development" && error instanceof Error ? error.message : "An unexpected server error occurred.";
  res.status(500).json({ success: false, message, errors: {} });
};
