import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { AppError } from "../utils/errors.js";

export const promotionsRouter = Router();
promotionsRouter.use(authenticate, authorize("SUPER_ADMIN", "ADMIN"));

const nullablePercent = z.union([z.coerce.number().min(0).max(100), z.null()]);
const nullableMoney = z.union([z.coerce.number().nonnegative(), z.null()]);
const promotionFields = z.object({
  code: z.string().trim().toUpperCase().min(3).max(30),
  discountPercent: nullablePercent.optional(),
  fixedDiscount: nullableMoney.optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  usageLimit: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
  minimumPurchase: z.coerce.number().nonnegative().default(0),
  applicableCourtIds: z.array(z.string()).max(100).optional(),
  applicablePlanIds: z.array(z.string()).max(100).optional(),
  isActive: z.boolean().default(true)
});

const promotionInput = promotionFields
  .refine((value) => (value.discountPercent != null) !== (value.fixedDiscount != null), { message: "Provide either a percentage discount or a fixed discount, not both." })
  .refine((value) => value.endDate > value.startDate, { message: "Promotion end date must be after its start date." });
const promotionUpdateInput = promotionFields.partial();

type PromotionRecord = {
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

function serializePromotion(promotion: PromotionRecord) {
  return {
    ...promotion,
    discountPercent: promotion.discountPercent === null ? null : Number(promotion.discountPercent),
    fixedDiscount: promotion.fixedDiscount === null ? null : Number(promotion.fixedDiscount),
    minimumPurchase: Number(promotion.minimumPurchase),
    applicableCourtIds: Array.isArray(promotion.applicableCourtIds) ? promotion.applicableCourtIds : [],
    applicablePlanIds: Array.isArray(promotion.applicablePlanIds) ? promotion.applicablePlanIds : [],
    startDate: promotion.startDate.toISOString(),
    endDate: promotion.endDate.toISOString()
  };
}

async function validateScopes(courtIds: string[] | undefined, planIds: string[] | undefined) {
  if (courtIds) {
    const count = await prisma.court.count({ where: { id: { in: courtIds }, deletedAt: null } });
    if (count !== new Set(courtIds).size) throw new AppError(400, "One or more selected courts are unavailable.");
  }
  if (planIds) {
    const count = await prisma.membershipPlan.count({ where: { id: { in: planIds } } });
    if (count !== new Set(planIds).size) throw new AppError(400, "One or more selected membership plans are unavailable.");
  }
}

promotionsRouter.get("/", async (_req, res, next) => {
  try {
    const promotions = await prisma.promotion.findMany({ orderBy: { startDate: "desc" } });
    res.json({ success: true, data: { promotions: promotions.map(serializePromotion) } });
  } catch (error) { next(error); }
});

promotionsRouter.post("/", async (req, res, next) => {
  try {
    const input = promotionInput.parse(req.body);
    await validateScopes(input.applicableCourtIds, input.applicablePlanIds);
    const promotion = await prisma.promotion.create({ data: input as Prisma.PromotionCreateInput });
    res.status(201).json({ success: true, data: { promotion: serializePromotion(promotion) } });
  } catch (error) { next(error); }
});

promotionsRouter.put("/:id", async (req, res, next) => {
  try {
    const input = promotionUpdateInput.parse(req.body);
    const existing = await prisma.promotion.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) throw new AppError(404, "Promotion not found.");
    const discountPercent = input.discountPercent !== undefined ? input.discountPercent : input.fixedDiscount != null ? null : existing.discountPercent;
    const fixedDiscount = input.fixedDiscount !== undefined ? input.fixedDiscount : input.discountPercent != null ? null : existing.fixedDiscount;
    if ((discountPercent != null) === (fixedDiscount != null)) throw new AppError(400, "Provide either a percentage discount or a fixed discount, not both.");
    const startDate = input.startDate ?? existing.startDate;
    const endDate = input.endDate ?? existing.endDate;
    if (endDate <= startDate) throw new AppError(400, "Promotion end date must be after its start date.");
    await validateScopes(input.applicableCourtIds, input.applicablePlanIds);
    const promotion = await prisma.promotion.update({
      where: { id: existing.id },
      data: { ...input, discountPercent, fixedDiscount } as Prisma.PromotionUpdateInput
    });
    res.json({ success: true, data: { promotion: serializePromotion(promotion) } });
  } catch (error) { next(error); }
});

promotionsRouter.delete("/:id", async (req, res, next) => {
  try {
    const promotion = await prisma.promotion.update({ where: { id: String(req.params.id) }, data: { isActive: false } });
    res.json({ success: true, data: { promotion: serializePromotion(promotion) } });
  } catch (error) { next(error); }
});
