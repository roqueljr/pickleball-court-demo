import assert from "node:assert/strict";
import { calculateBookingTotals, canRescheduleBooking, findTimeConflict, hasTimeConflict, isWithinRefundWindow } from "../server/utils/bookingRules.ts";
import { canCancelBooking, canConfirmPayment, canRefundPayment, getRefundStatus, hasReachedBookingLimit, isMembershipActive } from "../server/utils/membershipRules.ts";
import { isValidCalendarRange, manilaDateKey } from "../server/utils/calendarRules.ts";
import { calculateCreditCheckout, calculateLocalRatingUpdate, selectPricingRule } from "../server/utils/growthRules.ts";
import { businessLogoRequirements, courtImageRequirements, validateBusinessLogo, validateCourtImage } from "../server/utils/imageValidation.ts";
import { evaluatePromotionForBooking } from "../server/utils/promotionRules.ts";

const oneHour = calculateBookingTotals({ hourlyRate: 650, durationMinutes: 60, taxRate: 0.12 });
assert.deepEqual(oneHour, { subtotal: 650, discount: 0, tax: 78, total: 728 });

const stackedDiscount = calculateBookingTotals({ hourlyRate: 650, durationMinutes: 60, taxRate: 0.12, membershipDiscountPercent: 20, promoDiscountPercent: 10 });
assert.deepEqual(stackedDiscount, { subtotal: 650, discount: 195, tax: 54.6, total: 509.6 });

const cappedDiscount = calculateBookingTotals({ hourlyRate: 500, durationMinutes: 60, taxRate: 0.12, promoFixedDiscount: 900 });
assert.deepEqual(cappedDiscount, { subtotal: 500, discount: 500, tax: 0, total: 0 });

const activePromotion = { id: "promo-1", code: "PICKLE10", discountPercent: 10, fixedDiscount: null, startDate: new Date("2026-08-01T00:00:00.000Z"), endDate: new Date("2026-08-31T23:59:59.000Z"), usageLimit: 100, usedCount: 5, minimumPurchase: 500, applicableCourtIds: ["court-1"], applicablePlanIds: ["plan-gold"], isActive: true };
const validPromotion = evaluatePromotionForBooking(activePromotion, { subtotal: 650, courtId: "court-1", membershipPlanId: "plan-gold", now: new Date("2026-08-14T00:00:00.000Z") });
assert.equal(validPromotion.valid, true);
if (validPromotion.valid) assert.deepEqual(validPromotion.promotion, { id: "promo-1", code: "PICKLE10", discountPercent: 10, fixedDiscount: null, minimumPurchase: 500, remainingUses: 95 });
assert.equal(evaluatePromotionForBooking(activePromotion, { subtotal: 400, courtId: "court-1", membershipPlanId: "plan-gold", now: new Date("2026-08-14T00:00:00.000Z") }).valid, false);
assert.equal(evaluatePromotionForBooking(activePromotion, { subtotal: 650, courtId: "court-2", membershipPlanId: "plan-gold", now: new Date("2026-08-14T00:00:00.000Z") }).valid, false);
assert.equal(evaluatePromotionForBooking(activePromotion, { subtotal: 650, courtId: "court-1", membershipPlanId: "plan-silver", now: new Date("2026-08-14T00:00:00.000Z") }).valid, false);
assert.equal(evaluatePromotionForBooking({ ...activePromotion, usedCount: 100 }, { subtotal: 650, courtId: "court-1", membershipPlanId: "plan-gold", now: new Date("2026-08-14T00:00:00.000Z") }).valid, false);

const existing = { startsAt: new Date("2026-08-14T10:00:00.000Z"), endsAt: new Date("2026-08-14T11:00:00.000Z") };
assert.equal(hasTimeConflict(existing, new Date("2026-08-14T10:30:00.000Z"), new Date("2026-08-14T11:30:00.000Z")), true);
assert.equal(hasTimeConflict(existing, new Date("2026-08-14T11:00:00.000Z"), new Date("2026-08-14T12:00:00.000Z")), false);

const threeHourBooking = { startsAt: new Date("2026-08-15T02:00:00.000Z"), endsAt: new Date("2026-08-15T05:00:00.000Z") };
assert.equal(hasTimeConflict(threeHourBooking, new Date("2026-08-15T01:30:00.000Z"), new Date("2026-08-15T04:30:00.000Z")), true);
assert.equal(hasTimeConflict(threeHourBooking, new Date("2026-08-14T23:00:00.000Z"), new Date("2026-08-15T02:00:00.000Z")), false);
assert.equal(hasTimeConflict(threeHourBooking, new Date("2026-08-15T05:00:00.000Z"), new Date("2026-08-15T08:00:00.000Z")), false);
assert.equal(findTimeConflict([existing, threeHourBooking], new Date("2026-08-15T01:30:00.000Z"), new Date("2026-08-15T04:30:00.000Z")), threeHourBooking);

const rescheduleStart = new Date("2026-08-15T02:30:00.000Z");
assert.equal(canRescheduleBooking("PENDING", rescheduleStart, new Date("2026-08-15T02:29:00.000Z")), true);
assert.equal(canRescheduleBooking("CONFIRMED", rescheduleStart, new Date("2026-08-15T02:29:00.000Z")), true);
assert.equal(canRescheduleBooking("CHECKED_IN", rescheduleStart, new Date("2026-08-15T02:20:00.000Z")), true);
assert.equal(canRescheduleBooking("CHECKED_IN", rescheduleStart, new Date("2026-08-15T02:25:00.000Z")), false);
assert.equal(canRescheduleBooking("COMPLETED", rescheduleStart, new Date("2026-08-15T02:20:00.000Z")), false);

