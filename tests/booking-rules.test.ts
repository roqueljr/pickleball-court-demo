import { describe, expect, it } from "vitest";
import { calculateBookingTotals, canRescheduleBooking, hasTimeConflict } from "../server/utils/bookingRules";

describe("booking pricing rules", () => {
  it("calculates a one-hour booking with tax", () => {
    expect(calculateBookingTotals({ hourlyRate: 650, durationMinutes: 60, taxRate: 0.12 })).toEqual({ subtotal: 650, discount: 0, tax: 78, total: 728 });
  });

  it("stacks membership and percentage promotion discounts", () => {
    expect(calculateBookingTotals({ hourlyRate: 650, durationMinutes: 60, taxRate: 0.12, membershipDiscountPercent: 20, promoDiscountPercent: 10 })).toEqual({ subtotal: 650, discount: 195, tax: 54.6, total: 509.6 });
  });

  it("never discounts below zero", () => {
    expect(calculateBookingTotals({ hourlyRate: 500, durationMinutes: 60, taxRate: 0.12, promoFixedDiscount: 900 })).toEqual({ subtotal: 500, discount: 500, tax: 0, total: 0 });
  });
});

describe("court booking overlap", () => {
  const existing = { startsAt: new Date("2026-08-14T10:00:00.000Z"), endsAt: new Date("2026-08-14T11:00:00.000Z") };
  it("detects overlapping intervals", () => { expect(hasTimeConflict(existing, new Date("2026-08-14T10:30:00.000Z"), new Date("2026-08-14T11:30:00.000Z"))).toBe(true); });
  it("allows an adjacent interval", () => { expect(hasTimeConflict(existing, new Date("2026-08-14T11:00:00.000Z"), new Date("2026-08-14T12:00:00.000Z"))).toBe(false); });
});

describe("checked-in rescheduling", () => {
  const startsAt = new Date("2026-08-15T02:30:00.000Z");
  it("allows an early checked-in reschedule with more than five minutes remaining", () => {
    expect(canRescheduleBooking("CHECKED_IN", startsAt, new Date("2026-08-15T02:20:00.000Z"))).toBe(true);
  });
  it("rejects a checked-in reschedule at the five-minute cutoff", () => {
    expect(canRescheduleBooking("CHECKED_IN", startsAt, new Date("2026-08-15T02:25:00.000Z"))).toBe(false);
  });
});
