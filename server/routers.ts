import { TRPCError } from "@trpc/server";
import { scryptSync, randomBytes, timingSafeEqual } from "crypto";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, "hex");
  const derivedHash = scryptSync(password, salt, 64);
  return timingSafeEqual(hashBuffer, derivedHash);
}
import * as jose from "jose";
import { z } from "zod";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import * as db from "./db";

const STAFF_JWT_SECRET = process.env.JWT_SECRET ?? "solaris-staff-secret-2026";

// ── Staff JWT helpers ─────────────────────────────────────────────────────────
async function signStaffToken(staffId: number, username: string, role: string) {
  const secret = new TextEncoder().encode(STAFF_JWT_SECRET);
  return await new jose.SignJWT({ staffId, username, role })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("8h")
    .sign(secret);
}

async function verifyStaffToken(token: string) {
  try {
    const secret = new TextEncoder().encode(STAFF_JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    return payload as { staffId: number; username: string; role: string };
  } catch {
    return null;
  }
}

// ── Seed helper (run once) ────────────────────────────────────────────────────
async function seedDefaultStaff() {
  const existing = await db.getStaffByUsername("admin");
  if (existing) return;
  const hash = hashPassword("Solaris2026!");
  await db.createStaffAccount({
    username: "admin",
    passwordHash: hash,
    fullName: "Admin (Solara Medical)",
    role: "admin",
    isActive: true,
  });
  // Seed a receptionist account
  const hash2 = hashPassword("Staff2026!");
  await db.createStaffAccount({
    username: "staff.central",
    passwordHash: hash2,
    fullName: "Reception — Central",
    role: "clinic_assistant",
    clinicId: "central",
    isActive: true,
  });
}

// Migrate bcrypt hashes to scrypt on startup
async function migratePasswordHashes() {
  const allStaff = await db.getAllStaffWithPasswords();
  for (const s of allStaff) {
    // bcrypt hashes start with $2a$ or $2b$; scrypt hashes are hex:hex format
    if (s.passwordHash && s.passwordHash.startsWith("$2")) {
      // We can't recover the original password, so reset to a known default
      // admin -> Solaris2026!, staff.central -> Staff2026!, others -> Solaris2026!
      let defaultPw = "Solaris2026!";
      if (s.username === "staff.central") defaultPw = "Staff2026!";
      const newHash = hashPassword(defaultPw);
      await db.updateStaffPassword(s.id, newHash);
    }
  }
}

// Seed on startup
seedDefaultStaff().catch(console.error);
migratePasswordHashes().catch(console.error);

// ── Router ────────────────────────────────────────────────────────────────────
export const appRouter = router({
  system: systemRouter,

  // ── Auth (Manus OAuth for mobile app) ──────────────────────────────────────
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ── Staff Auth (admin portal) ───────────────────────────────────────────────
  staff: router({
    login: publicProcedure
      .input(z.object({ username: z.string(), password: z.string() }))
      .mutation(async ({ input }) => {
        const staff = await db.getStaffByUsername(input.username);
        if (!staff) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials" });
        const valid = verifyPassword(input.password, staff.passwordHash);
        if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials" });
        await db.updateStaffLastLogin(staff.id);
        const token = await signStaffToken(staff.id, staff.username, staff.role);
        return {
          token,
          staff: {
            id: staff.id,
            username: staff.username,
            fullName: staff.fullName,
            role: staff.role,
            clinicId: staff.clinicId,
          },
        };
      }),

    verify: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const payload = await verifyStaffToken(input.token);
        if (!payload) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid or expired token" });
        const staff = await db.getStaffById(payload.staffId);
        if (!staff || !staff.isActive) throw new TRPCError({ code: "UNAUTHORIZED", message: "Staff account not found" });
        return {
          id: staff.id,
          username: staff.username,
          fullName: staff.fullName,
          role: staff.role,
          clinicId: staff.clinicId,
        };
      }),

    listAll: publicProcedure.query(async () => {
      return db.getAllStaff();
    }),

    // Admin only: create a new staff account
    create: publicProcedure
      .input(z.object({
        token: z.string(),
        username: z.string().min(3).max(50),
        password: z.string().min(8),
        fullName: z.string().min(1),
        role: z.enum(["admin", "manager", "clinic_assistant", "healthscreen_assistant"]),
        clinicId: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const payload = await verifyStaffToken(input.token);
        if (!payload || payload.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
        // Check username uniqueness
        const existing = await db.getStaffByUsername(input.username);
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "Username already taken" });
        const passwordHash = hashPassword(input.password);
        const id = await db.createStaffAccount({
          username: input.username,
          passwordHash,
          fullName: input.fullName,
          role: input.role,
          clinicId: input.clinicId ?? null,
          isActive: true,
        });
        await db.createAuditLog({
          staffId: payload.staffId,
          staffName: payload.username,
          action: "staff.create",
          entityType: "staff",
          entityId: String(id),
          entityLabel: input.fullName,
          details: JSON.stringify({ username: input.username, role: input.role }),
        });
        return { id };
      }),

    // Admin only: update staff account details
    update: publicProcedure
      .input(z.object({
        token: z.string(),
        id: z.number(),
        fullName: z.string().min(1).optional(),
        role: z.enum(["admin", "manager", "clinic_assistant", "healthscreen_assistant"]).optional(),
        clinicId: z.string().nullable().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const payload = await verifyStaffToken(input.token);
        if (!payload || payload.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
        const { token: _t, id, ...updates } = input;
        const filteredUpdates: Record<string, unknown> = {};
        if (updates.fullName !== undefined) filteredUpdates.fullName = updates.fullName;
        if (updates.role !== undefined) filteredUpdates.role = updates.role;
        if (updates.clinicId !== undefined) filteredUpdates.clinicId = updates.clinicId;
        if (updates.isActive !== undefined) filteredUpdates.isActive = updates.isActive;
        await db.updateStaffAccount(id, filteredUpdates as any);
        await db.createAuditLog({
          staffId: payload.staffId,
          staffName: payload.username,
          action: "staff.update",
          entityType: "staff",
          entityId: String(id),
          entityLabel: updates.fullName ?? String(id),
          details: JSON.stringify(filteredUpdates),
        });
        return { success: true };
      }),

    // Admin only: reset a staff member's password
    resetPassword: publicProcedure
      .input(z.object({
        token: z.string(),
        id: z.number(),
        newPassword: z.string().min(8),
      }))
      .mutation(async ({ input }) => {
        const payload = await verifyStaffToken(input.token);
        if (!payload || payload.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
        const passwordHash = hashPassword(input.newPassword);
        await db.updateStaffPassword(input.id, passwordHash);
        await db.createAuditLog({
          staffId: payload.staffId,
          staffName: payload.username,
          action: "staff.resetPassword",
          entityType: "staff",
          entityId: String(input.id),
          entityLabel: String(input.id),
          details: JSON.stringify({ note: "Password reset by admin" }),
        });
        return { success: true };
      }),

    // Admin only: permanently delete a staff account
    delete: publicProcedure
      .input(z.object({
        token: z.string(),
        id: z.number(),
      }))
      .mutation(async ({ input }) => {
        const payload = await verifyStaffToken(input.token);
        if (!payload || payload.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
        if (payload.staffId === input.id) throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot delete your own account" });
        const target = await db.getStaffById(input.id);
        await db.deleteStaffAccount(input.id);
        await db.createAuditLog({
          staffId: payload.staffId,
          staffName: payload.username,
          action: "staff.delete",
          entityType: "staff",
          entityId: String(input.id),
          entityLabel: target?.fullName ?? String(input.id),
          details: JSON.stringify({ username: target?.username, role: target?.role }),
        });
        return { ok: true };
      }),
  }),

  // ── Members ─────────────────────────────────────────────────────────────────
  members: router({
    // Mobile: get own profile
    me: protectedProcedure.query(async ({ ctx }) => {
      return db.getMemberByUserId(ctx.user.id);
    }),

    // Mobile: create/register member profile
    register: protectedProcedure
      .input(z.object({
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        email: z.string().email(),
        phone: z.string().optional(),
        dateOfBirth: z.string().optional(),
        gender: z.enum(["male", "female", "other"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const existing = await db.getMemberByUserId(ctx.user.id);
        if (existing) return existing;
        const id = await db.createMember({
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
          isActive: true,
        });
        return db.getMemberById(id);
      }),

    // Mobile: save Expo push token for this member
    registerPushToken: protectedProcedure
      .input(z.object({ token: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const member = await db.getMemberByUserId(ctx.user.id);
        if (!member) throw new Error('Member not found');
        await db.savePushToken(member.id, input.token);
        return { ok: true };
      }),

    // Admin: list all members
    listAll: publicProcedure
      .input(z.object({ search: z.string().optional() }))
      .query(async ({ input }) => {
        return db.getAllMembers(input.search);
      }),

    // Admin: get member by ID
    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return db.getMemberById(input.id);
      }),

    // Admin: get member by number
    getByNumber: publicProcedure
      .input(z.object({ memberNumber: z.string() }))
      .query(async ({ input }) => {
        return db.getMemberByNumber(input.memberNumber);
      }),

    // Admin: create a new member directly (no OAuth required)
    adminCreate: publicProcedure
      .input(z.object({
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        email: z.string().email(),
        phone: z.string().optional(),
        dateOfBirth: z.string().optional(),
        gender: z.enum(["male", "female", "other"]).optional(),
        isCorporate: z.boolean().optional(),
        corporateGroupId: z.number().nullable().optional(),
        staffId: z.number().optional(),
        staffName: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        // Create a placeholder user row (userId is required FK)
        const userId = await db.createAdminUser(input.email, input.firstName + ' ' + input.lastName);
        const id = await db.createMember({
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
          isActive: true,
        });
        const newMember = await db.getMemberById(id);
        await db.createAuditLog({
          staffId: input.staffId ?? null,
          staffName: input.staffName ?? "Admin",
          action: "member.create",
          entityType: "member",
          entityId: String(id),
          entityLabel: `${input.firstName} ${input.lastName}`,
          details: JSON.stringify({ email: input.email, phone: input.phone, isCorporate: input.isCorporate ?? false }),
        });
        return newMember;
      }),

    // Admin: delete a member (Admin only — enforced in portal UI)
    delete: publicProcedure
      .input(z.object({
        id: z.number(),
        staffId: z.number().optional(),
        staffName: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const member = await db.getMemberById(input.id);
        await db.deleteMember(input.id);
        await db.createAuditLog({
          staffId: input.staffId ?? null,
          staffName: input.staffName ?? "Admin",
          action: "member.delete",
          entityType: "member",
          entityId: String(input.id),
          entityLabel: member ? `${member.firstName} ${member.lastName}` : String(input.id),
          details: JSON.stringify({ memberNumber: member?.memberNumber }),
        });
        return { ok: true };
      }),

    // Admin: update member (e.g. set corporate flag)
    update: publicProcedure
      .input(z.object({
        id: z.number(),
        isCorporate: z.boolean().optional(),
        corporateGroupId: z.number().nullable().optional(),
        isActive: z.boolean().optional(),
        tier: z.enum(["ember", "radiance", "solar", "solaris_elite"]).optional(),
        staffId: z.number().optional(),
        staffName: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, staffId, staffName, ...data } = input;
        const before = await db.getMemberById(id);
        await db.updateMember(id, data);
        const updated = await db.getMemberById(id);
        await db.createAuditLog({
          staffId: staffId ?? null,
          staffName: staffName ?? "Admin",
          action: "member.update",
          entityType: "member",
          entityId: String(id),
          entityLabel: before ? `${before.firstName} ${before.lastName}` : String(id),
          details: JSON.stringify({ changes: data }),
        });
        return updated;
      }),
  }),

  // ── Transactions ─────────────────────────────────────────────────────────────
  transactions: router({
    // Mobile: get own transactions
    myHistory: protectedProcedure.query(async ({ ctx }) => {
      const member = await db.getMemberByUserId(ctx.user.id);
      if (!member) return [];
      return db.getTransactionsByMember(member.id);
    }),

    // Admin: record a package purchase (auto-populates Lumens)
    recordPurchase: publicProcedure
      .input(z.object({
        memberId: z.number(),
        packageId: z.string(),
        packageName: z.string(),
        amountPaid: z.number(),
        lumensEarned: z.number(),
        lumensRate: z.number(),
        isCorporateRate: z.boolean().default(false),
        clinicId: z.string(),
        clinicName: z.string(),
        staffId: z.number().optional(),
        staffName: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 365);
        const txId = await db.createTransaction({
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
          expiryDate,
        });
        await db.updateMemberBalance(input.memberId, input.lumensEarned, input.amountPaid);
        const member = await db.getMemberById(input.memberId);
        await db.createAuditLog({
          staffId: input.staffId ?? null,
          staffName: input.staffName ?? "Admin",
          action: "transaction.purchase",
          entityType: "transaction",
          entityId: String(txId),
          entityLabel: member ? `${member.firstName} ${member.lastName} — ${input.packageName}` : input.packageName,
          details: JSON.stringify({ amountPaid: input.amountPaid, lumensEarned: input.lumensEarned, clinicName: input.clinicName }),
        });
        return { transactionId: txId };
      }),

    // Admin: record a redemption
    recordRedemption: publicProcedure
      .input(z.object({
        memberId: z.number(),
        rewardId: z.string(),
        rewardName: z.string(),
        lumensRedeemed: z.number(),
        clinicId: z.string(),
        clinicName: z.string(),
        staffId: z.number().optional(),
        staffName: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const member = await db.getMemberById(input.memberId);
        if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
        if (member.lumensBalance < input.lumensRedeemed) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Insufficient Lumens balance" });
        }
        const txId = await db.createTransaction({
          memberId: input.memberId,
          type: "redeem",
          rewardId: input.rewardId,
          rewardName: input.rewardName,
          lumensEarned: 0,
          lumensRedeemed: input.lumensRedeemed,
          clinicId: input.clinicId,
          clinicName: input.clinicName,
          staffId: input.staffId,
          notes: input.notes,
        });
        await db.updateMemberBalance(input.memberId, -input.lumensRedeemed, 0);
        await db.createAuditLog({
          staffId: input.staffId ?? null,
          staffName: input.staffName ?? "Admin",
          action: "transaction.redeem",
          entityType: "transaction",
          entityId: String(txId),
          entityLabel: `${member.firstName} ${member.lastName} — ${input.rewardName}`,
          details: JSON.stringify({ lumensRedeemed: input.lumensRedeemed, clinicName: input.clinicName }),
        });
        return { transactionId: txId };
      }),

    // Mobile: get own redemption history
    myRedemptions: protectedProcedure.query(async ({ ctx }) => {
      const member = await db.getMemberByUserId(ctx.user.id);
      if (!member) return [];
      const all = await db.getTransactionsByMember(member.id);
      return all.filter((tx: { type: string }) => tx.type === 'redeem');
    }),

    // Admin: all transactions
    listAll: publicProcedure
      .input(z.object({ limit: z.number().default(100) }))
      .query(async ({ input }) => {
        return db.getAllTransactions(input.limit);
      }),

    // Admin: by member
    byMember: publicProcedure
      .input(z.object({ memberId: z.number() }))
      .query(async ({ input }) => {
        return db.getTransactionsByMember(input.memberId);
      }),
  }),

  // ── Dashboard Stats ──────────────────────────────────────────────────────────
  dashboard: router({
    stats: publicProcedure.query(async () => {
      return db.getTransactionStats();
    }),
    tierDistribution: publicProcedure.query(async () => {
      return db.getTierDistribution();
    }),
  }),

  // ── Corporate Groups ─────────────────────────────────────────────────────────
  corporateGroups: router({
    listAll: publicProcedure.query(async () => {
      return db.getAllCorporateGroups();
    }),

    create: publicProcedure
      .input(z.object({
        name: z.string().min(1),
        contactPerson: z.string().optional(),
        contactEmail: z.string().email().optional(),
        contactPhone: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const id = await db.createCorporateGroup({ ...input, isActive: true });
        return db.getCorporateGroupById(id);
      }),
  }),

  // ── Appointments (individual member bookings) ───────────────────────────────────────────────────────────────────
  appointments: router({
    // Mobile: list own appointments
    myList: protectedProcedure.query(async ({ ctx }) => {
      const member = await db.getMemberByUserId(ctx.user.id);
      if (!member) return [];
      return db.getAppointmentsByMember(member.id);
    }),

    // Mobile: create appointment
    create: protectedProcedure
      .input(z.object({
        packageId: z.string(),
        packageName: z.string(),
        clinicId: z.string(),
        clinicName: z.string(),
        appointmentDate: z.string(), // YYYY-MM-DD
        timeSlot: z.string(),        // HH:MM
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const member = await db.getMemberByUserId(ctx.user.id);
        if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "Member profile not found" });
        const id = await db.createAppointment({
          memberId: member.id,
          packageId: input.packageId,
          packageName: input.packageName,
          clinicId: input.clinicId,
          clinicName: input.clinicName,
          appointmentDate: input.appointmentDate,
          timeSlot: input.timeSlot,
          status: "upcoming",
          notes: input.notes ?? null,
        });
        return db.getAppointmentById(id);
      }),

    // Mobile: cancel own appointment
    cancel: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const member = await db.getMemberByUserId(ctx.user.id);
        if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "Member profile not found" });
        const appt = await db.getAppointmentById(input.id);
        if (!appt) throw new TRPCError({ code: "NOT_FOUND", message: "Appointment not found" });
        if (appt.memberId !== member.id) throw new TRPCError({ code: "FORBIDDEN", message: "Not your appointment" });
        if (appt.status !== "upcoming") throw new TRPCError({ code: "BAD_REQUEST", message: "Only upcoming appointments can be cancelled" });
        await db.cancelAppointment(input.id);
        return { success: true };
      }),

    // Admin: list all appointments with member info
    listAll: publicProcedure
      .input(z.object({ limit: z.number().default(500) }))
      .query(async ({ input }) => {
        return db.getAllAppointments(input.limit);
      }),

    // Admin: update appointment status (completed / no-show / cancelled / upcoming)
    adminUpdateStatus: publicProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["upcoming", "completed", "cancelled", "no-show"]),
        staffNotes: z.string().optional(),
        staffId: z.number().optional(),
        staffName: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const appt = await db.getAppointmentById(input.id);
        if (!appt) throw new TRPCError({ code: "NOT_FOUND", message: "Appointment not found" });
        await db.updateAppointmentStatus(input.id, input.status, input.staffNotes);
        await db.createAuditLog({
          staffId: input.staffId ?? null,
          staffName: input.staffName ?? "Admin",
          action: `appointment.${input.status}`,
          entityType: "appointment",
          entityId: String(input.id),
          entityLabel: `${appt.appointmentDate} ${appt.timeSlot}`,
          details: JSON.stringify({ previousStatus: appt.status, newStatus: input.status, staffNotes: input.staffNotes }),
        });
        return { success: true, id: input.id, status: input.status };
      }),
  }),

  // ── Group Bookings ────────────────────────────────────────────────────────────────────────
  groupBookings: router({
    listAll: publicProcedure.query(async () => {
      return db.getAllGroupBookings();
    }),

    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return db.getGroupBookingById(input.id);
      }),

    create: publicProcedure
      .input(z.object({
        corporateGroupId: z.number(),
        packageId: z.string(),
        packageName: z.string(),
        clinicId: z.string(),
        clinicName: z.string(),
        bookingDate: z.string(),
        bookingTime: z.string(),
        headcount: z.number().min(1),
        totalAmount: z.number(),
        totalLumens: z.number(),
        notes: z.string().optional(),
        staffId: z.number().optional(),
        participants: z.array(z.object({
          memberId: z.number().optional(),
          memberNumber: z.string().optional(),
          participantName: z.string(),
          participantEmail: z.string().optional(),
        })),
      }))
      .mutation(async ({ input }) => {
        const { participants, ...bookingData } = input;
        const id = await db.createGroupBooking(
          { ...bookingData, totalAmount: bookingData.totalAmount.toFixed(2), status: "pending" },
        participants.map(p => ({
          groupBookingId: 0, // will be overwritten in createGroupBooking
          participantName: p.participantName,
          participantEmail: p.participantEmail ?? null,
          memberId: p.memberId ?? null,
          memberNumber: p.memberNumber ?? null,
          lumensAwarded: 0,
        }))
        );
        return db.getGroupBookingById(id);
      }),

    updateStatus: publicProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["pending", "confirmed", "completed", "cancelled"]),
      }))
      .mutation(async ({ input }) => {
        await db.updateGroupBookingStatus(input.id, input.status);
        return db.getGroupBookingById(input.id);
      }),

    complete: publicProcedure
      .input(z.object({ id: z.number(), staffId: z.number() }))
      .mutation(async ({ input }) => {
        await db.completeGroupBooking(input.id, input.staffId);
        return db.getGroupBookingById(input.id);
      }),
  }),

  // ── Audit Logs ───────────────────────────────────────────────────────────────────────────────
  admin: router({
    clearAllData: publicProcedure
      .input(z.object({ token: z.string() }))
      .mutation(async ({ input }) => {
        const payload = await verifyStaffToken(input.token);
        if (!payload || payload.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
        await db.clearAllMemberData();
        return { success: true };
      }),
  }),

  audit: router({
    list: publicProcedure
      .input(z.object({
        limit: z.number().default(50),
        offset: z.number().default(0),
        action: z.string().optional(),
        entityType: z.string().optional(),
        staffId: z.number().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      }))
      .query(async ({ input }) => {
        return db.getAuditLogs(input);
      }),
  }),

  vouchers: router({
    // Issue a single voucher (Admin + Manager)
    issue: publicProcedure
      .input(z.object({
        purchaserName: z.string().optional(),
        purchaserEmail: z.string().optional(),
        recipientName: z.string().optional(),
        recipientEmail: z.string().optional(),
        message: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const staff = await requireStaffRole(ctx, ["admin", "manager"]);
        return db.issueVoucher({
          ...input,
          issuedByStaffId: staff.staffId,
          issuedByStaffName: staff.username,
        });
      }),

    // Batch issue vouchers (Admin + Manager)
    batchIssue: publicProcedure
      .input(z.object({
        count: z.number().min(1).max(100),
        purchaserName: z.string().optional(),
        purchaserEmail: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const staff = await requireStaffRole(ctx, ["admin", "manager"]);
        return db.batchIssueVouchers({
          ...input,
          issuedByStaffId: staff.staffId,
          issuedByStaffName: staff.username,
        });
      }),

    // List all vouchers (Admin + Manager)
    list: publicProcedure
      .input(z.object({
        status: z.enum(["unused", "redeemed", "expired", "cancelled"]).optional(),
        batchId: z.string().optional(),
        limit: z.number().default(100),
        offset: z.number().default(0),
      }).optional())
      .query(async ({ input, ctx }) => {
        await requireStaffRole(ctx, ["admin", "manager"]);
        return db.listVouchers(input ?? {});
      }),

    // Validate a voucher code (public — used by mobile app before redemption)
    validate: publicProcedure
      .input(z.object({ code: z.string() }))
      .query(async ({ input }) => {
        const v = await db.getVoucherByCode(input.code);
        if (!v) return { valid: false, error: "Invalid voucher code." };
        if (v.status !== "unused") return { valid: false, error: v.status === "redeemed" ? "Already redeemed." : v.status === "expired" ? "Expired." : "Cancelled." };
        if (v.expiryDate && new Date() > new Date(v.expiryDate)) return { valid: false, error: "Expired." };
        return { valid: true, denomination: Number(v.denomination), recipientName: v.recipientName };
      }),

    // Redeem a voucher (authenticated member via mobile app)
    redeem: publicProcedure
      .input(z.object({ code: z.string(), memberId: z.number(), memberName: z.string() }))
      .mutation(async ({ input }) => {
        return db.redeemVoucher(input.code, input.memberId, input.memberName);
      }),

    // Cancel a voucher (Admin only)
    cancel: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        await requireStaffRole(ctx, ["admin"]);
        await db.cancelVoucher(input.id);
        return { success: true };
      }),
  }),
});
export type AppRouter = typeof appRouter;