const bookingCreatedAt = new Date("2026-08-13T06:00:00.000Z");
assert.equal(isWithinRefundWindow(bookingCreatedAt, new Date("2026-08-13T12:00:00.000Z"), 6), true);
assert.equal(isWithinRefundWindow(bookingCreatedAt, new Date("2026-08-13T12:00:01.000Z"), 6), false);

const now = new Date("2026-08-13T12:00:00.000Z");
assert.equal(isMembershipActive({ status: "ACTIVE", startDate: new Date("2026-08-01T00:00:00.000Z"), endDate: new Date("2026-08-31T23:59:59.000Z") }, now), true);
assert.equal(isMembershipActive({ status: "PENDING", startDate: new Date("2026-08-01T00:00:00.000Z"), endDate: new Date("2026-08-31T23:59:59.000Z") }, now), false);
assert.equal(isMembershipActive({ status: "ACTIVE", startDate: new Date("2026-08-14T00:00:00.000Z"), endDate: new Date("2026-08-31T23:59:59.000Z") }, now), false);
assert.equal(hasReachedBookingLimit(5, 4), false);
assert.equal(hasReachedBookingLimit(5, 5), true);
assert.equal(hasReachedBookingLimit(null, 100), false);
assert.equal(canConfirmPayment("PENDING", true), true);
assert.equal(canConfirmPayment("PAID", true), false);
assert.equal(canConfirmPayment("PENDING", false), false);
assert.equal(canCancelBooking("PENDING"), true);
assert.equal(canCancelBooking("CONFIRMED"), true);
assert.equal(canCancelBooking("CHECKED_IN"), false);
assert.equal(canCancelBooking("NO_SHOW"), false);
assert.equal(canRefundPayment("PAID"), true);
assert.equal(canRefundPayment("PENDING"), false);
assert.deepEqual(getRefundStatus("PAID", 1000, 0, 400), { valid: true, status: "PARTIALLY_REFUNDED" });
assert.deepEqual(getRefundStatus("PAID", 1000, 400, 600), { valid: true, status: "REFUNDED" });
assert.equal(getRefundStatus("PAID", 1000, 900, 200).valid, false);
assert.equal(getRefundStatus("PENDING", 1000, 0, 100).valid, false);

assert.equal(manilaDateKey(new Date("2026-08-13T16:30:00.000Z")), "2026-08-14");
assert.equal(manilaDateKey(new Date("2026-08-14T23:30:00.000Z")), "2026-08-15");
assert.equal(isValidCalendarRange(new Date("2026-08-01T16:00:00.000Z"), new Date("2026-09-12T16:00:00.000Z")), true);
assert.equal(isValidCalendarRange(new Date("2026-08-01T16:00:00.000Z"), new Date("2026-10-03T16:00:01.000Z")), false);

assert.deepEqual(calculateCreditCheckout(728, 500, 300, false), { walletApplied: 300, amountDue: 428 });
assert.deepEqual(calculateCreditCheckout(728, 1000, 900, false), { walletApplied: 728, amountDue: 0 });
assert.deepEqual(calculateCreditCheckout(728, 500, 300, true), { walletApplied: 0, amountDue: 0 });
const rules = [
  { id: "global", courtId: null, adjustmentPercent: -20, minimumLeadHours: null, maximumLeadHours: null },
  { id: "court", courtId: "court-1", adjustmentPercent: 10, minimumLeadHours: 2, maximumLeadHours: 24 },
  { id: "late", courtId: "court-1", adjustmentPercent: -30, minimumLeadHours: null, maximumLeadHours: 1 }
];
assert.equal(selectPricingRule(rules, 12)?.id, "court");
assert.equal(selectPricingRule(rules, 0.5)?.id, "late");
const ratingUpdate = calculateLocalRatingUpdate(3, 3, true);
assert.equal(ratingUpdate.home > 3, true);
assert.equal(ratingUpdate.away < 3, true);
assert.equal(Math.round((ratingUpdate.home + ratingUpdate.away) * 100), 600);

const logoPng = Buffer.alloc(24);
Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(logoPng, 0);
logoPng.write("IHDR", 12, "ascii");
logoPng.writeUInt32BE(businessLogoRequirements.width, 16);
logoPng.writeUInt32BE(businessLogoRequirements.height, 20);
const validLogo = `data:image/png;base64,${logoPng.toString("base64")}`;
assert.equal(validateBusinessLogo(validLogo), validLogo);
assert.equal(validateBusinessLogo(""), "");
logoPng.writeUInt32BE(256, 16);
assert.throws(() => validateBusinessLogo(`data:image/png;base64,${logoPng.toString("base64")}`), /512×512/);

const courtPng = Buffer.alloc(24);
Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(courtPng, 0);
courtPng.write("IHDR", 12, "ascii");
courtPng.writeUInt32BE(courtImageRequirements.width, 16);
courtPng.writeUInt32BE(courtImageRequirements.height, 20);
const validCourtImage = `data:image/png;base64,${courtPng.toString("base64")}`;
assert.equal(validateCourtImage(validCourtImage), validCourtImage);
assert.equal(validateCourtImage("https://example.com/court.webp"), "https://example.com/court.webp");
courtPng.writeUInt32BE(640, 16);
assert.throws(() => validateCourtImage(`data:image/png;base64,${courtPng.toString("base64")}`), /1280/);

console.log("Business rules tests passed: 53 assertions.");
