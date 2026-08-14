import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { AppError } from "../utils/errors.js";
import { getManilaDate, getRules } from "../services/booking.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { findTimeConflict } from "../utils/bookingRules.js";
import { CourtImageValidationError, validateCourtImage } from "../utils/imageValidation.js";

export const courtsRouter = Router();

function serializeCourt(court: { id: string; name: string; description: string | null; location: string | null; indoor: boolean; surfaceType: string | null; status: string; openingTime: string; closingTime: string; hourlyRate: unknown; imageUrl: string | null; features: unknown }) {
  return { ...court, hourlyRate: Number(court.hourlyRate) };
}

function manilaTime(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

courtsRouter.get("/", async (_req, res, next) => {
  try {
    const courts = await prisma.court.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } });
    res.json({ success: true, data: { courts: courts.map(serializeCourt) } });
  } catch (error) { next(error); }
});

courtsRouter.get("/:id/availability", async (req, res, next) => {
  try {
    const input = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), duration: z.coerce.number().int().positive().max(1440).default(60) }).parse(req.query);
    const court = await prisma.court.findUnique({ where: { id: req.params.id } });
    if (!court || court.deletedAt) throw new AppError(404, "Court not found.");
    const rules = await getRules(prisma as never);
    if (input.duration % 30 !== 0 || input.duration < rules.minimumBookingMinutes || input.duration > rules.maximumBookingMinutes) {
      throw new AppError(400, `Booking duration must be between ${rules.minimumBookingMinutes} and ${rules.maximumBookingMinutes} minutes in 30-minute increments.`);
    }
    const dayStart = getManilaDate(input.date, "00:00"); const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);
    const weekday = new Date(`${input.date}T12:00:00+08:00`).getUTCDay();
    const [bookings, openPlays, blockedSchedules] = await Promise.all([
      prisma.booking.findMany({ where: { courtId: court.id, status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] }, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } }, select: { startsAt: true, endsAt: true } }),
      prisma.openPlay.findMany({ where: { courtId: court.id, status: { in: ["OPEN", "FILLED", "CONFIRMED"] }, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } }, select: { startsAt: true, endsAt: true } }),
      prisma.courtSchedule.findMany({ where: { courtId: court.id, weekday, isBlocked: true }, select: { startTime: true, endTime: true } })
    ]);
    const occupiedBookings = [...bookings, ...openPlays];
    const toMinutes = (value: string) => { const [hours, minutes] = value.split(":").map(Number); return hours * 60 + minutes; };
    const opening = toMinutes(court.openingTime); const closing = toMinutes(court.closingTime);
    const occupiedPeriods = occupiedBookings
      .map((booking) => ({ startTime: manilaTime(booking.startsAt), endTime: manilaTime(booking.endsAt) }))
      .sort((left, right) => left.startTime.localeCompare(right.startTime));
    const slots: {
      startTime: string;
      endTime: string;
      available: boolean;
      reason: "BOOKED" | "BLOCKED" | "TOO_SOON" | "COURT_UNAVAILABLE" | null;
      conflictPeriod: { startTime: string; endTime: string; type: "BOOKING" | "SCHEDULE" } | null;
    }[] = [];
    const advanceCutoff = Date.now() + rules.minimumAdvanceMinutes * 60_000;
    for (let minute = opening; minute + input.duration <= closing; minute += 30) {
      const hours = String(Math.floor(minute / 60)).padStart(2, "0"); const mins = String(minute % 60).padStart(2, "0");
      const endMinute = minute + input.duration; const endHours = String(Math.floor(endMinute / 60)).padStart(2, "0"); const endMins = String(endMinute % 60).padStart(2, "0");
      const startsAt = getManilaDate(input.date, `${hours}:${mins}`); const endsAt = getManilaDate(input.date, `${endHours}:${endMins}`);
      const bookingConflict = findTimeConflict(occupiedBookings, startsAt, endsAt);
      const scheduleConflict = blockedSchedules.find((schedule) => toMinutes(schedule.startTime) < endMinute && toMinutes(schedule.endTime) > minute);
      const reason = court.status !== "AVAILABLE" ? "COURT_UNAVAILABLE" : startsAt.getTime() < advanceCutoff ? "TOO_SOON" : bookingConflict ? "BOOKED" : scheduleConflict ? "BLOCKED" : null;
      const conflictPeriod = bookingConflict
        ? { startTime: manilaTime(bookingConflict.startsAt), endTime: manilaTime(bookingConflict.endsAt), type: "BOOKING" as const }
        : scheduleConflict
          ? { startTime: scheduleConflict.startTime, endTime: scheduleConflict.endTime, type: "SCHEDULE" as const }
          : null;
      slots.push({ startTime: `${hours}:${mins}`, endTime: `${endHours}:${endMins}`, available: reason === null, reason, conflictPeriod });
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, data: { court: serializeCourt(court), date: input.date, durationMinutes: input.duration, generatedAt: new Date().toISOString(), occupiedPeriods, slots } });
  } catch (error) { next(error); }
});

