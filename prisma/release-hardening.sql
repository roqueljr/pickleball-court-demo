-- Additive follow-up release for equipment return tracking and coaching payments.
-- Run only as a fallback if Prisma cannot apply the schema in an existing database.
-- This script is idempotent and does not delete or replace business data.
BEGIN;

DO $$
BEGIN
  IF to_regclass('"EquipmentRental"') IS NOT NULL THEN
    ALTER TABLE "EquipmentRental" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'RESERVED';
    ALTER TABLE "EquipmentRental" ADD COLUMN IF NOT EXISTS "returnedAt" TIMESTAMP(3);
    ALTER TABLE "EquipmentRental" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE "EquipmentRental" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    CREATE INDEX IF NOT EXISTS "EquipmentRental_bookingId_status_idx" ON "EquipmentRental"("bookingId", "status");
    CREATE INDEX IF NOT EXISTS "EquipmentRental_equipmentId_status_idx" ON "EquipmentRental"("equipmentId", "status");
  END IF;
END $$;

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "coachingSessionId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_coachingSessionId_key" ON "Payment"("coachingSessionId");
DO $$
BEGIN
  IF to_regclass('"CoachingSession"') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Payment_coachingSessionId_fkey') THEN
    ALTER TABLE "Payment"
      ADD CONSTRAINT "Payment_coachingSessionId_fkey"
      FOREIGN KEY ("coachingSessionId") REFERENCES "CoachingSession"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
