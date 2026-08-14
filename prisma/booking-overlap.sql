-- Apply this SQL after the Prisma migration to make PostgreSQL reject overlapping
-- court bookings at the database layer. The service layer still returns a friendly
-- conflict error before attempting the write.
CREATE EXTENSION IF NOT EXISTS btree_gist;
DO $$
BEGIN
  IF to_regclass('"Booking"') IS NULL THEN
    RAISE EXCEPTION 'Booking table does not exist. Run npm run db:push before applying this constraint.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_no_overlap') THEN
    ALTER TABLE "Booking"
      ADD CONSTRAINT "booking_no_overlap"
      EXCLUDE USING gist (
        "courtId" WITH =,
        tsrange("startsAt", "endsAt", '[)') WITH &&
      )
      WHERE ("status" IN ('PENDING', 'CONFIRMED', 'CHECKED_IN'));
  END IF;

  IF to_regclass('"OpenPlay"') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'open_play_no_overlap') THEN
    ALTER TABLE "OpenPlay"
      ADD CONSTRAINT "open_play_no_overlap"
      EXCLUDE USING gist (
        "courtId" WITH =,
        tsrange("startsAt", "endsAt", '[)') WITH &&
      )
      WHERE ("status" IN ('OPEN', 'FILLED', 'CONFIRMED'));
  END IF;
END $$;
