import {
  boolean,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

// ── Enums ─────────────────────────────────────────────────────────────────────
export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const genderEnum = pgEnum("gender", ["male", "female", "other"]);
export const tierEnum = pgEnum("tier", ["ember", "radiance", "solar", "solaris_elite"]);
export const txTypeEnum = pgEnum("tx_type", ["earn", "redeem"]);
export const staffRoleEnum = pgEnum("staff_role", ["admin", "manager", "clinic_assistant", "healthscreen_assistant"]);
export const bookingStatusEnum = pgEnum("booking_status", ["pending", "confirmed", "completed", "cancelled"]);
export const apptStatusEnum = pgEnum("appt_status", ["upcoming", "completed", "cancelled", "no-show"]);

// ── Users (Manus OAuth) ───────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRoleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ── Members (SOLARIS Wellness Circle members) ─────────────────────────────────
export const members = pgTable("members", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),                // FK → users.id
  memberNumber: varchar("memberNumber", { length: 20 }).notNull().unique(), // SLR100001
  firstName: varchar("firstName", { length: 100 }).notNull(),
  lastName: varchar("lastName", { length: 100 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 30 }),
  dateOfBirth: varchar("dateOfBirth", { length: 20 }),
  gender: genderEnum("gender"),
  tier: tierEnum("tier").default("ember").notNull(),
  lumensBalance: integer("lumensBalance").default(0).notNull(),
  totalSpend: numeric("totalSpend", { precision: 10, scale: 2 }).default("0.00").notNull(),
  isCorporate: boolean("isCorporate").default(false).notNull(),
  corporateGroupId: integer("corporateGroupId"),      // FK → corporateGroups.id (nullable)
  isActive: boolean("isActive").default(true).notNull(),
  pushToken: varchar("pushToken", { length: 500 }),  // Expo push token for notifications
  joinedAt: timestamp("joinedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Member = typeof members.$inferSelect;
export type InsertMember = typeof members.$inferInsert;

// ── Corporate Groups ──────────────────────────────────────────────────────────
export const corporateGroups = pgTable("corporateGroups", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  contactPerson: varchar("contactPerson", { length: 100 }),
  contactEmail: varchar("contactEmail", { length: 320 }),
  contactPhone: varchar("contactPhone", { length: 30 }),
  notes: text("notes"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type CorporateGroup = typeof corporateGroups.$inferSelect;
export type InsertCorporateGroup = typeof corporateGroups.$inferInsert;

// ── Transactions (package purchases & Lumens earned) ─────────────────────────
export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  memberId: integer("memberId").notNull(),             // FK → members.id
  type: txTypeEnum("type").notNull(),
  packageId: varchar("packageId", { length: 50 }), // e.g. 'solara-core'
  packageName: varchar("packageName", { length: 200 }),
  rewardId: varchar("rewardId", { length: 50 }),   // e.g. 'reward-clinic-consult'
  rewardName: varchar("rewardName", { length: 200 }),
  amountPaid: numeric("amountPaid", { precision: 10, scale: 2 }),
  lumensEarned: integer("lumensEarned").default(0).notNull(),
  lumensRedeemed: integer("lumensRedeemed").default(0).notNull(),
  lumensRate: numeric("lumensRate", { precision: 4, scale: 2 }),  // 0.50 or 1.00
  isCorporateRate: boolean("isCorporateRate").default(false).notNull(),
  clinicId: varchar("clinicId", { length: 50 }),   // 'central' | 'north-east'
  clinicName: varchar("clinicName", { length: 100 }),
  staffId: integer("staffId"),                          // FK → staffAccounts.id
  notes: text("notes"),
  expiryDate: timestamp("expiryDate"),              // Lumens expire 365 days after earn
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = typeof transactions.$inferInsert;

// ── Staff Accounts (admin portal login) ───────────────────────────────────────
export const staffAccounts = pgTable("staffAccounts", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 100 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  fullName: varchar("fullName", { length: 100 }).notNull(),
  role: staffRoleEnum("role").default("clinic_assistant").notNull(),
  clinicId: varchar("clinicId", { length: 50 }),   // null = all clinics
  isActive: boolean("isActive").default(true).notNull(),
  lastLoginAt: timestamp("lastLoginAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type StaffAccount = typeof staffAccounts.$inferSelect;
export type InsertStaffAccount = typeof staffAccounts.$inferInsert;

// ── Group Bookings (corporate group screening events) ─────────────────────────
export const groupBookings = pgTable("groupBookings", {
  id: serial("id").primaryKey(),
  corporateGroupId: integer("corporateGroupId").notNull(), // FK → corporateGroups.id
  packageId: varchar("packageId", { length: 50 }).notNull(),
  packageName: varchar("packageName", { length: 200 }).notNull(),
  clinicId: varchar("clinicId", { length: 50 }).notNull(),
  clinicName: varchar("clinicName", { length: 100 }).notNull(),
  bookingDate: varchar("bookingDate", { length: 20 }).notNull(), // YYYY-MM-DD
  bookingTime: varchar("bookingTime", { length: 10 }).notNull(), // HH:MM
  headcount: integer("headcount").notNull(),
  totalAmount: numeric("totalAmount", { precision: 10, scale: 2 }).notNull(),
  totalLumens: integer("totalLumens").default(0).notNull(),
  status: bookingStatusEnum("status").default("pending").notNull(),
  notes: text("notes"),
  staffId: integer("staffId"),                          // FK → staffAccounts.id
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type GroupBooking = typeof groupBookings.$inferSelect;
export type InsertGroupBooking = typeof groupBookings.$inferInsert;

// ── Appointments (individual member bookings) ────────────────────────────────
export const appointments = pgTable("appointments", {
  id: serial("id").primaryKey(),
  memberId: integer("memberId").notNull(),             // FK → members.id
  packageId: varchar("packageId", { length: 50 }).notNull(),
  packageName: varchar("packageName", { length: 200 }).notNull(),
  clinicId: varchar("clinicId", { length: 50 }).notNull(),
  clinicName: varchar("clinicName", { length: 100 }).notNull(),
  appointmentDate: varchar("appointmentDate", { length: 20 }).notNull(), // YYYY-MM-DD
  timeSlot: varchar("timeSlot", { length: 10 }).notNull(),              // HH:MM
  status: apptStatusEnum("status").default("upcoming").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Appointment = typeof appointments.$inferSelect;
export type InsertAppointment = typeof appointments.$inferInsert;

// ── Group Booking Participants ─────────────────────────────────────────────────
export const groupBookingParticipants = pgTable("groupBookingParticipants", {
  id: serial("id").primaryKey(),
  groupBookingId: integer("groupBookingId").notNull(), // FK → groupBookings.id
  memberId: integer("memberId"),                        // FK → members.id (null if not yet a member)
  memberNumber: varchar("memberNumber", { length: 20 }),
  participantName: varchar("participantName", { length: 200 }).notNull(),
  participantEmail: varchar("participantEmail", { length: 320 }),
  lumensAwarded: integer("lumensAwarded").default(0).notNull(),
  transactionId: integer("transactionId"),              // FK → transactions.id (set after completion)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type GroupBookingParticipant = typeof groupBookingParticipants.$inferSelect;
export type InsertGroupBookingParticipant = typeof groupBookingParticipants.$inferInsert;

// ── Audit Logs (admin portal action trail) ────────────────────────────────────
export const auditLogs = pgTable("auditLogs", {
  id: serial("id").primaryKey(),
  staffId: integer("staffId"),                           // FK → staffAccounts.id (null = system)
  staffName: varchar("staffName", { length: 100 }).notNull(),
  action: varchar("action", { length: 100 }).notNull(), // e.g. 'member.create', 'transaction.add'
  entityType: varchar("entityType", { length: 50 }).notNull(), // 'member' | 'transaction' | 'appointment'
  entityId: varchar("entityId", { length: 50 }),     // ID of the affected record
  entityLabel: varchar("entityLabel", { length: 200 }), // human-readable label e.g. member name
  details: text("details"),                           // JSON string with before/after or summary
  ipAddress: varchar("ipAddress", { length: 50 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;
