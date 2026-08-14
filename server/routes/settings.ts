import { Router } from "express";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";

export const settingsRouter = Router();
settingsRouter.get("/public", async (_req, res, next) => {
  try {
    const keys = ["business_name", "business_logo", "business_address", "business_phone", "business_email", "business_hours", "currency", "timezone"];
    const rows = await prisma.businessSetting.findMany({ where: { key: { in: keys } } });
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    const configuredBusinessName = typeof values.business_name === "string" ? values.business_name.trim() : "";
    res.json({ success: true, data: { businessName: configuredBusinessName || "Rally Court Club", logoUrl: typeof values.business_logo === "string" && values.business_logo.startsWith("data:image/") ? values.business_logo : "", address: typeof values.business_address === "string" ? values.business_address : "Metro Manila, Philippines", phone: typeof values.business_phone === "string" ? values.business_phone : "", email: typeof values.business_email === "string" ? values.business_email : "", businessHours: typeof values.business_hours === "string" ? values.business_hours : "Daily 6:00 AM–10:00 PM", currency: typeof values.currency === "string" ? values.currency : "PHP", timezone: typeof values.timezone === "string" ? values.timezone : "Asia/Manila" } });
  } catch (error) { next(error); }
});
settingsRouter.use(authenticate);

function normalizedTaxRate(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0.12;
  return numeric > 1 ? numeric / 100 : numeric;
}

settingsRouter.get("/booking", async (_req, res, next) => {
  try {
    const rows = await prisma.businessSetting.findMany({
      where: {
        key: {
          in: [
            "currency",
            "tax_rate",
            "minimum_booking_minutes",
            "maximum_booking_minutes",
            "minimum_advance_minutes",
            "maximum_advance_days"
          ]
        }
      }
    });
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    const numericSetting = (key: string, fallback: number) => {
      const numeric = Number(values[key]);
      return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
    };
    res.json({
      success: true,
      data: {
        currency: typeof values.currency === "string" ? values.currency : "PHP",
        taxRate: normalizedTaxRate(values.tax_rate),
        minimumBookingMinutes: numericSetting("minimum_booking_minutes", 60),
        maximumBookingMinutes: numericSetting("maximum_booking_minutes", 180),
        minimumAdvanceMinutes: numericSetting("minimum_advance_minutes", 60),
        maximumAdvanceDays: numericSetting("maximum_advance_days", 30),
        slotIntervalMinutes: 30
      }
    });
  } catch (error) { next(error); }
});
