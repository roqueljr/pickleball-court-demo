export type PromotionForBooking = {
  id: string;
  code: string;
  discountPercent: unknown;
  fixedDiscount: unknown;
  startDate: Date;
  endDate: Date;
  usageLimit: number | null;
  usedCount: number;
  minimumPurchase: unknown;
  applicableCourtIds: unknown;
  applicablePlanIds: unknown;
  isActive: boolean;
};

export type PromotionContext = {
  subtotal: number;
  courtId: string;
  membershipPlanId?: string;
  now?: Date;
};

export type PromotionEvaluation =
  | { valid: false; message: string }
  | {
      valid: true;
      promotion: {
        id: string;
        code: string;
        discountPercent: number | null;
        fixedDiscount: number | null;
        minimumPurchase: number;
        remainingUses: number | null;
      };
    };

function stringIds(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function evaluatePromotionForBooking(promotion: PromotionForBooking | null, context: PromotionContext): PromotionEvaluation {
  if (!promotion) return { valid: false, message: "Promotion code was not found." };
  const now = context.now ?? new Date();
  if (!promotion.isActive) return { valid: false, message: "This promotion is no longer active." };
  if (promotion.startDate > now) return { valid: false, message: "This promotion has not started yet." };
  if (promotion.endDate < now) return { valid: false, message: "This promotion has expired." };
  if (promotion.usageLimit !== null && promotion.usedCount >= promotion.usageLimit) return { valid: false, message: "This promotion has reached its usage limit." };

  const minimumPurchase = Number(promotion.minimumPurchase);
  if (context.subtotal < minimumPurchase) {
    return { valid: false, message: `This promotion requires a minimum court purchase of PHP ${minimumPurchase.toLocaleString("en-PH", { minimumFractionDigits: 2 })}.` };
  }

  const courtIds = stringIds(promotion.applicableCourtIds);
  if (courtIds.length > 0 && !courtIds.includes(context.courtId)) return { valid: false, message: "This promotion does not apply to the selected court." };

  const planIds = stringIds(promotion.applicablePlanIds);
  if (planIds.length > 0 && (!context.membershipPlanId || !planIds.includes(context.membershipPlanId))) {
    return { valid: false, message: "This promotion requires an eligible active membership plan." };
  }

  const discountPercent = promotion.discountPercent === null ? null : Number(promotion.discountPercent);
  const fixedDiscount = promotion.fixedDiscount === null ? null : Number(promotion.fixedDiscount);
  if (discountPercent === null && fixedDiscount === null) return { valid: false, message: "This promotion does not have a valid discount configured." };

  return {
    valid: true,
    promotion: {
      id: promotion.id,
      code: promotion.code,
      discountPercent,
      fixedDiscount,
      minimumPurchase,
      remainingUses: promotion.usageLimit === null ? null : Math.max(0, promotion.usageLimit - promotion.usedCount)
    }
  };
}
