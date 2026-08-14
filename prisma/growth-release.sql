-- Additive PostgreSQL release for the Growth Center models.
-- This mirrors prisma/schema.prisma and is safe to rerun.
BEGIN;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WaitlistStatus') THEN CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'OFFERED', 'CLAIMED', 'EXPIRED', 'CANCELLED'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OpenPlayStatus') THEN CREATE TYPE "OpenPlayStatus" AS ENUM ('OPEN', 'FILLED', 'CONFIRMED', 'COMPLETED', 'CANCELLED'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OpenPlayParticipantStatus') THEN CREATE TYPE "OpenPlayParticipantStatus" AS ENUM ('JOINED', 'PAID', 'CANCELLED'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AccessPassStatus') THEN CREATE TYPE "AccessPassStatus" AS ENUM ('ACTIVE', 'USED', 'EXPIRED', 'REVOKED'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WalletTransactionType') THEN CREATE TYPE "WalletTransactionType" AS ENUM ('CREDIT', 'DEBIT', 'REFUND', 'ADJUSTMENT'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PackagePurchaseStatus') THEN CREATE TYPE "PackagePurchaseStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXHAUSTED', 'EXPIRED', 'CANCELLED'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeagueStatus') THEN CREATE TYPE "LeagueStatus" AS ENUM ('DRAFT', 'REGISTRATION_OPEN', 'ACTIVE', 'COMPLETED', 'CANCELLED'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeagueEntryStatus') THEN CREATE TYPE "LeagueEntryStatus" AS ENUM ('PENDING', 'ACTIVE', 'WITHDRAWN'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeagueMatchStatus') THEN CREATE TYPE "LeagueMatchStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AutomationKind') THEN CREATE TYPE "AutomationKind" AS ENUM ('WIN_BACK', 'MEMBERSHIP_EXPIRY', 'BIRTHDAY', 'PROMOTION'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AutomationStatus') THEN CREATE TYPE "AutomationStatus" AS ENUM ('ACTIVE', 'PAUSED'); END IF; END $$;

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "skillRating" DECIMAL(4,2) NOT NULL DEFAULT 3.00;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "duprId" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "walletBalance" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "marketingConsent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "dateOfBirth" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "lastActivityAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "Customer_duprId_key" ON "Customer"("duprId");
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "actionUrl" TEXT;

CREATE TABLE IF NOT EXISTS "PackagePlan" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "price" DECIMAL(12,2) NOT NULL,
  "bookingCredits" INTEGER NOT NULL,
  "validityDays" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PackagePlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PackagePlan_name_key" ON "PackagePlan"("name");

CREATE TABLE IF NOT EXISTS "PackagePurchase" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "packagePlanId" TEXT NOT NULL,
  "creditsRemaining" INTEGER NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "status" "PackagePurchaseStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PackagePurchase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PackagePurchase_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PackagePurchase_packagePlanId_fkey" FOREIGN KEY ("packagePlanId") REFERENCES "PackagePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "PackagePurchase_customerId_status_expiresAt_idx" ON "PackagePurchase"("customerId", "status", "expiresAt");

ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "packagePurchaseId" TEXT;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Booking_packagePurchaseId_fkey') THEN ALTER TABLE "Booking" ADD CONSTRAINT "Booking_packagePurchaseId_fkey" FOREIGN KEY ("packagePurchaseId") REFERENCES "PackagePurchase"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;

