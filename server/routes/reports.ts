import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { AppError } from "../utils/errors.js";
import { getRules } from "../services/booking.js";

export const reportsRouter = Router();
reportsRouter.use(authenticate, authorize("SUPER_ADMIN", "ADMIN"));

function hoursBetween(start: Date, end: Date) {
  return Math.max(0, (end.getTime() - start.getTime()) / 3_600_000);
}

function operatingHours(openingTime: string, closingTime: string) {
  const toMinutes = (value: string) => { const [hours, minutes] = value.split(":").map(Number); return hours * 60 + minutes; };
  return Math.max(0, (toMinutes(closingTime) - toMinutes(openingTime)) / 60);
}

reportsRouter.get("/summary", async (req, res, next) => {
  try {
    const input = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }).parse(req.query);
    const from = input.from ?? new Date(new Date().setHours(0, 0, 0, 0));
    const to = input.to ?? new Date();
    if (from >= to) throw new AppError(400, "Report end date must be after the start date.");
    if (to.getTime() - from.getTime() > 366 * 86_400_000) throw new AppError(400, "Report range cannot exceed 366 days.");

    const [payments, refunds, expenses, sales, rentals, bookings, courts, rules] = await Promise.all([
      prisma.payment.findMany({
        where: { status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] }, paidAt: { gte: from, lt: to } },
        select: { finalAmount: true, bookingId: true, membershipId: true, packagePurchaseId: true, openPlayParticipantId: true, leagueEntryId: true, coachingSessionId: true, walletTopUp: { select: { id: true } } }
      }),
      prisma.refund.findMany({ where: { processedAt: { gte: from, lt: to } }, select: { amount: true, payment: { select: { bookingId: true, membershipId: true, packagePurchaseId: true, openPlayParticipantId: true, leagueEntryId: true, coachingSessionId: true, walletTopUp: { select: { id: true } } } } } }),
      prisma.expense.aggregate({ where: { date: { gte: from, lt: to } }, _sum: { amount: true } }),
      prisma.sale.aggregate({ where: { status: "COMPLETED", createdAt: { gte: from, lt: to } }, _sum: { total: true } }),
      prisma.equipmentRental.findMany({ where: { startsAt: { gte: from, lt: to }, status: { not: "CANCELLED" } }, select: { unitPrice: true, quantity: true } }),
      prisma.booking.groupBy({ by: ["status"], where: { startsAt: { gte: from, lt: to } }, _count: { _all: true } }),
      prisma.court.findMany({ where: { deletedAt: null }, include: { bookings: { where: { status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED"] }, startsAt: { lt: to }, endsAt: { gt: from } }, select: { startsAt: true, endsAt: true } } } }),
      getRules(prisma as never)
    ]);

    type RevenueLink = Pick<typeof payments[number], "bookingId" | "membershipId" | "packagePurchaseId" | "openPlayParticipantId" | "leagueEntryId" | "coachingSessionId" | "walletTopUp">;
    const categoryRevenue = (predicate: (record: RevenueLink) => boolean) => {
      const gross = payments.filter(predicate).reduce((sum, payment) => sum + Number(payment.finalAmount), 0);
      const returned = refunds.filter((refund) => predicate(refund.payment)).reduce((sum, refund) => sum + Number(refund.amount), 0);
      return gross - returned;
    };
    const bookingRevenue = categoryRevenue((payment) => Boolean(payment.bookingId));
    const membershipRevenue = categoryRevenue((payment) => Boolean(payment.membershipId));
    const packageRevenue = categoryRevenue((payment) => Boolean(payment.packagePurchaseId));
    const openPlayRevenue = categoryRevenue((payment) => Boolean(payment.openPlayParticipantId));
    const leagueRevenue = categoryRevenue((payment) => Boolean(payment.leagueEntryId));
    const coachingRevenue = categoryRevenue((payment) => Boolean(payment.coachingSessionId));
    const walletRevenue = categoryRevenue((payment) => Boolean(payment.walletTopUp));
    const otherPaymentRevenue = categoryRevenue((payment) => !payment.bookingId && !payment.membershipId && !payment.packagePurchaseId && !payment.openPlayParticipantId && !payment.leagueEntryId && !payment.coachingSessionId && !payment.walletTopUp);
    const paymentRevenue = payments.reduce((sum, payment) => sum + Number(payment.finalAmount), 0) - refunds.reduce((sum, refund) => sum + Number(refund.amount), 0);
    const expenseTotal = Number(expenses._sum.amount ?? 0);
    const posRevenue = Number(sales._sum.total ?? 0);
    const rentalRevenue = rentals.reduce((sum, rental) => sum + Number(rental.unitPrice) * rental.quantity, 0);
    const totalRevenue = paymentRevenue + posRevenue + rentalRevenue;
    const bookingCount = bookings.reduce((sum, row) => sum + row._count._all, 0);
    const rangeDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
    const courtHours = courts.map((court) => {
      const availableHours = operatingHours(court.openingTime, court.closingTime) * rangeDays;
      const bookedHours = court.bookings.reduce((sum, booking) => {
        const clippedStart = new Date(Math.max(booking.startsAt.getTime(), from.getTime()));
        const clippedEnd = new Date(Math.min(booking.endsAt.getTime(), to.getTime()));
        return sum + hoursBetween(clippedStart, clippedEnd);
      }, 0);
      return { court: court.name, bookedHours, availableHours, utilizationPercent: availableHours > 0 ? Math.min(100, Math.round(bookedHours / availableHours * 10_000) / 100) : 0 };
    });

    res.json({
      success: true,
      data: {
        from: from.toISOString(),
        to: to.toISOString(),
        currency: rules.currency,
        revenue: {
          payments: paymentRevenue,
          bookings: bookingRevenue,
          memberships: membershipRevenue,
          coaching: coachingRevenue,
          pos: posRevenue,
          rentals: rentalRevenue,
          packages: packageRevenue,
          openPlay: openPlayRevenue,
          leagues: leagueRevenue,
          walletTopUps: walletRevenue,
          other: otherPaymentRevenue,
          total: totalRevenue
        },
        expenses: expenseTotal,
        netProfit: totalRevenue - expenseTotal,
        bookingCount,
        bookingStatuses: bookings,
        courtHours
      }
    });
  } catch (error) { next(error); }
});
