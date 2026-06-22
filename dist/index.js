// server/_core/index.ts
import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";

// server/db.ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, desc, or, ilike, and, sql } from "drizzle-orm";

// drizzle/schema.ts
import {
  boolean,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar
} from "drizzle-orm/pg-core";
var userRoleEnum = pgEnum("user_role", ["user", "admin"]);
var genderEnum = pgEnum("gender", ["male", "female", "other"]);
var tierEnum = pgEnum("tier", ["ember", "radiance", "solar", "solaris_elite"]);
var txTypeEnum = pgEnum("tx_type", ["earn", "redeem"]);
var staffRoleEnum = pgEnum("staff_role", ["admin", "manager", "clinic_assistant", "healthscreen_assistant"]);
var bookingStatusEnum = pgEnum("booking_status", ["pending", "confirmed", "completed", "cancelled"]);
var apptStatusEnum = pgEnum("appt_status", ["upcoming", "completed", "cancelled", "no-show"]);
var users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRoleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});
var members = pgTable("members", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  // FK → users.id
  memberNumber: varchar("memberNumber", { length: 20 }).notNull().unique(),
  // SLR100001
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
  corporateGroupId: integer("corporateGroupId"),
  // FK → corporateGroups.id (nullable)
  isActive: boolean("isActive").default(true).notNull(),
  pushToken: varchar("pushToken", { length: 500 }),
  // Expo push token for notifications
  joinedAt: timestamp("joinedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull()
});
var corporateGroups = pgTable("corporateGroups", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  contactPerson: varchar("contactPerson", { length: 100 }),
  contactEmail: varchar("contactEmail", { length: 320 }),
  contactPhone: varchar("contactPhone", { length: 30 }),
  notes: text("notes"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull()
});
var transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  memberId: integer("memberId").notNull(),
  // FK → members.id
  type: txTypeEnum("type").notNull(),
  packageId: varchar("packageId", { length: 50 }),
  // e.g. 'solara-core'
  packageName: varchar("packageName", { length: 200 }),
  rewardId: varchar("rewardId", { length: 50 }),
  // e.g. 'reward-clinic-consult'
  rewardName: varchar("rewardName", { length: 200 }),
  amountPaid: numeric("amountPaid", { precision: 10, scale: 2 }),
  lumensEarned: integer("lumensEarned").default(0).notNull(),
  lumensRedeemed: integer("lumensRedeemed").default(0).notNull(),
  lumensRate: numeric("lumensRate", { precision: 4, scale: 2 }),
  // 0.50 or 1.00
  isCorporateRate: boolean("isCorporateRate").default(false).notNull(),
  clinicId: varchar("clinicId", { length: 50 }),
  // 'central' | 'north-east'
  clinicName: varchar("clinicName", { length: 100 }),
  staffId: integer("staffId"),
  // FK → staffAccounts.id
  notes: text("notes"),
  expiryDate: timestamp("expiryDate"),
  // Lumens expire 365 days after earn
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var staffAccounts = pgTable("staffAccounts", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 100 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  fullName: varchar("fullName", { length: 100 }).notNull(),
  role: staffRoleEnum("role").default("clinic_assistant").notNull(),
  clinicId: varchar("clinicId", { length: 50 }),
  // null = all clinics
  isActive: boolean("isActive").default(true).notNull(),
  lastLoginAt: timestamp("lastLoginAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull()
});
var groupBookings = pgTable("groupBookings", {
  id: serial("id").primaryKey(),
  corporateGroupId: integer("corporateGroupId").notNull(),
  // FK → corporateGroups.id
  packageId: varchar("packageId", { length: 50 }).notNull(),
  packageName: varchar("packageName", { length: 200 }).notNull(),
  clinicId: varchar("clinicId", { length: 50 }).notNull(),
  clinicName: varchar("clinicName", { length: 100 }).notNull(),
  bookingDate: varchar("bookingDate", { length: 20 }).notNull(),
  // YYYY-MM-DD
  bookingTime: varchar("bookingTime", { length: 10 }).notNull(),
  // HH:MM
  headcount: integer("headcount").notNull(),
  totalAmount: numeric("totalAmount", { precision: 10, scale: 2 }).notNull(),
  totalLumens: integer("totalLumens").default(0).notNull(),
  status: bookingStatusEnum("status").default("pending").notNull(),
  notes: text("notes"),
  staffId: integer("staffId"),
  // FK → staffAccounts.id
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull()
});
var appointments = pgTable("appointments", {
  id: serial("id").primaryKey(),
  memberId: integer("memberId").notNull(),
  // FK → members.id
  packageId: varchar("packageId", { length: 50 }).notNull(),
  packageName: varchar("packageName", { length: 200 }).notNull(),
  clinicId: varchar("clinicId", { length: 50 }).notNull(),
  clinicName: varchar("clinicName", { length: 100 }).notNull(),
  appointmentDate: varchar("appointmentDate", { length: 20 }).notNull(),
  // YYYY-MM-DD
  timeSlot: varchar("timeSlot", { length: 10 }).notNull(),
  // HH:MM
  status: apptStatusEnum("status").default("upcoming").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull()
});
var groupBookingParticipants = pgTable("groupBookingParticipants", {
  id: serial("id").primaryKey(),
  groupBookingId: integer("groupBookingId").notNull(),
  // FK → groupBookings.id
  memberId: integer("memberId"),
  // FK → members.id (null if not yet a member)
  memberNumber: varchar("memberNumber", { length: 20 }),
  participantName: varchar("participantName", { length: 200 }).notNull(),
  participantEmail: varchar("participantEmail", { length: 320 }),
  lumensAwarded: integer("lumensAwarded").default(0).notNull(),
  transactionId: integer("transactionId"),
  // FK → transactions.id (set after completion)
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var auditLogs = pgTable("auditLogs", {
  id: serial("id").primaryKey(),
  staffId: integer("staffId"),
  // FK → staffAccounts.id (null = system)
  staffName: varchar("staffName", { length: 100 }).notNull(),
  action: varchar("action", { length: 100 }).notNull(),
  // e.g. 'member.create', 'transaction.add'
  entityType: varchar("entityType", { length: 50 }).notNull(),
  // 'member' | 'transaction' | 'appointment'
  entityId: varchar("entityId", { length: 50 }),
  // ID of the affected record
  entityLabel: varchar("entityLabel", { length: 200 }),
  // human-readable label e.g. member name
  details: text("details"),
  // JSON string with before/after or summary
  ipAddress: varchar("ipAddress", { length: 50 }),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
};

// server/db.ts
var _db = null;
async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const client = postgres(process.env.DATABASE_URL, { ssl: "require" });
      _db = drizzle(client);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
async function upsertUser(user) {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values = { openId: user.openId };
    const updateSet = {};
    const textFields = ["name", "email", "loginMethod"];
    const assignNullable = (field) => {
      const value = user[field];
      if (value === void 0) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== void 0) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== void 0) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }
    if (!values.lastSignedIn) values.lastSignedIn = /* @__PURE__ */ new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = /* @__PURE__ */ new Date();
    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.openId,
      set: updateSet
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function createAdminUser(email, name) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const openId = `admin_created_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const result = await db.insert(users).values({ openId, email, name, loginMethod: "admin", lastSignedIn: /* @__PURE__ */ new Date() }).returning({ id: users.id });
  return result[0].id;
}
async function generateNextMemberNumber() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.select({ memberNumber: members.memberNumber }).from(members).where(ilike(members.memberNumber, "SLR%")).orderBy(desc(members.memberNumber));
  if (result.length === 0) return "SLR100000001";
  const nums = result.map((r) => parseInt(r.memberNumber.replace(/^SLR/, ""), 10)).filter((n) => !isNaN(n));
  const max = Math.max(...nums);
  return `SLR${max + 1}`;
}
function calculateTier(totalSpend) {
  if (totalSpend >= 2e3) return "solaris_elite";
  if (totalSpend >= 1e3) return "solar";
  if (totalSpend >= 500) return "radiance";
  return "ember";
}
async function createMember(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const memberNumber = await generateNextMemberNumber();
  const result = await db.insert(members).values({ ...data, memberNumber }).returning({ id: members.id });
  return result[0].id;
}
async function deleteMember(id) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(appointments).where(eq(appointments.memberId, id));
  await db.delete(transactions).where(eq(transactions.memberId, id));
  await db.delete(members).where(eq(members.id, id));
}
async function getMemberByUserId(userId) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(members).where(eq(members.userId, userId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function getMemberById(id) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(members).where(eq(members.id, id)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function getMemberByNumber(memberNumber) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(members).where(eq(members.memberNumber, memberNumber)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function getAllMembers(search) {
  const db = await getDb();
  if (!db) return [];
  if (search) {
    return db.select().from(members).where(
      or(
        ilike(members.firstName, `%${search}%`),
        ilike(members.lastName, `%${search}%`),
        ilike(members.email, `%${search}%`),
        ilike(members.memberNumber, `%${search}%`),
        sql`(${members.firstName} || ' ' || ${members.lastName}) ILIKE ${`%${search}%`}`
      )
    ).orderBy(desc(members.joinedAt));
  }
  return db.select().from(members).orderBy(desc(members.joinedAt));
}
async function updateMemberBalance(memberId, lumensChange, spendChange) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const member = await getMemberById(memberId);
  if (!member) throw new Error("Member not found");
  const newBalance = Math.max(0, member.lumensBalance + lumensChange);
  const newSpend = parseFloat(member.totalSpend) + spendChange;
  const newTier = calculateTier(newSpend);
  await db.update(members).set({
    lumensBalance: newBalance,
    totalSpend: newSpend.toFixed(2),
    tier: newTier
  }).where(eq(members.id, memberId));
}
async function updateMember(id, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(members).set(data).where(eq(members.id, id));
}
async function savePushToken(memberId, token) {
  const db = await getDb();
  if (!db) return;
  await db.update(members).set({ pushToken: token }).where(eq(members.id, memberId));
}
async function createTransaction(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(transactions).values(data).returning({ id: transactions.id });
  return result[0].id;
}
async function getTransactionsByMember(memberId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(transactions).where(eq(transactions.memberId, memberId)).orderBy(desc(transactions.createdAt));
}
async function getAllTransactions(limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(transactions).orderBy(desc(transactions.createdAt)).limit(limit);
}
async function getTransactionStats() {
  const db = await getDb();
  if (!db) return { totalMembers: 0, totalLumensIssued: 0, totalLumensRedeemed: 0, totalRevenue: 0 };
  const [memberCount] = await db.select({ count: sql`count(*)` }).from(members);
  const [activeCount] = await db.select({ count: sql`count(*)` }).from(members).where(eq(members.isActive, true));
  const [corporateCount] = await db.select({ count: sql`count(*)` }).from(members).where(eq(members.isCorporate, true));
  const [earnStats] = await db.select({
    total: sql`COALESCE(SUM("lumensEarned"), 0)`,
    revenue: sql`COALESCE(SUM(CAST("amountPaid" AS DECIMAL(10,2))), 0)`
  }).from(transactions).where(eq(transactions.type, "earn"));
  const [redeemStats] = await db.select({
    total: sql`COALESCE(SUM("lumensRedeemed"), 0)`
  }).from(transactions).where(eq(transactions.type, "redeem"));
  return {
    totalMembers: memberCount?.count ?? 0,
    activeMembers: activeCount?.count ?? 0,
    corporateAccounts: corporateCount?.count ?? 0,
    totalLumensIssued: earnStats?.total ?? 0,
    totalLumensRedeemed: redeemStats?.total ?? 0,
    totalRevenue: earnStats?.revenue ?? 0
  };
}
async function getTierDistribution() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    tier: members.tier,
    count: sql`count(*)`
  }).from(members).groupBy(members.tier);
}
async function createStaffAccount(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(staffAccounts).values(data).returning({ id: staffAccounts.id });
  return result[0].id;
}
async function getStaffByUsername(username) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(staffAccounts).where(
    and(eq(staffAccounts.username, username), eq(staffAccounts.isActive, true))
  ).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function getStaffById(id) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(staffAccounts).where(eq(staffAccounts.id, id)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function updateStaffLastLogin(id) {
  const db = await getDb();
  if (!db) return;
  await db.update(staffAccounts).set({ lastLoginAt: /* @__PURE__ */ new Date() }).where(eq(staffAccounts.id, id));
}
async function getAllStaff() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: staffAccounts.id,
    username: staffAccounts.username,
    fullName: staffAccounts.fullName,
    role: staffAccounts.role,
    clinicId: staffAccounts.clinicId,
    isActive: staffAccounts.isActive,
    lastLoginAt: staffAccounts.lastLoginAt,
    createdAt: staffAccounts.createdAt
  }).from(staffAccounts).orderBy(staffAccounts.fullName);
}
async function updateStaffAccount(id, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(staffAccounts).set(data).where(eq(staffAccounts.id, id));
}
async function updateStaffPassword(id, passwordHash) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(staffAccounts).set({ passwordHash }).where(eq(staffAccounts.id, id));
}
async function createCorporateGroup(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(corporateGroups).values(data).returning({ id: corporateGroups.id });
  return result[0].id;
}
async function getAllCorporateGroups() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(corporateGroups).where(eq(corporateGroups.isActive, true)).orderBy(corporateGroups.name);
}
async function getCorporateGroupById(id) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(corporateGroups).where(eq(corporateGroups.id, id)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function createGroupBooking(booking, participants) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(groupBookings).values(booking).returning({ id: groupBookings.id });
  const bookingId = result[0].id;
  if (participants.length > 0) {
    await db.insert(groupBookingParticipants).values(
      participants.map((p) => ({ ...p, groupBookingId: bookingId }))
    );
  }
  return bookingId;
}
async function getAllGroupBookings() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(groupBookings).orderBy(desc(groupBookings.createdAt));
}
async function getGroupBookingById(id) {
  const db = await getDb();
  if (!db) return void 0;
  const [booking] = await db.select().from(groupBookings).where(eq(groupBookings.id, id)).limit(1);
  if (!booking) return void 0;
  const participants = await db.select().from(groupBookingParticipants).where(eq(groupBookingParticipants.groupBookingId, id));
  return { ...booking, participants };
}
async function updateGroupBookingStatus(id, status) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(groupBookings).set({ status }).where(eq(groupBookings.id, id));
}
async function completeGroupBooking(bookingId, staffId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const booking = await getGroupBookingById(bookingId);
  if (!booking) throw new Error("Booking not found");
  if (booking.status === "completed") throw new Error("Booking already completed");
  const expiryDate = /* @__PURE__ */ new Date();
  expiryDate.setDate(expiryDate.getDate() + 365);
  for (const participant of booking.participants) {
    if (!participant.memberId) continue;
    const lumens = Math.floor(parseFloat(booking.totalAmount) / booking.headcount);
    const txId = await createTransaction({
      memberId: participant.memberId,
      type: "earn",
      packageId: booking.packageId,
      packageName: booking.packageName,
      amountPaid: (parseFloat(booking.totalAmount) / booking.headcount).toFixed(2),
      lumensEarned: lumens,
      lumensRedeemed: 0,
      lumensRate: "1.00",
      isCorporateRate: true,
      clinicId: booking.clinicId,
      clinicName: booking.clinicName,
      staffId,
      notes: `Group booking #${bookingId} \u2014 ${booking.corporateGroupId}`,
      expiryDate
    });
    await updateMemberBalance(participant.memberId, lumens, parseFloat(booking.totalAmount) / booking.headcount);
    await db.update(groupBookingParticipants).set({
      lumensAwarded: lumens,
      transactionId: txId
    }).where(eq(groupBookingParticipants.id, participant.id));
  }
  await db.update(groupBookings).set({ status: "completed" }).where(eq(groupBookings.id, bookingId));
}
async function createAppointment(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(appointments).values(data).returning({ id: appointments.id });
  return result[0].id;
}
async function getAppointmentsByMember(memberId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(appointments).where(eq(appointments.memberId, memberId)).orderBy(desc(appointments.appointmentDate), desc(appointments.timeSlot));
}
async function getAppointmentById(id) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(appointments).where(eq(appointments.id, id)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function cancelAppointment(id) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(appointments).set({ status: "cancelled" }).where(eq(appointments.id, id));
}
async function getAllAppointments(limit = 200) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    id: appointments.id,
    memberId: appointments.memberId,
    packageId: appointments.packageId,
    packageName: appointments.packageName,
    clinicId: appointments.clinicId,
    clinicName: appointments.clinicName,
    appointmentDate: appointments.appointmentDate,
    timeSlot: appointments.timeSlot,
    status: appointments.status,
    notes: appointments.notes,
    createdAt: appointments.createdAt,
    updatedAt: appointments.updatedAt,
    memberNumber: members.memberNumber,
    memberFirstName: members.firstName,
    memberLastName: members.lastName,
    memberEmail: members.email,
    memberPhone: members.phone
  }).from(appointments).leftJoin(members, eq(appointments.memberId, members.id)).orderBy(desc(appointments.appointmentDate), desc(appointments.timeSlot)).limit(limit);
  return rows;
}
async function updateAppointmentStatus(id, status, staffNotes) {
  const db = await getDb();
  if (!db) return;
  const updateData = { status };
  if (staffNotes !== void 0) updateData.notes = staffNotes;
  await db.update(appointments).set(updateData).where(eq(appointments.id, id));
}
async function createAuditLog(data) {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(auditLogs).values(data);
  } catch (err) {
    console.warn("[AuditLog] Failed to write audit log:", err);
  }
}
async function clearAllMemberData() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(groupBookingParticipants);
  await db.delete(groupBookings);
  await db.delete(appointments);
  await db.delete(transactions);
  await db.delete(auditLogs);
  await db.delete(members);
  await db.delete(users);
  await db.delete(corporateGroups);
}
async function getAuditLogs(opts) {
  const db = await getDb();
  if (!db) return { rows: [], total: 0 };
  const {
    limit = 50,
    offset = 0,
    action,
    entityType,
    staffId,
    dateFrom,
    dateTo
  } = opts ?? {};
  const conditions = [];
  if (action) conditions.push(eq(auditLogs.action, action));
  if (entityType) conditions.push(eq(auditLogs.entityType, entityType));
  if (staffId) conditions.push(eq(auditLogs.staffId, staffId));
  if (dateFrom) conditions.push(sql`DATE(${auditLogs.createdAt}) >= ${dateFrom}`);
  if (dateTo) conditions.push(sql`DATE(${auditLogs.createdAt}) <= ${dateTo}`);
  const whereClause = conditions.length > 0 ? and(...conditions) : void 0;
  const [rows, countResult] = await Promise.all([
    db.select().from(auditLogs).where(whereClause).orderBy(desc(auditLogs.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql`count(*)` }).from(auditLogs).where(whereClause)
  ]);
  return { rows, total: countResult[0]?.count ?? 0 };
}

