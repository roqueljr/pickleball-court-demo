import { Prisma, type AutomationKind } from "@prisma/client";
import { prisma } from "../db.js";
import { AppError } from "../utils/errors.js";
import { calculateLocalRatingUpdate } from "../utils/growthRules.js";

export async function customerForUser(userId: string) {
  const customer = await prisma.customer.findUnique({ where: { userId }, include: { user: true } });
  if (!customer || customer.deletedAt) throw new AppError(403, "This feature requires an active customer profile.");
  return customer;
}

export async function createAccessPass(tx: Prisma.TransactionClient, booking: { id: string; startsAt: Date; endsAt: Date }) {
  return tx.bookingAccessPass.upsert({
    where: { bookingId: booking.id },
    update: { validFrom: new Date(booking.startsAt.getTime() - 30 * 60_000), validUntil: new Date(booking.endsAt.getTime() + 30 * 60_000), status: "ACTIVE", usedAt: null, usedById: null },
    create: { bookingId: booking.id, validFrom: new Date(booking.startsAt.getTime() - 30 * 60_000), validUntil: new Date(booking.endsAt.getTime() + 30 * 60_000) }
  });
}

export async function offerWaitlistForSlot(courtId: string, startsAt: Date, durationMinutes: number) {
  const now = new Date();
  const offerExpiresAt = new Date(now.getTime() + 15 * 60_000);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`waitlist:${courtId}:${startsAt.toISOString()}`}))`;
    await tx.courtWaitlistEntry.updateMany({ where: { courtId, startsAt, durationMinutes, status: "OFFERED", offerExpiresAt: { lte: now } }, data: { status: "EXPIRED" } });
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
    const [activeOffer, bookingConflict, openPlayConflict] = await Promise.all([
      tx.courtWaitlistEntry.findFirst({ where: { courtId, startsAt, durationMinutes, status: "OFFERED", offerExpiresAt: { gt: now } } }),
      tx.booking.findFirst({ where: { courtId, status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } }),
      tx.openPlay.findFirst({ where: { courtId, status: { in: ["OPEN", "FILLED", "CONFIRMED"] }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } })
    ]);
    if (activeOffer || bookingConflict || openPlayConflict || startsAt <= now) return null;
    const entry = await tx.courtWaitlistEntry.findFirst({ where: { courtId, startsAt, durationMinutes, status: "WAITING" }, include: { customer: true, court: true }, orderBy: { createdAt: "asc" } });
    if (!entry) return null;
    const offered = await tx.courtWaitlistEntry.update({ where: { id: entry.id }, data: { status: "OFFERED", offeredAt: now, offerExpiresAt } });
    await tx.notification.create({ data: { userId: entry.customer.userId, customerId: entry.customerId, type: "BOOKING", title: "Your waitlisted court is available", message: `${entry.court.name} is available for your requested time. Claim it within 15 minutes.`, actionUrl: "/app/growth", channel: "IN_APP" } });
    return offered;
  });
}

function birthdayIsWithin(date: Date, days: number, now: Date) {
  for (let offset = 0; offset <= days; offset += 1) {
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    if (candidate.getMonth() === date.getMonth() && candidate.getDate() === date.getDate()) return true;
  }
  return false;
}

async function campaignAudience(kind: AutomationKind, triggerDays: number) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - triggerDays * 86_400_000);
  const base = { deletedAt: null, marketingConsent: true, user: { status: "ACTIVE" as const } };
  if (kind === "WIN_BACK") return prisma.customer.findMany({ where: { ...base, OR: [{ lastActivityAt: { lte: cutoff } }, { lastActivityAt: null, createdAt: { lte: cutoff } }] }, include: { user: true } });
  if (kind === "MEMBERSHIP_EXPIRY") return prisma.customer.findMany({ where: { ...base, memberships: { some: { status: "ACTIVE", endDate: { gte: now, lte: new Date(now.getTime() + triggerDays * 86_400_000) } } } }, include: { user: true } });
  if (kind === "BIRTHDAY") {
    const customers = await prisma.customer.findMany({ where: { ...base, dateOfBirth: { not: null } }, include: { user: true } });
    return customers.filter((customer) => customer.dateOfBirth && birthdayIsWithin(customer.dateOfBirth, triggerDays, now));
  }
  return prisma.customer.findMany({ where: base, include: { user: true } });
}

export async function runAutomationCampaign(campaignId: string, requestedById?: string, force = false) {
  const campaign = await prisma.automationCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new AppError(404, "Automation campaign not found.");
  if (campaign.status !== "ACTIVE") throw new AppError(409, "This automation campaign is paused.");
  if (!force && campaign.lastRunAt && campaign.lastRunAt.getTime() > Date.now() - 23 * 60 * 60_000) return { campaign, recipients: 0, skipped: true };
  const audience = await campaignAudience(campaign.kind, campaign.triggerDays);
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`campaign:${campaign.id}`}))`;
    const fresh = await tx.automationCampaign.findUniqueOrThrow({ where: { id: campaign.id } });
    if (!force && fresh.lastRunAt && fresh.lastRunAt.getTime() > Date.now() - 23 * 60 * 60_000) return { recipients: 0, skipped: true };
    if (audience.length) await tx.notification.createMany({ data: audience.map((customer) => ({ userId: customer.userId, customerId: customer.id, type: campaign.kind === "MEMBERSHIP_EXPIRY" ? "MEMBERSHIP" as const : campaign.kind === "PROMOTION" ? "PROMOTION" as const : "SYSTEM" as const, title: campaign.subject, message: campaign.message, actionUrl: campaign.actionUrl ?? "/app/growth", channel: "IN_APP" as const })) });
    await tx.automationCampaign.update({ where: { id: campaign.id }, data: { lastRunAt: new Date() } });
    await tx.automationRun.create({ data: { campaignId: campaign.id, recipients: audience.length } });
    await tx.auditLog.create({ data: { userId: requestedById, action: "AUTOMATION_CAMPAIGN_RUN", entity: "AutomationCampaign", entityId: campaign.id, metadata: { recipients: audience.length } } });
    return { recipients: audience.length, skipped: false };
  });
  return { campaign, ...result };
}

export async function updateLocalLeagueRatings(tx: Prisma.TransactionClient, homeCustomerId: string, awayCustomerId: string, homeWon: boolean) {
  const [home, away] = await Promise.all([
    tx.customer.findUniqueOrThrow({ where: { id: homeCustomerId }, select: { skillRating: true } }),
    tx.customer.findUniqueOrThrow({ where: { id: awayCustomerId }, select: { skillRating: true } })
  ]);
  const homeRating = Number(home.skillRating); const awayRating = Number(away.skillRating);
  const { home: nextHome, away: nextAway } = calculateLocalRatingUpdate(homeRating, awayRating, homeWon);
  await Promise.all([
    tx.customer.update({ where: { id: homeCustomerId }, data: { skillRating: nextHome, lastActivityAt: new Date() } }),
    tx.customer.update({ where: { id: awayCustomerId }, data: { skillRating: nextAway, lastActivityAt: new Date() } })
  ]);
  return { home: nextHome, away: nextAway };
}