CREATE TABLE IF NOT EXISTS "OpenPlay" (
  "id" TEXT NOT NULL,
  "courtId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "skillMin" DECIMAL(4,2) NOT NULL DEFAULT 2.00,
  "skillMax" DECIMAL(4,2) NOT NULL DEFAULT 5.00,
  "capacity" INTEGER NOT NULL DEFAULT 4,
  "pricePerPlayer" DECIMAL(12,2) NOT NULL,
  "competitive" BOOLEAN NOT NULL DEFAULT false,
  "status" "OpenPlayStatus" NOT NULL DEFAULT 'OPEN',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpenPlay_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OpenPlay_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OpenPlay_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "OpenPlay_courtId_startsAt_endsAt_idx" ON "OpenPlay"("courtId", "startsAt", "endsAt");
CREATE INDEX IF NOT EXISTS "OpenPlay_status_startsAt_idx" ON "OpenPlay"("status", "startsAt");

CREATE TABLE IF NOT EXISTS "OpenPlayParticipant" (
  "id" TEXT NOT NULL,
  "openPlayId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "status" "OpenPlayParticipantStatus" NOT NULL DEFAULT 'JOINED',
  "paymentMethod" "PaymentMethod" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "transactionReference" TEXT,
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpenPlayParticipant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OpenPlayParticipant_openPlayId_fkey" FOREIGN KEY ("openPlayId") REFERENCES "OpenPlay"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OpenPlayParticipant_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "OpenPlayParticipant_openPlayId_customerId_key" ON "OpenPlayParticipant"("openPlayId", "customerId");
CREATE INDEX IF NOT EXISTS "OpenPlayParticipant_openPlayId_status_idx" ON "OpenPlayParticipant"("openPlayId", "status");

CREATE TABLE IF NOT EXISTS "League" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "skillMin" DECIMAL(4,2) NOT NULL DEFAULT 2.00,
  "skillMax" DECIMAL(4,2) NOT NULL DEFAULT 5.00,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "maxPlayers" INTEGER,
  "entryFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "status" "LeagueStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "League_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "League_status_startsAt_idx" ON "League"("status", "startsAt");

CREATE TABLE IF NOT EXISTS "LeagueEntry" (
  "id" TEXT NOT NULL,
  "leagueId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "status" "LeagueEntryStatus" NOT NULL DEFAULT 'PENDING',
  "wins" INTEGER NOT NULL DEFAULT 0,
  "losses" INTEGER NOT NULL DEFAULT 0,
  "points" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeagueEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LeagueEntry_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeagueEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "LeagueEntry_leagueId_customerId_key" ON "LeagueEntry"("leagueId", "customerId");
CREATE INDEX IF NOT EXISTS "LeagueEntry_leagueId_status_points_idx" ON "LeagueEntry"("leagueId", "status", "points");

CREATE TABLE IF NOT EXISTS "LeagueMatch" (
  "id" TEXT NOT NULL,
  "leagueId" TEXT NOT NULL,
  "homeEntryId" TEXT NOT NULL,
  "awayEntryId" TEXT NOT NULL,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "homeScore" INTEGER,
  "awayScore" INTEGER,
  "winnerEntryId" TEXT,
  "status" "LeagueMatchStatus" NOT NULL DEFAULT 'SCHEDULED',
  "ratingSyncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeagueMatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LeagueMatch_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeagueMatch_homeEntryId_fkey" FOREIGN KEY ("homeEntryId") REFERENCES "LeagueEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LeagueMatch_awayEntryId_fkey" FOREIGN KEY ("awayEntryId") REFERENCES "LeagueEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "LeagueMatch_leagueId_scheduledAt_status_idx" ON "LeagueMatch"("leagueId", "scheduledAt", "status");

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "packagePurchaseId" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "openPlayParticipantId" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "leagueEntryId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_openPlayParticipantId_key" ON "Payment"("openPlayParticipantId");
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_leagueEntryId_key" ON "Payment"("leagueEntryId");
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Payment_packagePurchaseId_fkey') THEN ALTER TABLE "Payment" ADD CONSTRAINT "Payment_packagePurchaseId_fkey" FOREIGN KEY ("packagePurchaseId") REFERENCES "PackagePurchase"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Payment_openPlayParticipantId_fkey') THEN ALTER TABLE "Payment" ADD CONSTRAINT "Payment_openPlayParticipantId_fkey" FOREIGN KEY ("openPlayParticipantId") REFERENCES "OpenPlayParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Payment_leagueEntryId_fkey') THEN ALTER TABLE "Payment" ADD CONSTRAINT "Payment_leagueEntryId_fkey" FOREIGN KEY ("leagueEntryId") REFERENCES "LeagueEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;

CREATE TABLE IF NOT EXISTS "WalletTopUp" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WalletTopUp_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WalletTopUp_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WalletTopUp_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "WalletTopUp_paymentId_key" ON "WalletTopUp"("paymentId");
CREATE INDEX IF NOT EXISTS "WalletTopUp_customerId_status_idx" ON "WalletTopUp"("customerId", "status");

CREATE TABLE IF NOT EXISTS "WalletTransaction" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "type" "WalletTransactionType" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "balanceAfter" DECIMAL(12,2) NOT NULL,
  "description" TEXT NOT NULL,
  "reference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WalletTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "WalletTransaction_customerId_createdAt_idx" ON "WalletTransaction"("customerId", "createdAt");

CREATE TABLE IF NOT EXISTS "BookingAccessPass" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "validFrom" TIMESTAMP(3) NOT NULL,
  "validUntil" TIMESTAMP(3) NOT NULL,
  "status" "AccessPassStatus" NOT NULL DEFAULT 'ACTIVE',
  "usedAt" TIMESTAMP(3),
  "usedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BookingAccessPass_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BookingAccessPass_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "BookingAccessPass_bookingId_key" ON "BookingAccessPass"("bookingId");
CREATE UNIQUE INDEX IF NOT EXISTS "BookingAccessPass_token_key" ON "BookingAccessPass"("token");
CREATE INDEX IF NOT EXISTS "BookingAccessPass_token_status_idx" ON "BookingAccessPass"("token", "status");

CREATE TABLE IF NOT EXISTS "GuestLead" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'PUBLIC_BOOKING',
  "verificationCodeHash" TEXT,
  "verificationExpiresAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "convertedCustomerId" TEXT,
  "bookingId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GuestLead_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GuestLead_convertedCustomerId_fkey" FOREIGN KEY ("convertedCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "GuestLead_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "GuestLead_bookingId_key" ON "GuestLead"("bookingId");
CREATE INDEX IF NOT EXISTS "GuestLead_email_createdAt_idx" ON "GuestLead"("email", "createdAt");

CREATE TABLE IF NOT EXISTS "DynamicPricingRule" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "courtId" TEXT,
  "weekday" INTEGER,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "adjustmentPercent" DECIMAL(6,2) NOT NULL,
  "minimumLeadHours" INTEGER,
  "maximumLeadHours" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DynamicPricingRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DynamicPricingRule_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "DynamicPricingRule_courtId_weekday_isActive_idx" ON "DynamicPricingRule"("courtId", "weekday", "isActive");

CREATE TABLE IF NOT EXISTS "CourtWaitlistEntry" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "courtId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
  "offeredAt" TIMESTAMP(3),
  "offerExpiresAt" TIMESTAMP(3),
  "claimedBookingId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CourtWaitlistEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CourtWaitlistEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CourtWaitlistEntry_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CourtWaitlistEntry_claimedBookingId_fkey" FOREIGN KEY ("claimedBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "CourtWaitlistEntry_claimedBookingId_key" ON "CourtWaitlistEntry"("claimedBookingId");
CREATE UNIQUE INDEX IF NOT EXISTS "CourtWaitlistEntry_customerId_courtId_startsAt_durationMinutes_key" ON "CourtWaitlistEntry"("customerId", "courtId", "startsAt", "durationMinutes");
CREATE INDEX IF NOT EXISTS "CourtWaitlistEntry_courtId_startsAt_status_idx" ON "CourtWaitlistEntry"("courtId", "startsAt", "status");

CREATE TABLE IF NOT EXISTS "AutomationCampaign" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "AutomationKind" NOT NULL,
  "status" "AutomationStatus" NOT NULL DEFAULT 'ACTIVE',
  "subject" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "actionUrl" TEXT,
  "triggerDays" INTEGER NOT NULL DEFAULT 30,
  "lastRunAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationCampaign_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AutomationCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "AutomationCampaign_status_kind_idx" ON "AutomationCampaign"("status", "kind");

CREATE TABLE IF NOT EXISTS "AutomationRun" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "recipients" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AutomationRun_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AutomationCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "AutomationRun_campaignId_createdAt_idx" ON "AutomationRun"("campaignId", "createdAt");

COMMIT;
