import postgres from "postgres";
import bcrypt from "bcryptjs";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL required");

const sql = postgres(DATABASE_URL, { ssl: "require" });

async function migrate() {
  console.log("Creating enums...");
  await sql`
    DO $$ BEGIN
      CREATE TYPE user_role AS ENUM ('user', 'admin');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `;
  await sql`
    DO $$ BEGIN
      CREATE TYPE gender AS ENUM ('male', 'female', 'other');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `;
  await sql`
    DO $$ BEGIN
      CREATE TYPE tier AS ENUM ('ember', 'radiance', 'solar', 'solaris_elite');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `;
  await sql`
    DO $$ BEGIN
      CREATE TYPE tx_type AS ENUM ('earn', 'redeem');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `;
  await sql`
    DO $$ BEGIN
      CREATE TYPE staff_role AS ENUM ('admin', 'manager', 'clinic_assistant', 'healthscreen_assistant');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `;
  await sql`
    DO $$ BEGIN
      CREATE TYPE booking_status AS ENUM ('pending', 'confirmed', 'completed', 'cancelled');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `;
  await sql`
    DO $$ BEGIN
      CREATE TYPE appt_status AS ENUM ('upcoming', 'completed', 'cancelled', 'no-show');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `;

  console.log("Creating tables...");
  await sql`
    CREATE TABLE IF NOT EXISTS "users" (
      "id" SERIAL PRIMARY KEY,
      "openId" VARCHAR(64) NOT NULL UNIQUE,
      "name" TEXT,
      "email" VARCHAR(320),
      "loginMethod" VARCHAR(64),
      "role" user_role NOT NULL DEFAULT 'user',
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "lastSignedIn" TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS "corporateGroups" (
      "id" SERIAL PRIMARY KEY,
      "name" VARCHAR(200) NOT NULL,
      "contactPerson" VARCHAR(100),
      "contactEmail" VARCHAR(320),
      "contactPhone" VARCHAR(30),
      "notes" TEXT,
      "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS "members" (
      "id" SERIAL PRIMARY KEY,
      "userId" INTEGER NOT NULL,
      "memberNumber" VARCHAR(20) NOT NULL UNIQUE,
      "firstName" VARCHAR(100) NOT NULL,
      "lastName" VARCHAR(100) NOT NULL,
      "email" VARCHAR(320) NOT NULL,
      "phone" VARCHAR(30),
      "dateOfBirth" VARCHAR(20),
      "gender" gender,
      "tier" tier NOT NULL DEFAULT 'ember',
      "lumensBalance" INTEGER NOT NULL DEFAULT 0,
      "totalSpend" NUMERIC(10,2) NOT NULL DEFAULT '0.00',
      "isCorporate" BOOLEAN NOT NULL DEFAULT FALSE,
      "corporateGroupId" INTEGER,
      "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
      "pushToken" VARCHAR(500),
      "joinedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS "staffAccounts" (
      "id" SERIAL PRIMARY KEY,
      "username" VARCHAR(100) NOT NULL UNIQUE,
      "passwordHash" VARCHAR(255) NOT NULL,
      "fullName" VARCHAR(100) NOT NULL,
      "role" staff_role NOT NULL DEFAULT 'clinic_assistant',
      "clinicId" VARCHAR(50),
      "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
      "lastLoginAt" TIMESTAMP,
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS "transactions" (
      "id" SERIAL PRIMARY KEY,
      "memberId" INTEGER NOT NULL,
      "type" tx_type NOT NULL,
      "packageId" VARCHAR(50),
      "packageName" VARCHAR(200),
      "rewardId" VARCHAR(50),
      "rewardName" VARCHAR(200),
      "amountPaid" NUMERIC(10,2),
      "lumensEarned" INTEGER NOT NULL DEFAULT 0,
      "lumensRedeemed" INTEGER NOT NULL DEFAULT 0,
      "lumensRate" NUMERIC(4,2),
      "isCorporateRate" BOOLEAN NOT NULL DEFAULT FALSE,
      "clinicId" VARCHAR(50),
      "clinicName" VARCHAR(100),
      "staffId" INTEGER,
      "notes" TEXT,
      "expiryDate" TIMESTAMP,
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS "groupBookings" (
      "id" SERIAL PRIMARY KEY,
      "corporateGroupId" INTEGER NOT NULL,
      "packageId" VARCHAR(50) NOT NULL,
      "packageName" VARCHAR(200) NOT NULL,
      "clinicId" VARCHAR(50) NOT NULL,
      "clinicName" VARCHAR(100) NOT NULL,
      "bookingDate" VARCHAR(20) NOT NULL,
      "bookingTime" VARCHAR(10) NOT NULL,
      "headcount" INTEGER NOT NULL,
      "totalAmount" NUMERIC(10,2) NOT NULL,
      "totalLumens" INTEGER NOT NULL DEFAULT 0,
      "status" booking_status NOT NULL DEFAULT 'pending',
      "notes" TEXT,
      "staffId" INTEGER,
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS "appointments" (
      "id" SERIAL PRIMARY KEY,
      "memberId" INTEGER NOT NULL,
      "packageId" VARCHAR(50) NOT NULL,
      "packageName" VARCHAR(200) NOT NULL,
      "clinicId" VARCHAR(50) NOT NULL,
      "clinicName" VARCHAR(100) NOT NULL,
      "appointmentDate" VARCHAR(20) NOT NULL,
      "timeSlot" VARCHAR(10) NOT NULL,
      "status" appt_status NOT NULL DEFAULT 'upcoming',
      "notes" TEXT,
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS "groupBookingParticipants" (
      "id" SERIAL PRIMARY KEY,
      "groupBookingId" INTEGER NOT NULL,
      "memberId" INTEGER,
      "memberNumber" VARCHAR(20),
      "participantName" VARCHAR(200) NOT NULL,
      "participantEmail" VARCHAR(320),
      "lumensAwarded" INTEGER NOT NULL DEFAULT 0,
      "transactionId" INTEGER,
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS "auditLogs" (
      "id" SERIAL PRIMARY KEY,
      "staffId" INTEGER,
      "staffName" VARCHAR(100) NOT NULL,
      "action" VARCHAR(100) NOT NULL,
      "entityType" VARCHAR(50) NOT NULL,
      "entityId" VARCHAR(50),
      "entityLabel" VARCHAR(200),
      "details" TEXT,
      "ipAddress" VARCHAR(50),
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  console.log("Creating vouchers table...");
  await sql`
    DO $$ BEGIN
      CREATE TYPE voucher_status AS ENUM ('unused', 'redeemed', 'expired', 'cancelled');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS "vouchers" (
      "id" SERIAL PRIMARY KEY,
      "code" VARCHAR(20) NOT NULL UNIQUE,
      "denomination" NUMERIC(10,2) NOT NULL DEFAULT '100.00',
      "status" voucher_status NOT NULL DEFAULT 'unused',
      "purchaserName" VARCHAR(200),
      "purchaserEmail" VARCHAR(320),
      "recipientName" VARCHAR(200),
      "recipientEmail" VARCHAR(320),
      "message" TEXT,
      "notes" TEXT,
      "batchId" VARCHAR(50),
      "issuedByStaffId" INTEGER,
      "issuedByStaffName" VARCHAR(100),
      "redeemedByMemberId" INTEGER,
      "redeemedByMemberName" VARCHAR(200),
      "redeemedAt" TIMESTAMP,
      "expiryDate" TIMESTAMP,
      "issuedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  console.log("Seeding default admin account...");
  const hash = await bcrypt.hash("Solaris2026!", 12);
  await sql`
    INSERT INTO "staffAccounts" ("username", "passwordHash", "fullName", "role", "clinicId", "isActive")
    VALUES ('admin', ${hash}, 'System Administrator', 'admin', NULL, TRUE)
    ON CONFLICT ("username") DO NOTHING
  `;

  console.log("✅ Migration complete! Tables created and admin account seeded.");
  await sql.end();
}

migrate().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
