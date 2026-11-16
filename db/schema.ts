// Count Me In data model (backlog item 0.2).
// Never stored: surname, phone, home address, date of birth, payment data.
// The email address stays in Supabase Auth; person.auth_user_id links to it.
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { CARD_STATES } from "../lib/card-state";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

export const person = sqliteTable(
  "person",
  {
    id: text("id").primaryKey(),
    authUserId: text("auth_user_id").notNull().unique(),
    displayName: text("display_name").notNull(),
    postcodeDistrict: text("postcode_district").notNull(),
    // Self-declared "I am 18 or over"; not age verification.
    adultConfirmedAt: text("adult_confirmed_at").notNull(),
    rulesVersion: text("rules_version").notNull(),
    showName: integer("show_name", { mode: "boolean" }).notNull().default(false),
    emailPrefs: text("email_prefs").notNull().default('{"digest":false}'),
    role: text("role", { enum: ["participant", "moderator"] }).notNull().default("participant"),
    blockedAt: text("blocked_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    check("person_name_length", sql`length(${t.displayName}) BETWEEN 1 AND 40`),
    check("person_district_length", sql`length(${t.postcodeDistrict}) BETWEEN 2 AND 4`),
    check("person_role", sql`${t.role} IN ('participant', 'moderator')`),
  ],
);

export const activity = sqliteTable(
  "activity",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    outcome: text("outcome").notNull(),
    minPeople: integer("min_people").notNull(),
    maxPeople: integer("max_people").notNull(),
    durationMin: integer("duration_min").notNull(),
    bring: text("bring").notNull().default(""),
    materialsCostPence: integer("materials_cost_pence").notNull().default(0),
    placeKind: text("place_kind", { enum: ["venue", "public"] }).notNull(),
    needsKnower: integer("needs_knower", { mode: "boolean" }).notNull().default(false),
    season: text("season"),
    instructions: text("instructions"),
    state: text("state", { enum: CARD_STATES }).notNull().default("in_review"),
    authorId: text("author_id").references(() => person.id, { onDelete: "set null" }),
    rejectionReason: text("rejection_reason"),
    timesRun: integer("times_run").notNull().default(0),
    lastInterestAt: text("last_interest_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    index("activity_state").on(t.state),
    check("activity_min_people", sql`${t.minPeople} >= 2`),
    check("activity_max_people", sql`${t.maxPeople} >= ${t.minPeople}`),
    check("activity_duration", sql`${t.durationMin} > 0`),
    check("activity_cost", sql`${t.materialsCostPence} >= 0`),
    check("activity_place_kind", sql`${t.placeKind} IN ('venue', 'public')`),
    check("activity_state_check", sql`${t.state} IN (${inList(CARD_STATES)})`),
  ],
);

export const interest = sqliteTable(
  "interest",
  {
    personId: text("person_id").notNull().references(() => person.id, { onDelete: "cascade" }),
    activityId: text("activity_id").notNull().references(() => activity.id, { onDelete: "cascade" }),
    // JSON subset of ["weekday_evening", "saturday", "sunday"].
    times: text("times").notNull().default("[]"),
    level: text("level", { enum: ["never", "can", "can_show"] }),
    bringing: text("bringing"),
    queued: integer("queued", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.personId, t.activityId] }), index("interest_activity").on(t.activityId)],
);

export const round = sqliteTable(
  "round",
  {
    id: text("id").primaryKey(),
    activityId: text("activity_id").notNull().references(() => activity.id),
    openedAt: text("opened_at").notNull(),
    closesAt: text("closes_at").notNull(),
    outcome: text("outcome", { enum: ["open", "won", "failed"] }).notNull().default("open"),
  },
  // At most one open round per activity.
  (t) => [uniqueIndex("round_one_open").on(t.activityId).where(sql`outcome = 'open'`)],
);

export const slot = sqliteTable(
  "slot",
  {
    id: text("id").primaryKey(),
    roundId: text("round_id").notNull().references(() => round.id, { onDelete: "cascade" }),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    status: text("status", { enum: ["open", "won", "closed"] }).notNull().default("open"),
  },
  // TIME-03: two simultaneous votes must not produce two gatherings.
  (t) => [uniqueIndex("slot_one_winner").on(t.roundId).where(sql`status = 'won'`)],
);

export const slotVote = sqliteTable(
  "slot_vote",
  {
    slotId: text("slot_id").notNull().references(() => slot.id, { onDelete: "cascade" }),
    personId: text("person_id").notNull().references(() => person.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.slotId, t.personId] })],
);

