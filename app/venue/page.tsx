"use client";

import { useEffect, useState } from "react";
import { dateTimeText, slotLabel } from "@/lib/slots";

type View = {
  title: string;
  outcome: string;
  startsAt: string;
  endsAt: string;
  people: number;
  maxPeople: number;
  placeName: string;
  deadlineAt: string;
  open: boolean;
};

type Loaded = { request: View } | { error: string };

async function load(token: string): Promise<Loaded> {
  try {
    const response = await fetch(`/api/venue-request?token=${encodeURIComponent(token)}`);
    const data = (await response.json()) as { request?: View; error?: string };
    return data.request ? { request: data.request } : { error: data.error ?? "This link isn’t valid." };
  } catch {
    return { error: "The service is unavailable. Please try again." };
  }
}

// PLC-03: the page behind a venue's room-request email. No account needed.
export default function VenueRequestPage() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [result, setResult] = useState<"approved" | "declined" | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    load(token).then((value) => {
      if (!cancelled) setLoaded(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function answer(approve: boolean) {
    setBusy(true);
    setError("");
    try {
      const token = new URLSearchParams(window.location.search).get("token") ?? "";
      const response = await fetch("/api/venue-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, approve }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "That didn’t work. Please try again.");
        return;
      }
      setResult(approve ? "approved" : "declined");
    } catch {
      setError("The service is unavailable. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <main><h1>Room request</h1><p className="small" aria-live="polite">Loading…</p></main>;
  if ("error" in loaded) return <main><h1>Room request</h1><p className="form-error" role="alert">{loaded.error}</p></main>;
  const r = loaded.request;

  return (
    <main>
      <h1>Room request for {r.placeName}</h1>
      <p className="lede">Count Me In is a non-profit that helps neighbours meet for one-off evenings. A group would like to use your space.</p>
      <dl className="facts">
        <dt>Activity</dt><dd>{r.title}. {r.outcome}</dd>
        <dt>When</dt><dd>{slotLabel(r.startsAt, r.endsAt)}</dd>
        <dt>People</dt><dd>{r.people} so far, at most {r.maxPeople}</dd>
        <dt>Payment</dt><dd>The platform doesn’t take payments. The group pays you directly on your usual terms.</dd>
      </dl>
      {result === "approved" && <p className="notice" role="status">Thank you! We’ll let the group know. One of them will arrive first as the host.</p>}
      {result === "declined" && <p className="notice" role="status">Thank you for letting us know. We’ll ask another venue.</p>}
      {result === null && r.open && (
        <>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button onClick={() => answer(true)} disabled={busy}>Yes, the room is available</button>{" "}
          <button className="secondary" onClick={() => answer(false)} disabled={busy}>No, not this time</button>
          <p className="small">Please answer by {dateTimeText(r.deadlineAt)}. After that we’ll ask another venue.</p>
        </>
      )}
      {result === null && !r.open && <p className="notice">This request is closed: it was answered, it passed to another venue, or the group no longer needs the room.</p>}
    </main>
  );
}
