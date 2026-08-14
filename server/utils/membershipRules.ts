export type MembershipWindow = {
  status: string;
  startDate: Date;
  endDate: Date;
};

export function isMembershipActive(membership: MembershipWindow, at = new Date()) {
  return membership.status === "ACTIVE" && membership.startDate.getTime() <= at.getTime() && membership.endDate.getTime() >= at.getTime();
}

export function hasReachedBookingLimit(maximumBookings: number | null, usedBookings: number) {
  return maximumBookings !== null && usedBookings >= maximumBookings;
}

export function canConfirmPayment(paymentStatus: string, linkedEntity: boolean) {
  return paymentStatus === "PENDING" && linkedEntity;
}

export function canCancelBooking(status: string) {
  return status === "PENDING" || status === "CONFIRMED";
}

export function canRefundPayment(status: string) {
  return status === "PAID" || status === "PARTIALLY_REFUNDED";
}

export function getRefundStatus(paymentStatus: string, paidAmount: number, refundedAmount: number, requestedAmount: number) {
  if (!canRefundPayment(paymentStatus)) return { valid: false, status: paymentStatus, reason: "Only paid payments can be refunded." } as const;
  if (requestedAmount <= 0) return { valid: false, status: paymentStatus, reason: "Refund amount must be greater than zero." } as const;
  if (refundedAmount + requestedAmount > paidAmount) return { valid: false, status: paymentStatus, reason: "Refund exceeds the remaining refundable amount." } as const;
  return { valid: true, status: refundedAmount + requestedAmount === paidAmount ? "REFUNDED" : "PARTIALLY_REFUNDED" } as const;
}
