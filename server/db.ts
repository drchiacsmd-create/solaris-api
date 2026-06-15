import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, desc, or, ilike, and, sql } from "drizzle-orm";
import {
  InsertUser,
  users,
  members,
  InsertMember,
  transactions,
  InsertTransaction,
  staffAccounts,
  InsertStaffAccount,
  corporateGroups,
  InsertCorporateGroup,
  groupBookings,
  InsertGroupBooking,
  groupBookingParticipants,
  InsertGroupBookingParticipant,
  appointments,
  InsertAppointment,
  auditLogs,
  InsertAuditLog,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
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

// ── Users ─────────────────────────────────────────────────────────────────────
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.openId,
      set: updateSet as Partial<InsertUser>,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// Admin: create a placeholder user row (no OAuth openId) for admin-created members
export async function createAdminUser(email: string, name: string): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const openId = `admin_created_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const result = await db.insert(users).values({ openId, email, name, loginMethod: 'admin', lastSignedIn: new Date() }).returning({ id: users.id });
  return result[0].id;
}

// ── Members ─────────────────────────────────────────────────────────────────
function generateMemberNumber(): string {
  const num = Math.floor(100000 + Math.random() * 900000);
  return `SLR${num}`;
}

function calculateTier(totalSpend: number): "ember" | "radiance" | "solar" | "solaris_elite" {
  if (totalSpend >= 2000) return "solaris_elite";
  if (totalSpend >= 1000) return "solar";
  if (totalSpend >= 500) return "radiance";
  return "ember";
}

export async function createMember(data: Omit<InsertMember, "memberNumber">): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  let memberNumber = generateMemberNumber();
  let existing = await db.select({ id: members.id }).from(members).where(eq(members.memberNumber, memberNumber)).limit(1);
  while (existing.length > 0) {
    memberNumber = generateMemberNumber();
    existing = await db.select({ id: members.id }).from(members).where(eq(members.memberNumber, memberNumber)).limit(1);
  }
  const result = await db.insert(members).values({ ...data, memberNumber }).returning({ id: members.id });
  return result[0].id;
}

export async function getMemberByUserId(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(members).where(eq(members.userId, userId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getMemberById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(members).where(eq(members.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getMemberByNumber(memberNumber: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(members).where(eq(members.memberNumber, memberNumber)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getAllMembers(search?: string) {
  const db = await getDb();
  if (!db) return [];
  if (search) {
    return db.select().from(members).where(
      or(
        ilike(members.firstName, `%${search}%`),
        ilike(members.lastName, `%${search}%`),
        ilike(members.email, `%${search}%`),
        ilike(members.memberNumber, `%${search}%`),
        sql`(${members.firstName} || ' ' || ${members.lastName}) ILIKE ${`%${search}%`}`,
      )
    ).orderBy(desc(members.joinedAt));
  }
  return db.select().from(members).orderBy(desc(members.joinedAt));
}

export async function updateMemberBalance(memberId: number, lumensChange: number, spendChange: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const member = await getMemberById(memberId);
  if (!member) throw new Error("Member not found");
  const newBalance = Math.max(0, member.lumensBalance + lumensChange);
  const newSpend = parseFloat(member.totalSpend as string) + spendChange;
  const newTier = calculateTier(newSpend);
  await db.update(members).set({
    lumensBalance: newBalance,
    totalSpend: newSpend.toFixed(2),
    tier: newTier,
  }).where(eq(members.id, memberId));
}

export async function updateMember(id: number, data: Partial<InsertMember>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(members).set(data).where(eq(members.id, id));
}

export async function savePushToken(memberId: number, token: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(members).set({ pushToken: token }).where(eq(members.id, memberId));
}

// Returns all confirmed/upcoming appointments whose date is between now+23h and now+25h
export async function getAppointmentsForReminder() {
  const db = await getDb();
  if (!db) return [];
  const now = new Date();
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const windowEnd   = new Date(now.getTime() + 25 * 60 * 60 * 1000);
  const rows = await db
    .select({
      appointmentId: appointments.id,
      memberId:      appointments.memberId,
      packageName:   appointments.packageName,
      clinicName:    appointments.clinicName,
      appointmentDate: appointments.appointmentDate,
      timeSlot:      appointments.timeSlot,
      pushToken:     members.pushToken,
    })
    .from(appointments)
    .innerJoin(members, eq(appointments.memberId, members.id))
    .where(
      sql`${appointments.status} = 'confirmed'
        AND ${appointments.appointmentDate} >= ${windowStart.toISOString().slice(0, 10)}
        AND ${appointments.appointmentDate} <= ${windowEnd.toISOString().slice(0, 10)}`
    );
  return rows;
}

// ── Transactions ──────────────────────────────────────────────────────────────
export async function createTransaction(data: InsertTransaction): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(transactions).values(data).returning({ id: transactions.id });
  return result[0].id;
}

export async function getTransactionsByMember(memberId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(transactions)
    .where(eq(transactions.memberId, memberId))
    .orderBy(desc(transactions.createdAt));
}

export async function getAllTransactions(limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(transactions)
    .orderBy(desc(transactions.createdAt))
    .limit(limit);
}

export async function getTransactionStats() {
  const db = await getDb();
  if (!db) return { totalMembers: 0, totalLumensIssued: 0, totalLumensRedeemed: 0, totalRevenue: 0 };
  const [memberCount] = await db.select({ count: sql<number>`count(*)` }).from(members);
  const [activeCount] = await db.select({ count: sql<number>`count(*)` }).from(members).where(eq(members.isActive, true));
  const [corporateCount] = await db.select({ count: sql<number>`count(*)` }).from(members).where(eq(members.isCorporate, true));
  const [earnStats] = await db.select({
    total: sql<number>`COALESCE(SUM("lumensEarned"), 0)`,
    revenue: sql<number>`COALESCE(SUM(CAST("amountPaid" AS DECIMAL(10,2))), 0)`,
  }).from(transactions).where(eq(transactions.type, "earn"));
  const [redeemStats] = await db.select({
    total: sql<number>`COALESCE(SUM("lumensRedeemed"), 0)`,
  }).from(transactions).where(eq(transactions.type, "redeem"));
  return {
    totalMembers: memberCount?.count ?? 0,
    activeMembers: activeCount?.count ?? 0,
    corporateAccounts: corporateCount?.count ?? 0,
    totalLumensIssued: earnStats?.total ?? 0,
    totalLumensRedeemed: redeemStats?.total ?? 0,
    totalRevenue: earnStats?.revenue ?? 0,
  };
}

export async function getTierDistribution() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    tier: members.tier,
    count: sql<number>`count(*)`,
  }).from(members).groupBy(members.tier);
}

// ── Staff Accounts ────────────────────────────────────────────────────────────
export async function createStaffAccount(data: InsertStaffAccount): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(staffAccounts).values(data).returning({ id: staffAccounts.id });
  return result[0].id;
}

export async function getStaffByUsername(username: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(staffAccounts).where(
    and(eq(staffAccounts.username, username), eq(staffAccounts.isActive, true))
  ).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getStaffById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(staffAccounts).where(eq(staffAccounts.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateStaffLastLogin(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(staffAccounts).set({ lastLoginAt: new Date() }).where(eq(staffAccounts.id, id));
}

export async function getAllStaff() {
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
    createdAt: staffAccounts.createdAt,
  }).from(staffAccounts).orderBy(staffAccounts.fullName);
}

export async function updateStaffAccount(id: number, data: Partial<Pick<InsertStaffAccount, 'fullName' | 'role' | 'clinicId' | 'isActive'>>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(staffAccounts).set(data).where(eq(staffAccounts.id, id));
}

export async function updateStaffPassword(id: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(staffAccounts).set({ passwordHash }).where(eq(staffAccounts.id, id));
}

// ── Corporate Groups ──────────────────────────────────────────────────────────
export async function createCorporateGroup(data: InsertCorporateGroup): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(corporateGroups).values(data).returning({ id: corporateGroups.id });
  return result[0].id;
}

export async function getAllCorporateGroups() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(corporateGroups).where(eq(corporateGroups.isActive, true)).orderBy(corporateGroups.name);
}

export async function getCorporateGroupById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(corporateGroups).where(eq(corporateGroups.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ── Group Bookings ────────────────────────────────────────────────────────────
export async function createGroupBooking(
  booking: InsertGroupBooking,
  participants: InsertGroupBookingParticipant[]
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(groupBookings).values(booking).returning({ id: groupBookings.id });
  const bookingId = result[0].id;
  if (participants.length > 0) {
    await db.insert(groupBookingParticipants).values(
      participants.map(p => ({ ...p, groupBookingId: bookingId }))
    );
  }
  return bookingId;
}

export async function getAllGroupBookings() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(groupBookings).orderBy(desc(groupBookings.createdAt));
}

export async function getGroupBookingById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [booking] = await db.select().from(groupBookings).where(eq(groupBookings.id, id)).limit(1);
  if (!booking) return undefined;
  const participants = await db.select().from(groupBookingParticipants)
    .where(eq(groupBookingParticipants.groupBookingId, id));
  return { ...booking, participants };
}

export async function updateGroupBookingStatus(id: number, status: "pending" | "confirmed" | "completed" | "cancelled") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(groupBookings).set({ status }).where(eq(groupBookings.id, id));
}

export async function completeGroupBooking(bookingId: number, staffId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const booking = await getGroupBookingById(bookingId);
  if (!booking) throw new Error("Booking not found");
  if (booking.status === "completed") throw new Error("Booking already completed");

  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + 365);

  for (const participant of booking.participants) {
    if (!participant.memberId) continue;
    const lumens = Math.floor(parseFloat(booking.totalAmount as string) / booking.headcount);
    const txId = await createTransaction({
      memberId: participant.memberId,
      type: "earn",
      packageId: booking.packageId,
      packageName: booking.packageName,
      amountPaid: (parseFloat(booking.totalAmount as string) / booking.headcount).toFixed(2),
      lumensEarned: lumens,
      lumensRedeemed: 0,
      lumensRate: "1.00",
      isCorporateRate: true,
      clinicId: booking.clinicId,
      clinicName: booking.clinicName,
      staffId,
      notes: `Group booking #${bookingId} — ${booking.corporateGroupId}`,
      expiryDate,
    });
    await updateMemberBalance(participant.memberId, lumens, parseFloat(booking.totalAmount as string) / booking.headcount);
    await db.update(groupBookingParticipants).set({
      lumensAwarded: lumens,
      transactionId: txId,
    }).where(eq(groupBookingParticipants.id, participant.id));
  }

  await db.update(groupBookings).set({ status: "completed" }).where(eq(groupBookings.id, bookingId));
}

