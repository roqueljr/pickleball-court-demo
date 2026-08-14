export type PricingInput = {
  hourlyRate: number;
  durationMinutes: number;
  taxRate: number;
  membershipDiscountPercent?: number;
  promoDiscountPercent?: number;
  promoFixedDiscount?: number;
};

export function roundMoney(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }

export function calculateBookingTotals(input: PricingInput) {
  const subtotal = roundMoney(input.hourlyRate * (input.durationMinutes / 60));
  const membershipDiscount = subtotal * ((input.membershipDiscountPercent ?? 0) / 100);
  const promoDiscount = input.promoDiscountPercent !== undefined ? subtotal * (input.promoDiscountPercent / 100) : input.promoFixedDiscount ?? 0;
  const discount = Math.min(subtotal, roundMoney(membershipDiscount + promoDiscount));
  const taxable = roundMoney(Math.max(0, subtotal - discount));
  const tax = roundMoney(taxable * input.taxRate);
  return { subtotal, discount, tax, total: roundMoney(taxable + tax) };
}

export function hasTimeConflict(existing: { startsAt: Date; endsAt: Date }, startsAt: Date, endsAt: Date) {
  return existing.startsAt < endsAt && existing.endsAt > startsAt;
}

export function findTimeConflict<T extends { startsAt: Date; endsAt: Date }>(existing: T[], startsAt: Date, endsAt: Date) {
  return existing.find((interval) => hasTimeConflict(interval, startsAt, endsAt));
}

export const CHECKED_IN_RESCHEDULE_CUTOFF_MINUTES = 5;

export function canRescheduleBooking(status: string, startsAt: Date, now: Date, checkedInCutoffMinutes = CHECKED_IN_RESCHEDULE_CUTOFF_MINUTES) {
  if (["PENDING", "CONFIRMED"].includes(status)) return true;
  if (status !== "CHECKED_IN" || !Number.isFinite(checkedInCutoffMinutes) || checkedInCutoffMinutes < 0) return false;
  return startsAt.getTime() - now.getTime() > checkedInCutoffMinutes * 60_000;
}

export function isWithinRefundWindow(createdAt: Date, now: Date, refundWindowHours: number) {
  if (!Number.isFinite(refundWindowHours) || refundWindowHours < 0) return false;
  const elapsedHours = (now.getTime() - createdAt.getTime()) / 3_600_000;
  return elapsedHours >= 0 && elapsedHours <= refundWindowHours;
}