// server/_core/cookies.ts
var LOCAL_HOSTS = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "::1"]);
function isIpAddress(host) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getParentDomain(hostname) {
  if (LOCAL_HOSTS.has(hostname) || isIpAddress(hostname)) {
    return void 0;
  }
  const parts = hostname.split(".");
  if (parts.length < 3) {
    return void 0;
  }
  return "." + parts.slice(-2).join(".");
}
function getSessionCookieOptions(req) {
  const hostname = req.hostname;
  const domain = getParentDomain(hostname);
  return {
    domain,
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }
  decodeState(state) {
    const redirectUri = atob(state);
    return redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(EXCHANGE_TOKEN_PATH, payload);
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(GET_USER_INFO_PATH, {
      accessToken: token.accessToken
    });
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(platforms.filter((p) => typeof p === "string"));
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    let token;
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      token = authHeader.slice("Bearer ".length).trim();
    }
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = token || cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
async function syncUser(userInfo) {
  if (!userInfo.openId) {
    throw new Error("openId missing from user info");
  }
  const lastSignedIn = /* @__PURE__ */ new Date();
  await upsertUser({
    openId: userInfo.openId,
    name: userInfo.name || null,
    email: userInfo.email ?? null,
    loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
    lastSignedIn
  });
  const saved = await getUserByOpenId(userInfo.openId);
  return saved ?? {
    openId: userInfo.openId,
    name: userInfo.name,
    email: userInfo.email,
    loginMethod: userInfo.loginMethod ?? null,
    lastSignedIn
  };
}
function buildUserResponse(user) {
  return {
    id: user?.id ?? null,
    openId: user?.openId ?? null,
    name: user?.name ?? null,
    email: user?.email ?? null,
    loginMethod: user?.loginMethod ?? null,
    lastSignedIn: (user?.lastSignedIn ?? /* @__PURE__ */ new Date()).toISOString()
  };
}
function registerOAuthRoutes(app) {
  app.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      await syncUser(userInfo);
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      const frontendUrl = process.env.EXPO_WEB_PREVIEW_URL || process.env.EXPO_PACKAGER_PROXY_URL || "http://localhost:8081";
      res.redirect(302, frontendUrl);
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
  app.get("/api/oauth/mobile", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      const user = await syncUser(userInfo);
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.json({
        app_session_id: sessionToken,
        user: buildUserResponse(user)
      });
    } catch (error) {
      console.error("[OAuth] Mobile exchange failed", error);
      res.status(500).json({ error: "OAuth mobile exchange failed" });
    }
  });
  app.post("/api/auth/logout", (req, res) => {
    const cookieOptions = getSessionCookieOptions(req);
    res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    res.json({ success: true });
  });
  app.get("/api/auth/me", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      res.json({ user: buildUserResponse(user) });
    } catch (error) {
      console.error("[Auth] /api/auth/me failed:", error);
      res.status(401).json({ error: "Not authenticated", user: null });
    }
  });
  app.post("/api/auth/session", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const authHeader = req.headers.authorization || req.headers.Authorization;
      if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
        res.status(400).json({ error: "Bearer token required" });
        return;
      }
      const token = authHeader.slice("Bearer ".length).trim();
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.json({ success: true, user: buildUserResponse(user) });
    } catch (error) {
      console.error("[Auth] /api/auth/session failed:", error);
      res.status(401).json({ error: "Invalid token" });
    }
  });
}