const courtInput = z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(500).optional(), location: z.string().trim().max(120).optional(), indoor: z.boolean().default(true), surfaceType: z.string().trim().max(80).optional(), status: z.enum(["AVAILABLE", "MAINTENANCE", "CLOSED"]).default("AVAILABLE"), openingTime: z.string().regex(/^\d{2}:\d{2}$/).default("06:00"), closingTime: z.string().regex(/^\d{2}:\d{2}$/).default("22:00"), hourlyRate: z.coerce.number().nonnegative().max(100000), imageUrl: z.string().max(900_000, "Court image is too large.").optional(), features: z.array(z.string().trim().min(1).max(80)).max(20).optional() });

function normalizedCourtImage(value: string | undefined) {
  if (value === undefined) return undefined;
  try { return validateCourtImage(value) || null; }
  catch (error) { if (error instanceof CourtImageValidationError) throw new AppError(400, error.message); throw error; }
}

courtsRouter.post("/", authenticate, authorize("SUPER_ADMIN", "ADMIN"), async (req, res, next) => {
  try {
    const input = courtInput.parse(req.body);
    const court = await prisma.court.create({ data: { ...input, description: input.description || null, location: input.location || null, surfaceType: input.surfaceType || null, imageUrl: normalizedCourtImage(input.imageUrl) ?? null, features: input.features ?? [] } });
    await prisma.auditLog.create({ data: { userId: req.auth!.userId, action: "COURT_CREATED", entity: "Court", entityId: court.id, metadata: { name: court.name } } });
    res.status(201).json({ success: true, data: { court: serializeCourt(court) } });
  } catch (error) { next(error); }
});

courtsRouter.put("/:id", authenticate, authorize("SUPER_ADMIN", "ADMIN"), async (req, res, next) => {
  try {
    const input = courtInput.partial().parse(req.body); const courtId = String(req.params.id);
    const court = await prisma.court.update({ where: { id: courtId }, data: { ...input, imageUrl: normalizedCourtImage(input.imageUrl) } });
    await prisma.auditLog.create({ data: { userId: req.auth!.userId, action: "COURT_UPDATED", entity: "Court", entityId: court.id, metadata: { changes: input } } });
    res.json({ success: true, data: { court: serializeCourt(court) } });
  } catch (error) { next(error); }
});

courtsRouter.delete("/:id", authenticate, authorize("SUPER_ADMIN", "ADMIN"), async (req, res, next) => {
  try {
    const courtId = String(req.params.id); const court = await prisma.court.update({ where: { id: courtId }, data: { deletedAt: new Date(), status: "CLOSED" } });
    await prisma.auditLog.create({ data: { userId: req.auth!.userId, action: "COURT_DEACTIVATED", entity: "Court", entityId: court.id } });
    res.json({ success: true, data: { court: serializeCourt(court) } });
  } catch (error) { next(error); }
});