// ── Appointments ──────────────────────────────────────────────────────────────
export async function createAppointment(data: InsertAppointment): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(appointments).values(data).returning({ id: appointments.id });
  return result[0].id;
}

export async function getAppointmentsByMember(memberId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(appointments)
    .where(eq(appointments.memberId, memberId))
    .orderBy(desc(appointments.appointmentDate), desc(appointments.timeSlot));
}

export async function getAppointmentById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(appointments).where(eq(appointments.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function cancelAppointment(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(appointments).set({ status: "cancelled" }).where(eq(appointments.id, id));
}

export async function getAllAppointments(limit = 200) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
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
      memberPhone: members.phone,
    })
    .from(appointments)
    .leftJoin(members, eq(appointments.memberId, members.id))
    .orderBy(desc(appointments.appointmentDate), desc(appointments.timeSlot))
    .limit(limit);
  return rows;
}

export async function updateAppointmentStatus(
  id: number,
  status: "upcoming" | "completed" | "cancelled" | "no-show",
  staffNotes?: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const updateData: Record<string, unknown> = { status };
  if (staffNotes !== undefined) updateData.notes = staffNotes;
  await db.update(appointments).set(updateData).where(eq(appointments.id, id));
}

// ── Audit Logs ────────────────────────────────────────────────────────────────
export async function createAuditLog(data: Omit<InsertAuditLog, "id" | "createdAt">): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(auditLogs).values(data);
  } catch (err) {
    console.warn("[AuditLog] Failed to write audit log:", err);
  }
}

export async function getAuditLogs(opts?: {
  limit?: number;
  offset?: number;
  action?: string;
  entityType?: string;
  staffId?: number;
  dateFrom?: string;
  dateTo?: string;
}) {
  const db = await getDb();
  if (!db) return { rows: [], total: 0 };
  const {
    limit = 50,
    offset = 0,
    action,
    entityType,
    staffId,
    dateFrom,
    dateTo,
  } = opts ?? {};

  const conditions: ReturnType<typeof eq>[] = [];
  if (action) conditions.push(eq(auditLogs.action, action));
  if (entityType) conditions.push(eq(auditLogs.entityType, entityType));
  if (staffId) conditions.push(eq(auditLogs.staffId as any, staffId));
  if (dateFrom) conditions.push(sql`DATE(${auditLogs.createdAt}) >= ${dateFrom}` as any);
  if (dateTo) conditions.push(sql`DATE(${auditLogs.createdAt}) <= ${dateTo}` as any);

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, countResult] = await Promise.all([
    db.select().from(auditLogs)
      .where(whereClause)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(auditLogs).where(whereClause),
  ]);

  return { rows, total: countResult[0]?.count ?? 0 };
}
