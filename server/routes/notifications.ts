import { Router } from "express";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);
function notificationLink(type: string) { return ({ BOOKING: "/app/bookings", PAYMENT: "/app/payments", MEMBERSHIP: "/app/memberships", PROMOTION: "/app/promotions", SCHEDULE: "/app/calendar", SYSTEM: "/app" }[type] ?? "/app/notifications"); }
notificationsRouter.get("/", async (req, res, next) => { try { const notifications = await prisma.notification.findMany({ where: { userId: req.auth!.userId }, orderBy: { createdAt: "desc" }, take: 100 }); const serialized = notifications.map((notification) => ({ ...notification, actionUrl: notification.actionUrl ?? notificationLink(notification.type), createdAt: notification.createdAt.toISOString() })); res.json({ success: true, data: { notifications: serialized, unreadCount: serialized.filter((notification) => !notification.readAt).length } }); } catch (error) { next(error); } });
notificationsRouter.post("/:id/read", async (req, res, next) => { try { const notification = await prisma.notification.updateMany({ where: { id: String(req.params.id), userId: req.auth!.userId }, data: { readAt: new Date() } }); res.json({ success: true, data: { updated: notification.count === 1 } }); } catch (error) { next(error); } });
notificationsRouter.post("/read-all", async (req, res, next) => { try { const result = await prisma.notification.updateMany({ where: { userId: req.auth!.userId, readAt: null }, data: { readAt: new Date() } }); res.json({ success: true, data: { updated: result.count } }); } catch (error) { next(error); } });
