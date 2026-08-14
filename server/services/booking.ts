import { Prisma, type BookingStatus, type PaymentMethod } from "@prisma/client";
import { prisma } from "../db.js";
import { AppError } from "../utils/errors.js";
import { calculateBookingTotals, findTimeConflict } from "../utils/bookingRules.js";
import { hasReachedBookingLimit } from "../utils/membershipRules.js";
import { calculateCreditCheckout, selectPricingRule } from "../utils/growthRules.js";
import { evaluatePromotionForBooking } from "../utils/promotionRules.js";

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ["PENDING", "CONFIRMED", "CHECKED_IN"];

type BookingInput = {
  customerId: string;
  createdById?: string;
  courtId: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  promoCode?: string;
  paymentMethod: PaymentMethod;
  transactionReference?: string;
  packagePurchaseId?: string;
  walletAmount?: number;
};

type Rules = {
  currency: string;
  taxRate: number;
  minimumBookingMinutes: number;
  maximumBookingMinutes: number;
  minimumAdvanceMinutes: number;
  maximumAdvanceDays: number;
  cancellationHours: number;
  refundWindowHours: number;
};

function getManilaDate(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new AppError(400, "Choose a valid booking date and time.");
  const parsed = new Date(`${date}T${time}:00+08:00`);
  if (Number.isNaN(parsed.getTime())) throw new AppError(400, "Choose a valid booking date and time.");
  const normalizedDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed);
  const normalizedTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(parsed);
  if (normalizedDate !== date || normalizedTime !== time) throw new AppError(400, "Choose a valid booking date and time.");
  return parsed;
}

function minutesFromTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new AppError(400, "Time must use HH:mm format.");
  const hours = Number(match[1]); const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new AppError(400, "Choose a valid booking time.");
  return hours * 60 + minutes;
}

async function getRules(tx: Prisma.TransactionClient): Promise<Rules> {
  const rows = await tx.businessSetting.findMany({ where: { key: { in: ["currency", "tax_rate", "minimum_booking_minutes", "maximum_booking_minutes", "minimum_advance_minutes", "maximum_advance_days", "cancellation_hours", "refund_window_hours"] } } });
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const numeric = (key: string, fallback: number) => typeof values[key] === "number" ? values[key] as number : fallback;
  const configuredTaxRate = numeric("tax_rate", 0.12);
  return {
    currency: typeof values.currency === "string" ? values.currency : "PHP",
    taxRate: configuredTaxRate > 1 ? configuredTaxRate / 100 : configuredTaxRate,
    minimumBookingMinutes: numeric("minimum_booking_minutes", 60),
    maximumBookingMinutes: numeric("maximum_booking_minutes", 180),
    minimumAdvanceMinutes: numeric("minimum_advance_minutes", 60),
    maximumAdvanceDays: numeric("maximum_advance_days", 30),
    cancellationHours: numeric("cancellation_hours", 12),
    refundWindowHours: numeric("refund_window_hours", 6)
  };
}

function serializeBooking<T extends { subtotal: Prisma.Decimal; discount: Prisma.Decimal; tax: Prisma.Decimal; total: Prisma.Decimal; startsAt: Date; endsAt: Date }>(booking: T) {
  return { ...booking, subtotal: Number(booking.subtotal), discount: Number(booking.discount), tax: Number(booking.tax), total: Number(booking.total), startsAt: booking.startsAt.toISOString(), endsAt: booking.endsAt.toISOString() };
}

