import { prisma } from "../db.js";
import { offerWaitlistForSlot, runAutomationCampaign } from "./growth.js";

async function runDueCampaigns() {
  try {
    const campaigns = await prisma.automationCampaign.findMany({ where: { status: "ACTIVE", OR: [{ lastRunAt: null }, { lastRunAt: { lte: new Date(Date.now() - 23 * 60 * 60_000) } }] }, select: { id: true } });
    for (const campaign of campaigns) await runAutomationCampaign(campaign.id);
  } catch (error) {
    console.error("[automation] Retention campaign cycle failed.", error);
  }
}

async function recoverExpiredWaitlistOffers() {
  try {
    const now = new Date();
    const expiredSlots = await prisma.courtWaitlistEntry.findMany({
      where: { status: "OFFERED", offerExpiresAt: { lte: now } },
      select: { courtId: true, startsAt: true, durationMinutes: true },
      distinct: ["courtId", "startsAt", "durationMinutes"]
    });
    for (const slot of expiredSlots) await offerWaitlistForSlot(slot.courtId, slot.startsAt, slot.durationMinutes);
    await prisma.bookingAccessPass.updateMany({ where: { status: "ACTIVE", validUntil: { lt: now } }, data: { status: "EXPIRED" } });
  } catch (error) {
    console.error("[automation] Waitlist or access-pass cycle failed.", error);
  }
}

export function startAutomationScheduler() {
  const timer = setInterval(() => void runDueCampaigns(), 60 * 60_000);
  const waitlistTimer = setInterval(() => void recoverExpiredWaitlistOffers(), 60_000);
  timer.unref();
  waitlistTimer.unref();
  setTimeout(() => void runDueCampaigns(), 10_000).unref();
  setTimeout(() => void recoverExpiredWaitlistOffers(), 15_000).unref();
}
