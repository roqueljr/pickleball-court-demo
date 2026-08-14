import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { AppError } from "../utils/errors.js";
import { authenticate, authorize } from "../middleware/auth.js";

export const tournamentsRouter = Router();

const participantSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().max(30).optional()
});

function serializeTournament(tournament: { id: string; title: string; slug: string; description: string; format: string; registrationMode: string; skillLevel: string; startsAt: Date; endsAt: Date; registrationDeadline: Date; location: string; entryFee: unknown; maxRegistrations: number | null; teamSize: number; imageUrl: string | null; featured: boolean; status: string; _count?: { registrations: number } }) {
  return { ...tournament, entryFee: Number(tournament.entryFee), startsAt: tournament.startsAt.toISOString(), endsAt: tournament.endsAt.toISOString(), registrationDeadline: tournament.registrationDeadline.toISOString(), registrationsCount: tournament._count?.registrations ?? 0 };
}

const tournamentSelect = { id: true, title: true, slug: true, description: true, format: true, registrationMode: true, skillLevel: true, startsAt: true, endsAt: true, registrationDeadline: true, location: true, entryFee: true, maxRegistrations: true, teamSize: true, imageUrl: true, featured: true, status: true, _count: { select: { registrations: { where: { status: { not: "CANCELLED" } } } } } } as const;

tournamentsRouter.get("/", async (_req, res, next) => {
  try {
    const tournaments = await prisma.tournament.findMany({ where: { status: "PUBLISHED" }, select: tournamentSelect, orderBy: [{ featured: "desc" }, { startsAt: "asc" }] });
    res.json({ success: true, data: { tournaments: tournaments.map(serializeTournament) } });
  } catch (error) { next(error); }
});

tournamentsRouter.get("/featured", async (_req, res, next) => {
  try {
    const tournament = await prisma.tournament.findFirst({ where: { status: "PUBLISHED", featured: true, startsAt: { gte: new Date() } }, select: tournamentSelect, orderBy: { startsAt: "asc" } });
    res.json({ success: true, data: { tournament: tournament ? serializeTournament(tournament) : null } });
  } catch (error) { next(error); }
});

tournamentsRouter.get("/manage/list", authenticate, authorize("SUPER_ADMIN", "ADMIN"), async (_req, res, next) => {
  try { const tournaments = await prisma.tournament.findMany({ select: tournamentSelect, orderBy: { startsAt: "desc" } }); res.json({ success: true, data: { tournaments: tournaments.map(serializeTournament) } }); } catch (error) { next(error); }
});

tournamentsRouter.get("/:slug", async (req, res, next) => {
  try {
    const tournament = await prisma.tournament.findFirst({ where: { slug: String(req.params.slug), status: "PUBLISHED" }, select: tournamentSelect });
    if (!tournament) throw new AppError(404, "Tournament not found.");
    res.json({ success: true, data: { tournament: serializeTournament(tournament) } });
  } catch (error) { next(error); }
});

tournamentsRouter.post("/:slug/register", async (req, res, next) => {
  try {
    const input = z.object({
      mode: z.enum(["INDIVIDUAL", "TEAM"]),
      teamName: z.string().trim().max(100).optional(),
      captainName: z.string().trim().min(2).max(100),
      captainEmail: z.string().trim().toLowerCase().email(),
      captainPhone: z.string().trim().min(7).max(30),
      notes: z.string().trim().max(500).optional(),
      participants: z.array(participantSchema).max(7)
    }).parse(req.body);
    const tournament = await prisma.tournament.findFirst({ where: { slug: String(req.params.slug), status: "PUBLISHED" } });
    if (!tournament) throw new AppError(404, "Tournament not found.");
    if (new Date() > tournament.registrationDeadline) throw new AppError(400, "Registration for this tournament is closed.");
    if (tournament.registrationMode !== "BOTH" && tournament.registrationMode !== input.mode) throw new AppError(400, `This event accepts ${tournament.registrationMode.toLowerCase()} registration only.`);
    const expectedParticipants = input.mode === "TEAM" ? tournament.teamSize - 1 : 0;
    if (input.participants.length !== expectedParticipants) throw new AppError(400, `Please provide exactly ${expectedParticipants} additional player${expectedParticipants === 1 ? "" : "s"} for this registration.`);
    if (input.mode === "TEAM" && !input.teamName) throw new AppError(400, "Team name is required for team registration.");
    const emails = [input.captainEmail, ...input.participants.map((participant) => participant.email)];
    if (new Set(emails).size !== emails.length) throw new AppError(400, "Each player must use a different email address.");

    const registration = await prisma.$transaction(async (tx) => {
      const activeCount = await tx.tournamentRegistration.count({ where: { tournamentId: tournament.id, status: { in: ["PENDING", "CONFIRMED"] } } });
      if (tournament.maxRegistrations !== null && activeCount >= tournament.maxRegistrations) throw new AppError(409, "This tournament is already full.");
      const duplicate = await tx.tournamentRegistration.findFirst({ where: { tournamentId: tournament.id, captainEmail: input.captainEmail, status: { not: "CANCELLED" } } });
      if (duplicate) throw new AppError(409, "This email is already registered for this tournament.");
      return tx.tournamentRegistration.create({ data: { tournamentId: tournament.id, mode: input.mode, teamName: input.teamName, captainName: input.captainName, captainEmail: input.captainEmail, captainPhone: input.captainPhone, notes: input.notes, participants: { create: input.participants } } });
    });
    res.status(201).json({ success: true, data: { registration: { id: registration.id, status: registration.status, message: "Registration received. The club team will contact you with payment and confirmation details." } } });
  } catch (error) { next(error); }
});