// server/routers.ts
import { TRPCError as TRPCError3 } from "@trpc/server";
import * as bcrypt from "bcryptjs";
import * as jose from "jose";
import { z as z2 } from "zod";

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL("webdevtoken.v1.WebDevService/SendNotification", normalizedBase).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/routers.ts
var STAFF_JWT_SECRET = process.env.JWT_SECRET ?? "solaris-staff-secret-2026";
async function signStaffToken(staffId, username, role) {
  const secret = new TextEncoder().encode(STAFF_JWT_SECRET);
  return await new jose.SignJWT({ staffId, username, role }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("8h").sign(secret);
}
async function verifyStaffToken(token) {
  try {
    const secret = new TextEncoder().encode(STAFF_JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    return payload;
  } catch {
    return null;
  }
}
async function seedDefaultStaff() {
  const existing = await getStaffByUsername("admin");
  if (existing) return;
  const hash2 = await bcrypt.hash("Solaris2026!", 10);
  await createStaffAccount({
    username: "admin",
    passwordHash: hash2,
    fullName: "Admin (Solara Medical)",
    role: "admin",
    isActive: true
  });
  const hash22 = await bcrypt.hash("Staff2026!", 10);
  await createStaffAccount({
    username: "staff.central",
    passwordHash: hash22,
    fullName: "Reception \u2014 Central",
    role: "clinic_assistant",
    clinicId: "central",
    isActive: true
  });
}
seedDefaultStaff().catch(console.error);
var appRouter = router({
  system: systemRouter,
  // ── Auth (Manus OAuth for mobile app) ──────────────────────────────────────
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true };
    })
  }),
  // ── Staff Auth (admin portal) ───────────────────────────────────────────────
  staff: router({
    login: publicProcedure.input(z2.object({ username: z2.string(), password: z2.string() })).mutation(async ({ input }) => {
      const staff = await getStaffByUsername(input.username);
      if (!staff) throw new TRPCError3({ code: "UNAUTHORIZED", message: "Invalid credentials" });
      const valid = await bcrypt.compare(input.password, staff.passwordHash);
      if (!valid) throw new TRPCError3({ code: "UNAUTHORIZED", message: "Invalid credentials" });
      await updateStaffLastLogin(staff.id);
      const token = await signStaffToken(staff.id, staff.username, staff.role);
      return {
        token,
        staff: {
          id: staff.id,
          username: staff.username,
          fullName: staff.fullName,
          role: staff.role,
          clinicId: staff.clinicId
        }
      };
    }),
    verify: publicProcedure.input(z2.object({ token: z2.string() })).query(async ({ input }) => {
      const payload = await verifyStaffToken(input.token);
      if (!payload) throw new TRPCError3({ code: "UNAUTHORIZED", message: "Invalid or expired token" });
      const staff = await getStaffById(payload.staffId);
      if (!staff || !staff.isActive) throw new TRPCError3({ code: "UNAUTHORIZED", message: "Staff account not found" });
      return {
        id: staff.id,
        username: staff.username,
        fullName: staff.fullName,
        role: staff.role,
        clinicId: staff.clinicId
      };
    }),
    listAll: publicProcedure.query(async () => {
      return getAllStaff();
    }),
    // Admin only: create a new staff account
    create: publicProcedure.input(z2.object({
      token: z2.string(),
      username: z2.string().min(3).max(50),
      password: z2.string().min(8),
      fullName: z2.string().min(1),
      role: z2.enum(["admin", "manager", "clinic_assistant", "healthscreen_assistant"]),
      clinicId: z2.string().optional()
    })).mutation(async ({ input }) => {
      const payload = await verifyStaffToken(input.token);
      if (!payload || payload.role !== "admin") throw new TRPCError3({ code: "FORBIDDEN", message: "Admin access required" });
      const existing = await getStaffByUsername(input.username);
      if (existing) throw new TRPCError3({ code: "CONFLICT", message: "Username already taken" });
      const passwordHash = await bcrypt.hash(input.password, 10);
      const id = await createStaffAccount({
        username: input.username,
        passwordHash,
        fullName: input.fullName,
        role: input.role,
        clinicId: input.clinicId ?? null,
        isActive: true
      });
      await createAuditLog({
        staffId: payload.staffId,
        staffName: payload.username,
        action: "staff.create",
        entityType: "staff",
        entityId: String(id),
        entityLabel: input.fullName,
        details: JSON.stringify({ username: input.username, role: input.role })
      });
      return { id };
    }),
    // Admin only: update staff account details
    update: publicProcedure.input(z2.object({
      token: z2.string(),
      id: z2.number(),
      fullName: z2.string().min(1).optional(),
      role: z2.enum(["admin", "manager", "clinic_assistant", "healthscreen_assistant"]).optional(),
      clinicId: z2.string().nullable().optional(),
      isActive: z2.boolean().optional()
    })).mutation(async ({ input }) => {
      const payload = await verifyStaffToken(input.token);
      if (!payload || payload.role !== "admin") throw new TRPCError3({ code: "FORBIDDEN", message: "Admin access required" });
      const { token: _t, id, ...updates } = input;
      const filteredUpdates = {};
      if (updates.fullName !== void 0) filteredUpdates.fullName = updates.fullName;
      if (updates.role !== void 0) filteredUpdates.role = updates.role;
      if (updates.clinicId !== void 0) filteredUpdates.clinicId = updates.clinicId;
      if (updates.isActive !== void 0) filteredUpdates.isActive = updates.isActive;
      await updateStaffAccount(id, filteredUpdates);
      await createAuditLog({
        staffId: payload.staffId,
        staffName: payload.username,
        action: "staff.update",
        entityType: "staff",
        entityId: String(id),
        entityLabel: updates.fullName ?? String(id),
        details: JSON.stringify(filteredUpdates)
      });
      return { success: true };
    }),
    // Admin only: reset a staff member's password
    resetPassword: publicProcedure.input(z2.object({
      token: z2.string(),
      id: z2.number(),
      newPassword: z2.string().min(8)
    })).mutation(async ({ input }) => {
      const payload = await verifyStaffToken(input.token);
      if (!payload || payload.role !== "admin") throw new TRPCError3({ code: "FORBIDDEN", message: "Admin access required" });
      const passwordHash = await bcrypt.hash(input.newPassword, 10);
      await updateStaffPassword(input.id, passwordHash);
      await createAuditLog({
        staffId: payload.staffId,
        staffName: payload.username,
        action: "staff.resetPassword",
        entityType: "staff",
        entityId: String(input.id),
        entityLabel: String(input.id),
        details: JSON.stringify({ note: "Password reset by admin" })
      });
      return { success: true };
    })
  }),
  // ── Members ─────────────────────────────────────────────────────────────────
  members: router({
    // Mobile: get own profile
    me: protectedProcedure.query(async ({ ctx }) => {
      return getMemberByUserId(ctx.user.id);
    }),
    // Mobile: create/register member profile
    register: protectedProcedure.input(z2.object({
      firstName: z2.string().min(1),
      lastName: z2.string().min(1),
      email: z2.string().email(),
      phone: z2.string().optional(),
      dateOfBirth: z2.string().optional(),
      gender: z2.enum(["male", "female", "other"]).optional()
    })).mutation(async ({ ctx, input }) => {
      const existing = await getMemberByUserId(ctx.user.id);
      if (existing) return existing;
      const id = await createMember({
        userId: ctx.user.id,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        dateOfBirth: input.dateOfBirth,
        gender: input.gender,
        tier: "ember",
        lumensBalance: 0,
        totalSpend: "0.00",
        isCorporate: false,
        isActive: true
      });
      return getMemberById(id);
    }),
    // Mobile: save Expo push token for this member
    registerPushToken: protectedProcedure.input(z2.object({ token: z2.string().min(1) })).mutation(async ({ ctx, input }) => {
      const member = await getMemberByUserId(ctx.user.id);
      if (!member) throw new Error("Member not found");
      await savePushToken(member.id, input.token);
      return { ok: true };
    }),
    // Admin: list all members
    listAll: publicProcedure.input(z2.object({ search: z2.string().optional() })).query(async ({ input }) => {
      return getAllMembers(input.search);
    }),
    // Admin: get member by ID
    getById: publicProcedure.input(z2.object({ id: z2.number() })).query(async ({ input }) => {
      return getMemberById(input.id);
    }),
    // Admin: get member by number
    getByNumber: publicProcedure.input(z2.object({ memberNumber: z2.string() })).query(async ({ input }) => {
      return getMemberByNumber(input.memberNumber);
    }),
    // Admin: create a new member directly (no OAuth required)
    adminCreate: publicProcedure.input(z2.object({
      firstName: z2.string().min(1),
      lastName: z2.string().min(1),
      email: z2.string().email(),
      phone: z2.string().optional(),
      dateOfBirth: z2.string().optional(),
      gender: z2.enum(["male", "female", "other"]).optional(),
      isCorporate: z2.boolean().optional(),
      corporateGroupId: z2.number().nullable().optional(),
      staffId: z2.number().optional(),
      staffName: z2.string().optional()
    })).mutation(async ({ input }) => {
      const userId = await createAdminUser(input.email, input.firstName + " " + input.lastName);
      const id = await createMember({
        userId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        dateOfBirth: input.dateOfBirth,
        gender: input.gender,
        tier: "ember",
        lumensBalance: 0,
        totalSpend: "0.00",
        isCorporate: input.isCorporate ?? false,
        corporateGroupId: input.corporateGroupId ?? null,
        isActive: true
      });
      const newMember = await getMemberById(id);
      await createAuditLog({
        staffId: input.staffId ?? null,
        staffName: input.staffName ?? "Admin",
        action: "member.create",
        entityType: "member",
        entityId: String(id),
        entityLabel: `${input.firstName} ${input.lastName}`,
        details: JSON.stringify({ email: input.email, phone: input.phone, isCorporate: input.isCorporate ?? false })
      });
      return newMember;
    }),
    // Admin: delete a member (Admin only — enforced in portal UI)
    delete: publicProcedure.input(z2.object({
      id: z2.number(),
      staffId: z2.number().optional(),
      staffName: z2.string().optional()
    })).mutation(async ({ input }) => {
      const member = await getMemberById(input.id);
      await deleteMember(input.id);
      await createAuditLog({
        staffId: input.staffId ?? null,
        staffName: input.staffName ?? "Admin",
        action: "member.delete",
        entityType: "member",
        entityId: String(input.id),
        entityLabel: member ? `${member.firstName} ${member.lastName}` : String(input.id),
        details: JSON.stringify({ memberNumber: member?.memberNumber })
      });
      return { ok: true };
    }),
    // Admin: update member (e.g. set corporate flag)
    update: publicProcedure.input(z2.object({
      id: z2.number(),
      isCorporate: z2.boolean().optional(),
      corporateGroupId: z2.number().nullable().optional(),
      isActive: z2.boolean().optional(),
      tier: z2.enum(["ember", "radiance", "solar", "solaris_elite"]).optional(),
      staffId: z2.number().optional(),
      staffName: z2.string().optional()
    })).mutation(async ({ input }) => {
      const { id, staffId, staffName, ...data } = input;
      const before = await getMemberById(id);
      await updateMember(id, data);
      const updated = await getMemberById(id);
      await createAuditLog({
        staffId: staffId ?? null,
        staffName: staffName ?? "Admin",
        action: "member.update",
        entityType: "member",
        entityId: String(id),
        entityLabel: before ? `${before.firstName} ${before.lastName}` : String(id),
        details: JSON.stringify({ changes: data })
      });
      return updated;
    })
  }),
  // ── Transactions ─────────────────────────────────────────────────────────────
  transactions: router({
    // Mobile: get own transactions
    myHistory: protectedProcedure.query(async ({ ctx }) => {
      const member = await getMemberByUserId(ctx.user.id);
      if (!member) return [];
      return getTransactionsByMember(member.id);
    }),
    // Admin: record a package purchase (auto-populates Lumens)
    recordPurchase: publicProcedure.input(z2.object({
      memberId: z2.number(),
      packageId: z2.string(),
      packageName: z2.string(),
      amountPaid: z2.number(),
      lumensEarned: z2.number(),
      lumensRate: z2.number(),
      isCorporateRate: z2.boolean().default(false),
      clinicId: z2.string(),
      clinicName: z2.string(),
      staffId: z2.number().optional(),
      staffName: z2.string().optional(),
      notes: z2.string().optional()
    })).mutation(async ({ input }) => {
      const expiryDate = /* @__PURE__ */ new Date();
      expiryDate.setDate(expiryDate.getDate() + 365);
      const txId = await createTransaction({
        memberId: input.memberId,
        type: "earn",
        packageId: input.packageId,
        packageName: input.packageName,
        amountPaid: input.amountPaid.toFixed(2),
        lumensEarned: input.lumensEarned,
        lumensRedeemed: 0,
        lumensRate: input.lumensRate.toFixed(2),
        isCorporateRate: input.isCorporateRate,
        clinicId: input.clinicId,
        clinicName: input.clinicName,
        staffId: input.staffId,
        notes: input.notes,
        expiryDate
      });
      await updateMemberBalance(input.memberId, input.lumensEarned, input.amountPaid);
      const member = await getMemberById(input.memberId);
      await createAuditLog({
        staffId: input.staffId ?? null,
        staffName: input.staffName ?? "Admin",
        action: "transaction.purchase",
        entityType: "transaction",
        entityId: String(txId),
        entityLabel: member ? `${member.firstName} ${member.lastName} \u2014 ${input.packageName}` : input.packageName,
        details: JSON.stringify({ amountPaid: input.amountPaid, lumensEarned: input.lumensEarned, clinicName: input.clinicName })
      });
      return { transactionId: txId };
    }),
    // Admin: record a redemption
    recordRedemption: publicProcedure.input(z2.object({
      memberId: z2.number(),
      rewardId: z2.string(),
      rewardName: z2.string(),
      lumensRedeemed: z2.number(),
      clinicId: z2.string(),
      clinicName: z2.string(),
      staffId: z2.number().optional(),
      staffName: z2.string().optional(),
      notes: z2.string().optional()
    })).mutation(async ({ input }) => {
      const member = await getMemberById(input.memberId);
      if (!member) throw new TRPCError3({ code: "NOT_FOUND", message: "Member not found" });
      if (member.lumensBalance < input.lumensRedeemed) {
        throw new TRPCError3({ code: "BAD_REQUEST", message: "Insufficient Lumens balance" });
      }
      const txId = await createTransaction({
        memberId: input.memberId,
        type: "redeem",
        rewardId: input.rewardId,
        rewardName: input.rewardName,
        lumensEarned: 0,
        lumensRedeemed: input.lumensRedeemed,
        clinicId: input.clinicId,
        clinicName: input.clinicName,
        staffId: input.staffId,
        notes: input.notes
      });
      await updateMemberBalance(input.memberId, -input.lumensRedeemed, 0);
      await createAuditLog({
        staffId: input.staffId ?? null,
        staffName: input.staffName ?? "Admin",
        action: "transaction.redeem",
        entityType: "transaction",
        entityId: String(txId),
        entityLabel: `${member.firstName} ${member.lastName} \u2014 ${input.rewardName}`,
        details: JSON.stringify({ lumensRedeemed: input.lumensRedeemed, clinicName: input.clinicName })
      });
      return { transactionId: txId };
    }),
    // Mobile: get own redemption history
    myRedemptions: protectedProcedure.query(async ({ ctx }) => {
      const member = await getMemberByUserId(ctx.user.id);
      if (!member) return [];
      const all = await getTransactionsByMember(member.id);
      return all.filter((tx) => tx.type === "redeem");
    }),
    // Admin: all transactions
    listAll: publicProcedure.input(z2.object({ limit: z2.number().default(100) })).query(async ({ input }) => {
      return getAllTransactions(input.limit);
    }),
    // Admin: by member
    byMember: publicProcedure.input(z2.object({ memberId: z2.number() })).query(async ({ input }) => {
      return getTransactionsByMember(input.memberId);
    })
  }),
  // ── Dashboard Stats ──────────────────────────────────────────────────────────
  dashboard: router({
    stats: publicProcedure.query(async () => {
      return getTransactionStats();
    }),
    tierDistribution: publicProcedure.query(async () => {
      return getTierDistribution();
    })
  }),
  // ── Corporate Groups ─────────────────────────────────────────────────────────
  corporateGroups: router({
    listAll: publicProcedure.query(async () => {
      return getAllCorporateGroups();
    }),
    create: publicProcedure.input(z2.object({
      name: z2.string().min(1),
      contactPerson: z2.string().optional(),
      contactEmail: z2.string().email().optional(),
      contactPhone: z2.string().optional(),
      notes: z2.string().optional()
    })).mutation(async ({ input }) => {
      const id = await createCorporateGroup({ ...input, isActive: true });
      return getCorporateGroupById(id);
    })
  }),
  // ── Appointments (individual member bookings) ───────────────────────────────────────────────────────────────────
  appointments: router({
    // Mobile: list own appointments
    myList: protectedProcedure.query(async ({ ctx }) => {
      const member = await getMemberByUserId(ctx.user.id);
      if (!member) return [];
      return getAppointmentsByMember(member.id);
    }),
    // Mobile: create appointment
    create: protectedProcedure.input(z2.object({
      packageId: z2.string(),
      packageName: z2.string(),
      clinicId: z2.string(),
      clinicName: z2.string(),
      appointmentDate: z2.string(),
      // YYYY-MM-DD
      timeSlot: z2.string(),
      // HH:MM
      notes: z2.string().optional()
    })).mutation(async ({ ctx, input }) => {
      const member = await getMemberByUserId(ctx.user.id);
      if (!member) throw new TRPCError3({ code: "NOT_FOUND", message: "Member profile not found" });
      const id = await createAppointment({
        memberId: member.id,
        packageId: input.packageId,
        packageName: input.packageName,
        clinicId: input.clinicId,
        clinicName: input.clinicName,
        appointmentDate: input.appointmentDate,
        timeSlot: input.timeSlot,
        status: "upcoming",
        notes: input.notes ?? null
      });
      return getAppointmentById(id);
    }),
    // Mobile: cancel own appointment
    cancel: protectedProcedure.input(z2.object({ id: z2.number() })).mutation(async ({ ctx, input }) => {
      const member = await getMemberByUserId(ctx.user.id);
      if (!member) throw new TRPCError3({ code: "NOT_FOUND", message: "Member profile not found" });
      const appt = await getAppointmentById(input.id);
      if (!appt) throw new TRPCError3({ code: "NOT_FOUND", message: "Appointment not found" });
      if (appt.memberId !== member.id) throw new TRPCError3({ code: "FORBIDDEN", message: "Not your appointment" });
      if (appt.status !== "upcoming") throw new TRPCError3({ code: "BAD_REQUEST", message: "Only upcoming appointments can be cancelled" });
      await cancelAppointment(input.id);
      return { success: true };
    }),
    // Admin: list all appointments with member info
    listAll: publicProcedure.input(z2.object({ limit: z2.number().default(500) })).query(async ({ input }) => {
      return getAllAppointments(input.limit);
    }),
    // Admin: update appointment status (completed / no-show / cancelled / upcoming)
    adminUpdateStatus: publicProcedure.input(z2.object({
      id: z2.number(),
      status: z2.enum(["upcoming", "completed", "cancelled", "no-show"]),
      staffNotes: z2.string().optional(),
      staffId: z2.number().optional(),
      staffName: z2.string().optional()
    })).mutation(async ({ input }) => {
      const appt = await getAppointmentById(input.id);
      if (!appt) throw new TRPCError3({ code: "NOT_FOUND", message: "Appointment not found" });
      await updateAppointmentStatus(input.id, input.status, input.staffNotes);
      await createAuditLog({
        staffId: input.staffId ?? null,
        staffName: input.staffName ?? "Admin",
        action: `appointment.${input.status}`,
        entityType: "appointment",
        entityId: String(input.id),
        entityLabel: `${appt.appointmentDate} ${appt.timeSlot}`,
        details: JSON.stringify({ previousStatus: appt.status, newStatus: input.status, staffNotes: input.staffNotes })
      });
      return { success: true, id: input.id, status: input.status };
    })
  }),
  // ── Group Bookings ────────────────────────────────────────────────────────────────────────
  groupBookings: router({
    listAll: publicProcedure.query(async () => {
      return getAllGroupBookings();
    }),
    getById: publicProcedure.input(z2.object({ id: z2.number() })).query(async ({ input }) => {
      return getGroupBookingById(input.id);
    }),
    create: publicProcedure.input(z2.object({
      corporateGroupId: z2.number(),
      packageId: z2.string(),
      packageName: z2.string(),
      clinicId: z2.string(),
      clinicName: z2.string(),
      bookingDate: z2.string(),
      bookingTime: z2.string(),
      headcount: z2.number().min(1),
      totalAmount: z2.number(),
      totalLumens: z2.number(),
      notes: z2.string().optional(),
      staffId: z2.number().optional(),
      participants: z2.array(z2.object({
        memberId: z2.number().optional(),
        memberNumber: z2.string().optional(),
        participantName: z2.string(),
        participantEmail: z2.string().optional()
      }))
    })).mutation(async ({ input }) => {
      const { participants, ...bookingData } = input;
      const id = await createGroupBooking(
        { ...bookingData, totalAmount: bookingData.totalAmount.toFixed(2), status: "pending" },
        participants.map((p) => ({
          groupBookingId: 0,
          // will be overwritten in createGroupBooking
          participantName: p.participantName,
          participantEmail: p.participantEmail ?? null,
          memberId: p.memberId ?? null,
          memberNumber: p.memberNumber ?? null,
          lumensAwarded: 0
        }))
      );
      return getGroupBookingById(id);
    }),
    updateStatus: publicProcedure.input(z2.object({
      id: z2.number(),
      status: z2.enum(["pending", "confirmed", "completed", "cancelled"])
    })).mutation(async ({ input }) => {
      await updateGroupBookingStatus(input.id, input.status);
      return getGroupBookingById(input.id);
    }),
    complete: publicProcedure.input(z2.object({ id: z2.number(), staffId: z2.number() })).mutation(async ({ input }) => {
      await completeGroupBooking(input.id, input.staffId);
      return getGroupBookingById(input.id);
    })
  }),
  // ── Audit Logs ───────────────────────────────────────────────────────────────────────────────
  admin: router({
    clearAllData: publicProcedure.input(z2.object({ token: z2.string() })).mutation(async ({ input }) => {
      const payload = await verifyStaffToken(input.token);
      if (!payload || payload.role !== "admin") throw new TRPCError3({ code: "FORBIDDEN", message: "Admin access required" });
      await clearAllMemberData();
      return { success: true };
    })
  }),
  audit: router({
    list: publicProcedure.input(z2.object({
      limit: z2.number().default(50),
      offset: z2.number().default(0),
      action: z2.string().optional(),
      entityType: z2.string().optional(),
      staffId: z2.number().optional(),
      dateFrom: z2.string().optional(),
      dateTo: z2.string().optional()
    })).query(async ({ input }) => {
      return getAuditLogs(input);
    })
  })
});

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/index.ts
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
async function startServer() {
  const app = express();
  const server = createServer(app);
  const allowedOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : ["http://localhost:5173", "http://localhost:8081"];
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (allowedOrigins.includes(origin) || allowedOrigins.includes("*"))) {
      res.header("Access-Control-Allow-Origin", origin);
    } else if (!origin) {
      res.header("Access-Control-Allow-Origin", "*");
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization"
    );
    res.header("Access-Control-Allow-Credentials", "true");
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerOAuthRoutes(app);
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  server.listen(port, () => {
    console.log(`[api] server listening on port ${port}`);
  });
}
startServer().catch(console.error);
