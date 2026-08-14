import { Router } from "express";
import { prisma } from "../db.js";

export const healthRouter = Router();
healthRouter.get("/", (_req, res) => res.json({ success: true, data: { service: "rally-court-club-api", status: "ok" } }));
healthRouter.get("/ready", async (_req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, data: { service: "rally-court-club-api", status: "ready", database: "ok" } });
  } catch (error) {
    void next;
    console.error("Database readiness check failed.", error);
    res.status(503).json({ success: false, message: "Database is not ready.", errors: {} });
  }
});
