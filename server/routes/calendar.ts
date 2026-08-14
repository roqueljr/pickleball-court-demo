import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { getManilaDate } from "../services/booking.js";
import { AppError } from "../utils/errors.js";
import { isValidCalendarRange, manilaDateKey } from "../utils/calendarRules.js";

export const calendarRouter = Router();
calendarRouter.use(authenticate, authorize("SUPER_ADMIN", "ADMIN", "STAFF"));

const calendarInput = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  courtId: z.string().optional(),
  eventType: z.enum(["BOOKING", "COACHING", "BLOCKED", "MAINTENANCE"]).optional(),
  status: z.enum(["PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED", "CANCELLED", "NO_SHOW", "REFUNDED", "BLOCKED", "MAINTENANCE", "CLOSED"]).optional(),
  customer: z.string().trim().max(100).optional()
});

type CalendarEvent = {
  id: string;
  entityId: string;
  type: "BOOKING" | "COACHING" | "BLOCKED" | "MAINTENANCE";
  title: string;
  detail: string;
  startsAt: string;
  endsAt: string;
  status: string;
  court: { id: string; name: string };
  customer: { name: string; email: string } | null;
  targetUrl: string;
};

calendarRouter.get("/", async (req, res, next) => {
  try {
    const input = calendarInput.parse(req.query);
    const rangeMilliseconds = input.to.getTime() - input.from.getTime();
    if (!isValidCalendarRange(input.from, input.to)) {
      if (rangeMilliseconds <= 0) throw new AppError(400, "Calendar end date must be after the start date.");
      throw new AppError(400, "Calendar range cannot exceed 62 days.");
    }

    const customerFilter = input.customer ? {
      customer: {
        user: {
          OR: [
            { firstName: { contains: input.customer, mode: "insensitive" as const } },
            { lastName: { contains: input.customer, mode: "insensitive" as const } },
            { email: { contains: input.customer, mode: "insensitive" as const } }
          ]
        }
      }
    } : {};
    const courtFilter = input.courtId ? { courtId: input.courtId } : {};

    const [bookings, coachingSessions, courts, blockedSchedules] = await Promise.all([
      prisma.booking.findMany({
        where: { startsAt: { lt: input.to }, endsAt: { gt: input.from }, ...courtFilter, ...customerFilter },
        include: { court: { select: { id: true, name: true } }, customer: { include: { user: { select: { firstName: true, lastName: true, email: true } } } } },
        orderBy: { startsAt: "asc" }
      }),
      prisma.coachingSession.findMany({
        where: { startsAt: { lt: input.to }, endsAt: { gt: input.from }, ...courtFilter, ...customerFilter },
        include: { court: { select: { id: true, name: true } }, coach: { include: { user: { select: { firstName: true, lastName: true } } } }, customer: { include: { user: { select: { firstName: true, lastName: true, email: true } } } } },
        orderBy: { startsAt: "asc" }
      }),
      prisma.court.findMany({
        where: { deletedAt: null, ...(input.courtId ? { id: input.courtId } : {}) },
        select: { id: true, name: true, status: true, openingTime: true, closingTime: true },
        orderBy: { name: "asc" }
      }),
      prisma.courtSchedule.findMany({
        where: { isBlocked: true, ...(input.courtId ? { courtId: input.courtId } : {}), court: { deletedAt: null } },
        include: { court: { select: { id: true, name: true } } },
        orderBy: [{ weekday: "asc" }, { startTime: "asc" }]
      })
    ]);

    const events: CalendarEvent[] = [];
    for (const booking of bookings) {
      events.push({
        id: `booking:${booking.id}`,
        entityId: booking.id,
        type: "BOOKING",
        title: `${booking.court.name} · ${booking.reference}`,
        detail: `${booking.customer.user.firstName} ${booking.customer.user.lastName}`,
        startsAt: booking.startsAt.toISOString(),
        endsAt: booking.endsAt.toISOString(),
        status: booking.status,
        court: booking.court,
        customer: { name: `${booking.customer.user.firstName} ${booking.customer.user.lastName}`, email: booking.customer.user.email },
        targetUrl: "/app/bookings"
      });
    }

    for (const session of coachingSessions) {
      const court = session.court ?? { id: "unassigned", name: "Court to be assigned" };
      events.push({
        id: `coaching:${session.id}`,
        entityId: session.id,
        type: "COACHING",
        title: `Coaching · ${session.coach.user.firstName} ${session.coach.user.lastName}`,
        detail: `${session.customer.user.firstName} ${session.customer.user.lastName}`,
        startsAt: session.startsAt.toISOString(),
        endsAt: session.endsAt.toISOString(),
        status: session.status,
        court,
        customer: { name: `${session.customer.user.firstName} ${session.customer.user.lastName}`, email: session.customer.user.email },
        targetUrl: "/app/coaching"
      });
    }

    for (let current = new Date(input.from); current < input.to; current = new Date(current.getTime() + 86_400_000)) {
      const date = manilaDateKey(current);
      const weekday = new Date(`${date}T12:00:00+08:00`).getUTCDay();

      if (!input.customer) {
        for (const schedule of blockedSchedules.filter((candidate) => candidate.weekday === weekday)) {
          events.push({
            id: `blocked:${schedule.id}:${date}`,
            entityId: schedule.id,
            type: "BLOCKED",
            title: schedule.reason || "Blocked court time",
            detail: schedule.court.name,
            startsAt: getManilaDate(date, schedule.startTime).toISOString(),
            endsAt: getManilaDate(date, schedule.endTime).toISOString(),
            status: "BLOCKED",
            court: schedule.court,
            customer: null,
            targetUrl: "/app/courts"
          });
        }

        for (const court of courts.filter((candidate) => candidate.status === "MAINTENANCE" || candidate.status === "CLOSED")) {
          events.push({
            id: `maintenance:${court.id}:${date}`,
            entityId: court.id,
            type: "MAINTENANCE",
            title: court.status === "CLOSED" ? "Court closed" : "Court maintenance",
            detail: court.name,
            startsAt: getManilaDate(date, court.openingTime).toISOString(),
            endsAt: getManilaDate(date, court.closingTime).toISOString(),
            status: court.status,
            court: { id: court.id, name: court.name },
            customer: null,
            targetUrl: "/app/courts"
          });
        }
      }
    }

    const filteredEvents = events
      .filter((event) => !input.eventType || event.type === input.eventType)
      .filter((event) => !input.status || event.status === input.status)
      .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());

    const courtOptions = await prisma.court.findMany({ where: { deletedAt: null }, select: { id: true, name: true, status: true }, orderBy: { name: "asc" } });
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, data: { events: filteredEvents, courts: courtOptions, generatedAt: new Date().toISOString() } });
  } catch (error) { next(error); }
});