export async function createBooking(input: BookingInput) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Serialize writes for a court so two simultaneous requests cannot both pass the conflict check.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.courtId}))`;
        const rules = await getRules(tx);
        if (!Number.isInteger(input.durationMinutes) || input.durationMinutes % 30 !== 0 || input.durationMinutes < rules.minimumBookingMinutes || input.durationMinutes > rules.maximumBookingMinutes) {
          throw new AppError(400, `Booking duration must be between ${rules.minimumBookingMinutes} and ${rules.maximumBookingMinutes} minutes in 30-minute increments.`);
        }
        const startMinutes = minutesFromTime(input.startTime);
        const startsAt = getManilaDate(input.date, input.startTime);
        const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000);
        const court = await tx.court.findUnique({ where: { id: input.courtId } });
        if (!court || court.deletedAt || court.status !== "AVAILABLE") throw new AppError(409, "This court is not currently available.");
        const opening = minutesFromTime(court.openingTime); const closing = minutesFromTime(court.closingTime);
        if (startMinutes < opening || startMinutes + input.durationMinutes > closing) throw new AppError(400, `This court is open from ${court.openingTime} to ${court.closingTime}.`);
        const weekday = new Date(`${input.date}T12:00:00+08:00`).getUTCDay();
        const blockedSchedules = await tx.courtSchedule.findMany({ where: { courtId: input.courtId, weekday, isBlocked: true }, select: { startTime: true, endTime: true } });
        if (blockedSchedules.some((schedule) => minutesFromTime(schedule.startTime) < startMinutes + input.durationMinutes && minutesFromTime(schedule.endTime) > startMinutes)) {
          throw new AppError(409, "This court is blocked for the selected time.");
        }
        const now = new Date();
        if (startsAt.getTime() < now.getTime() + rules.minimumAdvanceMinutes * 60_000) throw new AppError(400, `Bookings must be made at least ${rules.minimumAdvanceMinutes} minutes ahead.`);
        if (startsAt.getTime() > now.getTime() + rules.maximumAdvanceDays * 24 * 60 * 60_000) throw new AppError(400, `Bookings can only be made ${rules.maximumAdvanceDays} days ahead.`);
        const conflicts = await tx.booking.findMany({ where: { courtId: input.courtId, status: { in: ACTIVE_BOOKING_STATUSES }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } }, select: { reference: true, startsAt: true, endsAt: true } });
        const conflict = findTimeConflict(conflicts, startsAt, endsAt);
        if (conflict) throw new AppError(409, "Court is already booked for this time.");
        const openPlayConflict = await tx.openPlay.findFirst({ where: { courtId: input.courtId, status: { in: ["OPEN", "FILLED", "CONFIRMED"] }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } });
        if (openPlayConflict) throw new AppError(409, "This court is reserved for an open-play session at that time.");

        const customer = await tx.customer.findUnique({
          where: { id: input.customerId },
          include: { user: { select: { id: true, firstName: true, lastName: true } } }
        });
        if (!customer || customer.deletedAt) throw new AppError(404, "Customer account not found.");
        const membership = await tx.membership.findFirst({ where: { customerId: input.customerId, status: "ACTIVE", startDate: { lte: startsAt }, endDate: { gte: startsAt } }, include: { plan: true }, orderBy: { endDate: "desc" } });
        if (membership && membership.plan.maximumBookings !== null) {
          const usedBookings = await tx.booking.count({ where: { membershipId: membership.id, status: { notIn: ["CANCELLED", "REFUNDED", "NO_SHOW"] } } });
          if (hasReachedBookingLimit(membership.plan.maximumBookings, usedBookings)) throw new AppError(400, `Your ${membership.plan.name} membership has reached its ${membership.plan.maximumBookings}-booking limit.`);
        }
        const packagePurchase = input.packagePurchaseId ? await tx.packagePurchase.findFirst({ where: { id: input.packagePurchaseId, customerId: input.customerId, status: "ACTIVE", creditsRemaining: { gt: 0 }, startsAt: { lte: startsAt }, expiresAt: { gte: startsAt } }, include: { packagePlan: true } }) : null;
        if (input.packagePurchaseId && !packagePurchase) throw new AppError(400, "The selected booking package is inactive, expired, or has no credits remaining.");
        if (packagePurchase && input.promoCode?.trim()) throw new AppError(400, "Promo codes cannot be combined with booking package credit.");
        const leadHours = (startsAt.getTime() - Date.now()) / 3_600_000;
        const pricingRules = await tx.dynamicPricingRule.findMany({ where: { isActive: true, OR: [{ courtId: null }, { courtId: input.courtId }], AND: [{ OR: [{ weekday: null }, { weekday }] }], startTime: { lte: input.startTime }, endTime: { gt: input.startTime } } });
        const pricingRule = selectPricingRule(pricingRules, leadHours);
        const adjustmentPercent = pricingRule ? Number(pricingRule.adjustmentPercent) : 0;
        const effectiveHourlyRate = Math.max(0, Number(court.hourlyRate) * (1 + adjustmentPercent / 100));
        const baseSubtotal = effectiveHourlyRate * (input.durationMinutes / 60);
        let promoDiscountPercent: number | undefined;
        let promoFixedDiscount: number | undefined;
        let appliedPromoCode: string | undefined;
        if (input.promoCode?.trim()) {
          const code = input.promoCode.trim().toUpperCase();
          // Serialize uses of a promo code so its usage limit remains correct
          // when multiple customers submit bookings at the same time.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${code}))`;
          const promotion = await tx.promotion.findUnique({ where: { code } });
          const evaluation = evaluatePromotionForBooking(promotion, { subtotal: baseSubtotal, courtId: input.courtId, membershipPlanId: membership?.planId });
          if (!evaluation.valid) throw new AppError(400, evaluation.message);
          promoDiscountPercent = evaluation.promotion.discountPercent ?? undefined;
          promoFixedDiscount = evaluation.promotion.fixedDiscount ?? undefined;
          appliedPromoCode = evaluation.promotion.code;
        }
        const pricing = calculateBookingTotals({ hourlyRate: effectiveHourlyRate, durationMinutes: input.durationMinutes, taxRate: rules.taxRate, membershipDiscountPercent: membership ? Number(membership.plan.discountPercent) : undefined, promoDiscountPercent, promoFixedDiscount });
        const subtotal = pricing.subtotal;
        const discount = packagePurchase ? subtotal : pricing.discount;
        const tax = packagePurchase ? 0 : pricing.tax;
        const total = packagePurchase ? 0 : pricing.total;
        const { walletApplied, amountDue } = calculateCreditCheckout(total, Number(customer.walletBalance), Number(input.walletAmount ?? 0), Boolean(packagePurchase));
        const bookingStatus: BookingStatus = amountDue === 0 ? "CONFIRMED" : "PENDING";
        const prefix = `PB-${input.date.slice(0, 4)}-`;
        const count = await tx.booking.count({ where: { reference: { startsWith: prefix } } });
        const reference = `${prefix}${String(count + 1 + attempt).padStart(6, "0")}`;
        const booking = await tx.booking.create({
          data: { reference, customerId: input.customerId, courtId: input.courtId, membershipId: membership?.id, packagePurchaseId: packagePurchase?.id, createdById: input.createdById, startsAt, endsAt, durationMinutes: input.durationMinutes, status: bookingStatus, subtotal, discount, tax, total, promoCode: appliedPromoCode, items: { create: { itemType: "COURT", description: `${court.name}${pricingRule ? ` · ${pricingRule.name}` : ""}${packagePurchase ? ` · ${packagePurchase.packagePlan.name}` : ""}`, quantity: 1, unitPrice: effectiveHourlyRate * (input.durationMinutes / 60), total: subtotal } }, ...(amountDue > 0 ? { payments: { create: { customerId: input.customerId, membershipId: membership?.id, packagePurchaseId: packagePurchase?.id, recordedById: input.createdById, amount: subtotal, discount: discount + walletApplied, tax, finalAmount: amountDue, method: input.paymentMethod, transactionReference: input.transactionReference || null, status: "PENDING" } } } : {}) },
          include: { court: true, payments: true }
        });
        if (packagePurchase) {
          const remaining = packagePurchase.creditsRemaining - 1;
          await tx.packagePurchase.update({ where: { id: packagePurchase.id }, data: { creditsRemaining: { decrement: 1 }, ...(remaining === 0 ? { status: "EXHAUSTED" as const } : {}) } });
        }
        if (walletApplied > 0) {
          const balanceAfter = Number(customer.walletBalance) - walletApplied;
          await tx.customer.update({ where: { id: customer.id }, data: { walletBalance: balanceAfter, lastActivityAt: new Date() } });
          await tx.walletTransaction.create({ data: { customerId: customer.id, type: "DEBIT", amount: walletApplied, balanceAfter, description: `Applied to booking ${reference}`, reference } });
        } else await tx.customer.update({ where: { id: customer.id }, data: { lastActivityAt: new Date() } });
        if (bookingStatus === "CONFIRMED") await tx.bookingAccessPass.create({ data: { bookingId: booking.id, validFrom: new Date(startsAt.getTime() - 30 * 60_000), validUntil: new Date(endsAt.getTime() + 30 * 60_000) } });
        if (appliedPromoCode) {
          const promotion = await tx.promotion.findUniqueOrThrow({ where: { code: appliedPromoCode } });
          const updatedPromotion = await tx.promotion.updateMany({ where: { id: promotion.id, OR: [{ usageLimit: null }, { usedCount: { lt: promotion.usageLimit ?? 0 } }] }, data: { usedCount: { increment: 1 } } });
          if (updatedPromotion.count !== 1) throw new AppError(409, "This promo code has reached its usage limit.");
          await tx.promotionUsage.create({ data: { promotionId: promotion.id, customerId: input.customerId, bookingId: booking.id } });
        }
        const schedule = new Intl.DateTimeFormat("en-PH", {
          timeZone: "Asia/Manila",
          dateStyle: "medium",
          timeStyle: "short"
        }).format(startsAt);
        const endTime = new Intl.DateTimeFormat("en-PH", {
          timeZone: "Asia/Manila",
          hour: "numeric",
          minute: "2-digit"
        }).format(endsAt);
        const durationHours = Math.floor(input.durationMinutes / 60);
        const durationRemainder = input.durationMinutes % 60;
        const durationLabel = durationHours === 0
          ? `${durationRemainder} minutes`
          : durationRemainder === 0
            ? `${durationHours} hour${durationHours === 1 ? "" : "s"}`
            : `${durationHours} hour${durationHours === 1 ? "" : "s"} ${durationRemainder} minutes`;
        await tx.notification.create({ data: { userId: customer.userId, customerId: input.customerId, type: "BOOKING", title: bookingStatus === "CONFIRMED" ? "Booking confirmed with club credit" : "Booking request received", message: bookingStatus === "CONFIRMED" ? `${booking.reference} for ${court.name} on ${schedule}–${endTime} (${durationLabel}) is confirmed. Your access pass is ready.` : `${booking.reference} for ${court.name} on ${schedule}–${endTime} (${durationLabel}) is pending confirmation.`, actionUrl: "/app/bookings", channel: "IN_APP" } });

        const operationsUsers = await tx.user.findMany({
          where: {
            id: { not: customer.userId },
            status: "ACTIVE",
            roles: { some: { role: { code: { in: ["SUPER_ADMIN", "ADMIN", "STAFF"] } } } }
          },
          select: { id: true }
        });
        if (operationsUsers.length > 0 && amountDue > 0) {
          const paymentMethod = input.paymentMethod.replaceAll("_", " ").toLowerCase();
          const customerName = `${customer.user.firstName} ${customer.user.lastName}`;
          await tx.notification.createMany({
            data: operationsUsers.map(({ id }) => ({
              userId: id,
              type: "PAYMENT" as const,
              title: "New booking awaiting payment",
              message: `${booking.reference} from ${customerName} for ${court.name} on ${schedule}–${endTime} (${durationLabel}). ${rules.currency} ${amountDue.toLocaleString("en-PH", { minimumFractionDigits: 2 })} via ${paymentMethod} requires confirmation.`,
              actionUrl: "/app/payments",
              channel: "IN_APP" as const
            }))
          });
        }
        await tx.auditLog.create({ data: { userId: input.createdById, action: "BOOKING_CREATED", entity: "Booking", entityId: booking.id, metadata: { reference: booking.reference, pricingRule: pricingRule?.name, adjustmentPercent, packagePurchaseId: packagePurchase?.id, walletApplied } } });
        return serializeBooking(booking);
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
        if (attempt < 4) {
          await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
          continue;
        }
        if (error.code === "P2034") throw new AppError(409, "Court availability changed while the booking was being processed. Please choose another time.");
      }
      throw error;
    }
  }
  throw new AppError(409, "Unable to create a unique booking reference. Please try again.");
}

export { getRules, getManilaDate, serializeBooking };
