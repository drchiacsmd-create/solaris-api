CREATE TYPE "public"."appt_status" AS ENUM('upcoming', 'completed', 'cancelled', 'no-show');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('pending', 'confirmed', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('male', 'female', 'other');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('admin', 'manager', 'clinic_assistant', 'healthscreen_assistant');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('ember', 'radiance', 'solar', 'solaris_elite');--> statement-breakpoint
CREATE TYPE "public"."tx_type" AS ENUM('earn', 'redeem');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" serial PRIMARY KEY NOT NULL,
	"memberId" integer NOT NULL,
	"packageId" varchar(50) NOT NULL,
	"packageName" varchar(200) NOT NULL,
	"clinicId" varchar(50) NOT NULL,
	"clinicName" varchar(100) NOT NULL,
	"appointmentDate" varchar(20) NOT NULL,
	"timeSlot" varchar(10) NOT NULL,
	"status" "appt_status" DEFAULT 'upcoming' NOT NULL,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auditLogs" (
	"id" serial PRIMARY KEY NOT NULL,
	"staffId" integer,
	"staffName" varchar(100) NOT NULL,
	"action" varchar(100) NOT NULL,
	"entityType" varchar(50) NOT NULL,
	"entityId" varchar(50),
	"entityLabel" varchar(200),
	"details" text,
	"ipAddress" varchar(50),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corporateGroups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"contactPerson" varchar(100),
	"contactEmail" varchar(320),
	"contactPhone" varchar(30),
	"notes" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groupBookingParticipants" (
	"id" serial PRIMARY KEY NOT NULL,
	"groupBookingId" integer NOT NULL,
	"memberId" integer,
	"memberNumber" varchar(20),
	"participantName" varchar(200) NOT NULL,
	"participantEmail" varchar(320),
	"lumensAwarded" integer DEFAULT 0 NOT NULL,
	"transactionId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groupBookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"corporateGroupId" integer NOT NULL,
	"packageId" varchar(50) NOT NULL,
	"packageName" varchar(200) NOT NULL,
	"clinicId" varchar(50) NOT NULL,
	"clinicName" varchar(100) NOT NULL,
	"bookingDate" varchar(20) NOT NULL,
	"bookingTime" varchar(10) NOT NULL,
	"headcount" integer NOT NULL,
	"totalAmount" numeric(10, 2) NOT NULL,
	"totalLumens" integer DEFAULT 0 NOT NULL,
	"status" "booking_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"staffId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"memberNumber" varchar(20) NOT NULL,
	"firstName" varchar(100) NOT NULL,
	"lastName" varchar(100) NOT NULL,
	"email" varchar(320) NOT NULL,
	"phone" varchar(30),
	"dateOfBirth" varchar(20),
	"gender" "gender",
	"tier" "tier" DEFAULT 'ember' NOT NULL,
	"lumensBalance" integer DEFAULT 0 NOT NULL,
	"totalSpend" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"isCorporate" boolean DEFAULT false NOT NULL,
	"corporateGroupId" integer,
	"isActive" boolean DEFAULT true NOT NULL,
	"pushToken" varchar(500),
	"joinedAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "members_memberNumber_unique" UNIQUE("memberNumber")
);
--> statement-breakpoint
CREATE TABLE "staffAccounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(100) NOT NULL,
	"passwordHash" varchar(255) NOT NULL,
	"fullName" varchar(100) NOT NULL,
	"role" "staff_role" DEFAULT 'clinic_assistant' NOT NULL,
	"clinicId" varchar(50),
	"isActive" boolean DEFAULT true NOT NULL,
	"lastLoginAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "staffAccounts_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"memberId" integer NOT NULL,
	"type" "tx_type" NOT NULL,
	"packageId" varchar(50),
	"packageName" varchar(200),
	"rewardId" varchar(50),
	"rewardName" varchar(200),
	"amountPaid" numeric(10, 2),
	"lumensEarned" integer DEFAULT 0 NOT NULL,
	"lumensRedeemed" integer DEFAULT 0 NOT NULL,
	"lumensRate" numeric(4, 2),
	"isCorporateRate" boolean DEFAULT false NOT NULL,
	"clinicId" varchar(50),
	"clinicName" varchar(100),
	"staffId" integer,
	"notes" text,
	"expiryDate" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
