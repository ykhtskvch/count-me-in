// The scheduler's endpoint (backlog 0.4). Supabase Cron calls it every five minutes.
// Each job is safe to run twice. Emails are only sent when EMAIL_SENDING_ENABLED is
// "true", so turning the clock on does not by itself start emailing people.
import { getSupabaseAdmin } from "@/db/auth";
import { cancelUnreadyGatherings, completeGatherings, expireHostOffers } from "@/db/gatherings";
import { queueDigests } from "@/db/digest";
import { queueFollowups } from "@/db/followups";
import { queueReminders, sendDueEmails } from "@/db/mailer";
import { closeDueRounds } from "@/db/rounds";
import { expireVenueRequests } from "@/db/venues";
import { getDatabase } from "@/db/runtime";
import { type SesBindings, sendSesEmail } from "@/db/ses";
import { verifyTick } from "@/lib/scheduler";

const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

type Bindings = SesBindings & { SCHEDULER_SECRET?: string; EMAIL_SENDING_ENABLED?: string; PUBLIC_SITE_URL?: string };

export async function POST(request: Request) {
  let bindings: Bindings = {};
  try {
    bindings = (await import("cloudflare:workers")).env as unknown as Bindings;
  } catch {
    // Outside Workers (tests): no secret, so nothing is authorised.
  }
  if (!(await verifyTick(request, bindings.SCHEDULER_SECRET))) {
    return Response.json({ error: "Unauthorized." }, { status: 401, headers });
  }
  try {
    const db = await getDatabase();
    const now = new Date();
    const summary = {
      roundsClosed: (await closeDueRounds(db, now)).length,
      hostOffersExpired: await expireHostOffers(db, now),
      venueRequestsExpired: await expireVenueRequests(db, now),
      gatheringsCancelled: await cancelUnreadyGatherings(db, now),
      gatheringsHappened: await completeGatherings(db, now),
      remindersQueued: await queueReminders(db, now),
      followupsQueued: await queueFollowups(db, now),
      digestsQueued: await queueDigests(db, now),
      emails: null as null | { sent: number; dropped: number; failed: number },
    };
    if (bindings.EMAIL_SENDING_ENABLED === "true" && bindings.PUBLIC_SITE_URL) {
      const admin = await getSupabaseAdmin();
      summary.emails = await sendDueEmails(
        db,
        {
          siteUrl: bindings.PUBLIC_SITE_URL,
          async lookupEmail(authUserId) {
            const { data, error } = await admin.auth.admin.getUserById(authUserId);
            if (error) throw new Error("Supabase lookup failed.");
            return data.user?.email ?? null;
          },
          send: (message) => sendSesEmail(message, bindings),
        },
        now,
      );
    }
    return Response.json({ ok: true, emailSending: summary.emails !== null, ...summary, at: now.toISOString() }, { headers });
  } catch {
    return Response.json({ error: "Scheduled run unavailable." }, { status: 503, headers });
  }
}

export function GET() {
  return Response.json({ error: "Method not allowed." }, { status: 405, headers: { ...headers, allow: "POST" } });
}