export const place = sqliteTable(
  "place",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    address: text("address").notNull(),
    postcodeDistrict: text("postcode_district").notNull(),
    kind: text("kind", { enum: ["venue", "public"] }).notNull(),
    capacity: integer("capacity"),
    facilities: text("facilities").notNull().default(""),
    stepFree: integer("step_free", { mode: "boolean" }).notNull(),
    priceText: text("price_text"),
    termsText: text("terms_text"),
    bookingEmail: text("booking_email"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [check("place_venue_email", sql`${t.kind} = 'public' OR ${t.bookingEmail} IS NOT NULL`)],
);

export const placeWindow = sqliteTable(
  "place_window",
  {
    id: text("id").primaryKey(),
    placeId: text("place_id").notNull().references(() => place.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(), // 1 = Monday
    startTime: text("start_time").notNull(), // HH:MM, Europe/London
    endTime: text("end_time").notNull(),
    autoApprove: integer("auto_approve", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [check("place_window_weekday", sql`${t.weekday} BETWEEN 1 AND 7`)],
);

export const gathering = sqliteTable(
  "gathering",
  {
    id: text("id").primaryKey(),
    roundId: text("round_id").notNull().unique().references(() => round.id),
    slotId: text("slot_id").notNull().unique().references(() => slot.id),
    placeId: text("place_id").references(() => place.id),
    hostPersonId: text("host_person_id").references(() => person.id, { onDelete: "set null" }),
    status: text("status", { enum: ["awaiting_place", "scheduled", "cancelled", "happened"] }).notNull().default("awaiting_place"),
    ownerAttended: integer("owner_attended", { mode: "boolean" }),
  },
  (t) => [
    check(
      "gathering_scheduled_needs_place_and_host",
      sql`${t.status} <> 'scheduled' OR (${t.placeId} IS NOT NULL AND ${t.hostPersonId} IS NOT NULL)`,
    ),
  ],
);

export const attendance = sqliteTable(
  "attendance",
  {
    gatheringId: text("gathering_id").notNull().references(() => gathering.id, { onDelete: "cascade" }),
    personId: text("person_id").notNull().references(() => person.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["going", "left"] }).notNull().default("going"),
    joinedAt: text("joined_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.gatheringId, t.personId] })],
);

export const venueRequest = sqliteTable(
  "venue_request",
  {
    id: text("id").primaryKey(),
    gatheringId: text("gathering_id").notNull().references(() => gathering.id, { onDelete: "cascade" }),
    placeId: text("place_id").notNull().references(() => place.id),
    sentAt: text("sent_at").notNull(),
    deadlineAt: text("deadline_at").notNull(),
    response: text("response", { enum: ["approved", "declined", "expired", "late"] }),
    respondedAt: text("responded_at"),
    tokenHash: text("token_hash").notNull().unique(),
  },
  (t) => [
    uniqueIndex("venue_request_once").on(t.gatheringId, t.placeId),
    index("venue_request_due").on(t.deadlineAt).where(sql`response IS NULL`),
  ],
);

export const hostOffer = sqliteTable(
  "host_offer",
  {
    id: text("id").primaryKey(),
    gatheringId: text("gathering_id").notNull().references(() => gathering.id, { onDelete: "cascade" }),
    personId: text("person_id").notNull().references(() => person.id, { onDelete: "cascade" }),
    sentAt: text("sent_at").notNull(),
    deadlineAt: text("deadline_at").notNull(),
    response: text("response", { enum: ["accepted", "declined", "expired"] }),
    tokenHash: text("token_hash").notNull().unique(),
  },
  (t) => [
    uniqueIndex("host_offer_once").on(t.gatheringId, t.personId),
    index("host_offer_due").on(t.deadlineAt).where(sql`response IS NULL`),
  ],
);

export const report = sqliteTable("report", {
  id: text("id").primaryKey(),
  reporterId: text("reporter_id").references(() => person.id, { onDelete: "set null" }),
  targetKind: text("target_kind", { enum: ["activity", "person"] }).notNull(),
  targetId: text("target_id").notNull(),
  text: text("text").notNull().default(""),
  createdAt: text("created_at").notNull().default(now),
  resolvedAt: text("resolved_at"),
});

export const modAction = sqliteTable("mod_action", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").notNull().references(() => person.id),
  action: text("action").notNull(),
  targetKind: text("target_kind").notNull(),
  targetId: text("target_id").notNull(),
  reason: text("reason"),
  at: text("at").notNull().default(now),
});

export const setting = sqliteTable("setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// Sign-in (ACC-01). Same two-step magic link as the Street Noticeboard.
// email_hash is a one-way hash kept only for the 30-minute verification window.
export const pendingAuthRequest = sqliteTable(
  "pending_auth_request",
  {
    id: text("id").primaryKey(),
    browserTokenHash: text("browser_token_hash").notNull().unique(),
    emailHash: text("email_hash").notNull(),
    continuationPath: text("continuation_path"),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("pending_auth_expires").on(t.expiresAt)],
);

export const authRateLimit = sqliteTable("auth_rate_limit", {
  bucketKey: text("bucket_key").primaryKey(),
  attempts: integer("attempts").notNull().default(1),
  expiresAt: text("expires_at").notNull(),
});

// A session belongs to the Supabase account, so it exists before the person record:
// someone who has verified their email but not yet finished /welcome has a session and no person.
export const session = sqliteTable(
  "session",
  {
    tokenHash: text("token_hash").primaryKey(),
    authUserId: text("auth_user_id").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("session_auth_user").on(t.authUserId)],
);
