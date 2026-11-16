"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { slotLabel } from "@/lib/slots";
import { ReportButton } from "../../components/report-button";

type Gathering = {
  id: string;
  status: "awaiting_place" | "scheduled" | "cancelled" | "happened";
  activityId: string;
  title: string;
  outcome: string;
  bring: string;
  minPeople: number;
  maxPeople: number;
  startsAt: string;
  endsAt: string;
  going: number;
  started: boolean;
  place: { name: string; address: string; stepFree: boolean; facilities: string } | null;
  hasHost: boolean;
  hostName: string | null;
  me: { going: boolean; isHost: boolean; hostOfferPending: boolean } | null;
};

type Loaded = { gathering: Gathering; signedIn: boolean } | { error: string };

async function fetchGathering(id: string): Promise<Loaded> {
  try {
    const response = await fetch(`/api/gatherings/${encodeURIComponent(id)}`);
    const data = (await response.json()) as { gathering?: Gathering; signedIn?: boolean; error?: string };
    if (!response.ok || !data.gathering) return { error: data.error ?? "This gathering isn’t available." };
    return { gathering: data.gathering, signedIn: Boolean(data.signedIn) };
  } catch {
    return { error: "We couldn’t load this gathering. Please refresh." };
  }
}

const STATUS_TEXT: Record<Gathering["status"], string> = {
  awaiting_place: "Getting ready: waiting for a host and a place to confirm.",
  scheduled: "It’s on.",
  cancelled: "This gathering was cancelled. The activity is back in the catalogue.",
  happened: "This gathering has happened.",
};

export default function GatheringPage() {
  const { id } = useParams<{ id: string }>();
  const [gathering, setGathering] = useState<Gathering | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = useCallback((result: Loaded) => {
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setGathering(result.gathering);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchGathering(id).then((result) => {
      if (!cancelled) apply(result);
    });
    return () => {
      cancelled = true;
    };
  }, [id, apply]);

  async function attend(method: "PUT" | "DELETE") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/gatherings/${encodeURIComponent(id)}/attendance`, { method });
      const data = (await response.json()) as { error?: string; needsWelcome?: boolean };
      if (response.status === 401) {
        window.location.assign(`/signin?next=${encodeURIComponent(`/gathering/${id}`)}`);
        return;
      }
      if (data.needsWelcome) {
        window.location.assign(`/welcome?next=${encodeURIComponent(`/gathering/${id}`)}`);
        return;
      }
      if (!response.ok) {
        setError(data.error ?? "That didn’t work. Please try again.");
        return;
      }
      setNotice(method === "PUT" ? "You’re going. See you there." : "Done. You’re no longer going. No need to explain.");
      apply(await fetchGathering(id));
    } catch {
      setError("The service is unavailable. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !gathering) {
    return <main><p className="form-error" role="alert">{error}</p><p><Link href="/">All activities</Link></p></main>;
  }
  if (!gathering) return <main><p className="small" aria-live="polite">Loading…</p></main>;

  const live = gathering.status === "awaiting_place" || gathering.status === "scheduled";
  const started = gathering.started;
  const full = gathering.going >= gathering.maxPeople;
  const host = gathering.hostName ?? (gathering.hasHost ? "Confirmed (you’ll see their name once you’re going)" : "Not yet confirmed");

  return (
    <main>
      <p><Link href={`/activity/${gathering.activityId}`}>← {gathering.title}</Link></p>
      <h1>{gathering.title}</h1>
      <p className="lede">{gathering.outcome}</p>
      <p className="counter" role="status">{STATUS_TEXT[gathering.status]}</p>

      <dl className="facts">
        <dt>When</dt><dd>{slotLabel(gathering.startsAt, gathering.endsAt)}</dd>
        <dt>Where</dt>
        <dd>
          {gathering.place ? (
            <>
              {gathering.place.name}, {gathering.place.address}
              {gathering.place.stepFree ? " · step-free" : ""}
              {gathering.place.facilities ? ` · ${gathering.place.facilities}` : ""}
            </>
          ) : (
            "To be confirmed"
          )}
        </dd>
        <dt>Going</dt><dd>{gathering.going} of up to {gathering.maxPeople}</dd>
        <dt>Bring</dt><dd>{gathering.bring || "Nothing"}</dd>
        <dt>Host</dt><dd>{gathering.me?.isHost ? "You. Thank you!" : host}</dd>
      </dl>

      {gathering.me?.hostOfferPending && (
        <p className="notice">We’ve emailed you asking whether you’d greet everyone. Use the link in that email to answer.</p>
      )}
      {live && gathering.me?.going && gathering.going < gathering.minPeople && (
        <p className="notice">Fewer than {gathering.minPeople} people are going now. It’s up to you whether to go.</p>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      {live && !started && !gathering.me?.going && !full && (
        <button onClick={() => attend("PUT")} disabled={busy}>I’m going</button>
      )}
      {live && !started && !gathering.me?.going && full && <p className="small">This gathering is full.</p>}
      {live && gathering.me?.going && (
        <button className="secondary" onClick={() => attend("DELETE")} disabled={busy}>I can’t make it</button>
      )}
      <p className="small">Only the number of people going is shown. You can stop going at any time.</p>
      {gathering.hostName && !gathering.me?.isHost && (
        <ReportButton url={`/api/gatherings/${encodeURIComponent(id)}/report`} label="Report a problem with the host" signInNext={`/gathering/${id}`} />
      )}
    </main>
  );
}