const manageInput = z.object({ title: z.string().trim().min(3, "Title must be at least 3 characters.").max(120), slug: z.string().trim().toLowerCase().min(3, "URL slug is required.").max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens only."), description: z.string().trim().min(10, "Description must be at least 10 characters.").max(2000), format: z.enum(["SINGLES", "DOUBLES", "MIXED_DOUBLES", "ROUND_ROBIN"]), registrationMode: z.enum(["INDIVIDUAL", "TEAM", "BOTH"]), skillLevel: z.string().trim().min(2).max(80), startsAt: z.coerce.date({ error: "Start date and time is required." }), endsAt: z.coerce.date({ error: "End date and time is required." }), registrationDeadline: z.coerce.date({ error: "Registration deadline is required." }), location: z.string().trim().min(2).max(160), entryFee: z.coerce.number().nonnegative(), maxRegistrations: z.coerce.number().int().positive().nullable().optional(), teamSize: z.coerce.number().int().min(2).max(8).default(2), imageUrl: z.string().url().optional(), featured: z.boolean().default(false), status: z.enum(["DRAFT", "PUBLISHED", "CLOSED", "COMPLETED", "CANCELLED"]).default("DRAFT") });

tournamentsRouter.post("/manage", authenticate, authorize("SUPER_ADMIN", "ADMIN"), async (req, res, next) => {
  try { const input = manageInput.parse(req.body); if (input.endsAt <= input.startsAt) throw new AppError(400, "Event end time must be after start time."); if (input.registrationDeadline >= input.startsAt) throw new AppError(400, "Registration deadline must be before the event starts."); const tournament = await prisma.tournament.create({ data: input, select: tournamentSelect }); res.status(201).json({ success: true, data: { tournament: serializeTournament(tournament) } }); } catch (error) { next(error); }
});

tournamentsRouter.patch("/manage/:id/status", authenticate, authorize("SUPER_ADMIN", "ADMIN"), async (req, res, next) => {
  try {
    const input = z.object({ status: z.enum(["DRAFT", "PUBLISHED", "CLOSED", "COMPLETED", "CANCELLED"]) }).parse(req.body);
    const tournament = await prisma.tournament.update({ where: { id: String(req.params.id) }, data: { status: input.status }, select: tournamentSelect });
    res.json({ success: true, data: { tournament: serializeTournament(tournament) } });
  } catch (error) { next(error); }
});

tournamentsRouter.patch("/manage/:id", authenticate, authorize("SUPER_ADMIN", "ADMIN"), async (req, res, next) => {
  try {
    const input = manageInput.parse(req.body);
    if (input.endsAt <= input.startsAt) throw new AppError(400, "Event end date and time must be after the start date and time.");
    if (input.registrationDeadline >= input.startsAt) throw new AppError(400, "Registration deadline must be before the event starts.");
    const tournament = await prisma.tournament.update({ where: { id: String(req.params.id) }, data: input, select: tournamentSelect });
    res.json({ success: true, data: { tournament: serializeTournament(tournament) } });
  } catch (error) { next(error); }
});

tournamentsRouter.get("/manage/:id/registrations", authenticate, authorize("SUPER_ADMIN", "ADMIN"), async (req, res, next) => {
  try { const registrations = await prisma.tournamentRegistration.findMany({ where: { tournamentId: String(req.params.id) }, include: { participants: true }, orderBy: { createdAt: "desc" } }); res.json({ success: true, data: { registrations } }); } catch (error) { next(error); }
});

tournamentsRouter.patch("/manage/registrations/:id", authenticate, authorize("SUPER_ADMIN", "ADMIN"), async (req, res, next) => {
  try { const input = z.object({ status: z.enum(["PENDING", "CONFIRMED", "WAITLISTED", "CANCELLED"]) }).parse(req.body); const registration = await prisma.tournamentRegistration.update({ where: { id: String(req.params.id) }, data: { status: input.status } }); res.json({ success: true, data: { registration } }); } catch (error) { next(error); }
});
