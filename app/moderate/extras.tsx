"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CardFields, type CardDraft, toPayload } from "../components/card-fields";

type ReviewCard = {
  id: string; title: string; outcome: string; minPeople: number; maxPeople: number; durationMin: number; bring: string;
  materialsCostPence: number; placeKind: "venue" | "public"; needsKnower: boolean; season: string | null; instructions: string | null;
  createdAt: string; authorName: string | null;
};
type Report = { targetKind: "activity" | "person"; targetId: string; label: string; count: number; notes: string[] };
type Metrics = {
  gatheringsHappened: number;
  cardsReachedMinimum: { reached: number; published: number };
  roundsWon: { won: number; closed: number };
  venueRequests: { approved: number; answeredOrExpired: number };
  peopleCameBack: number;
  cardsSuggestedByParticipants: number;
  happenedWithoutModerator: number;
};
type Loaded = { cards: ReviewCard[]; reports: Report[]; metrics: Metrics } | null;

const REASONS: Record<string, string> = {
  home: "Meets at a home",
  risk: "Health or safety risk",
  advert: "Advertises a paid service",
  minors: "Meant for under-18s",
  unclear: "Not clear enough",
};

async function fetchExtras(): Promise<Loaded> {
  try {
    const [c, r, m] = await Promise.all([fetch("/api/mod/review"), fetch("/api/mod/reports"), fetch("/api/mod/metrics")]);
    if (!c.ok || !r.ok || !m.ok) return null;
    return {
      cards: ((await c.json()) as { cards: ReviewCard[] }).cards,
      reports: ((await r.json()) as { reports: Report[] }).reports,
      metrics: ((await m.json()) as { metrics: Metrics }).metrics,
    };
  } catch {
    return null;
  }
}

const toDraft = (c: ReviewCard): CardDraft => ({
  title: c.title, outcome: c.outcome, minPeople: String(c.minPeople), maxPeople: String(c.maxPeople),
  durationHours: String(c.durationMin / 60), bring: c.bring, materialsCost: String(c.materialsCostPence / 100),
  placeKind: c.placeKind, needsKnower: c.needsKnower, season: c.season ?? "", instructions: c.instructions ?? "",
});

const pct = (a: number, b: number) => (b ? `${a} of ${b} (${Math.round((a / b) * 100)}%)` : "none yet");

// MOD-01..MOD-04 and the metrics, above the places and gatherings on /moderate.
export function ModeratorExtras() {
  const [data, setData] = useState<Loaded>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ id: string; draft: CardDraft } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => setData(await fetchExtras()), []);

  useEffect(() => {
    let cancelled = false;
    fetchExtras().then((value) => {
      if (!cancelled) setData(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function post(url: string, body: unknown, done: string) {
    setBusy(true);
    setMessage("");
    setFields({});
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = (await response.json()) as { error?: string; fields?: Record<string, string> };
      if (!response.ok) {
        setFields(result.fields ?? {});
        setMessage(result.error ?? "That didn’t work.");
        return false;
      }
      setMessage(done);
      await refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;
  const m = data.metrics;

  return (
    <>
      {message && <p className="notice" role="status">{message}</p>}

      <h2>Suggested activities ({data.cards.length})</h2>
      {data.cards.length === 0 && <p className="small">Nothing waiting.</p>}
      {data.cards.map((c) => (
        <div className="card" key={c.id}>
          <h3>{c.title}</h3>
          <p>{c.outcome}</p>
          <p className="small">
            {c.minPeople}–{c.maxPeople} people · {c.durationMin / 60} h · {c.placeKind === "venue" ? "indoors" : "outdoors"}
            {c.bring ? ` · bring: ${c.bring}` : ""}{c.materialsCostPence ? ` · materials £${(c.materialsCostPence / 100).toFixed(2)}` : ""}
            {c.needsKnower ? " · needs someone who knows how" : ""}{c.season ? ` · ${c.season}` : ""} · from {c.authorName ?? "a deleted account"}
          </p>
          {c.instructions && <p className="small">Instructions: {c.instructions}</p>}
          {editing?.id === c.id ? (
            <>
              <CardFields draft={editing.draft} onChange={(d) => setEditing({ id: c.id, draft: d })} fields={fields} idPrefix={`e-${c.id}`} />
              <button disabled={busy} onClick={async () => { if (await post(`/api/mod/review/${c.id}`, { action: "publish", edits: toPayload(editing.draft) }, "Published with your changes.")) setEditing(null); }}>Save and publish</button>{" "}
              <button className="secondary" onClick={() => setEditing(null)}>Close</button>
            </>
          ) : (
            <>
              <button disabled={busy} onClick={() => post(`/api/mod/review/${c.id}`, { action: "publish" }, "Published. The author has been emailed.")}>Publish</button>{" "}
              <button className="secondary" onClick={() => { setEditing({ id: c.id, draft: toDraft(c) }); setFields({}); }}>Edit first</button>{" "}
              <select aria-label="Reason to reject" value={reasons[c.id] ?? ""} onChange={(e) => setReasons({ ...reasons, [c.id]: e.target.value })}>
                <option value="">Reject because…</option>
                {Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>{" "}
              <button className="secondary" disabled={busy || !reasons[c.id]} onClick={() => post(`/api/mod/review/${c.id}`, { action: "reject", reason: reasons[c.id] }, "Rejected. The author has been told why.")}>Reject</button>
            </>
          )}
        </div>
      ))}

      <h2>Reports ({data.reports.length})</h2>
      {data.reports.length === 0 && <p className="small">No open reports.</p>}
      {data.reports.map((r) => {
        const key = `${r.targetKind}:${r.targetId}`;
        const body = (action: string) => ({ targetKind: r.targetKind, targetId: r.targetId, action, note: notes[key] ?? "" });
        return (
          <div className="card" key={key}>
            <h3>
              {r.targetKind === "activity" ? <Link href={`/activity/${r.targetId}`}>{r.label}</Link> : `Person: ${r.label}`} · {r.count} report{r.count > 1 ? "s" : ""}
            </h3>
            {r.notes.map((n, i) => <p className="small" key={i}>“{n}”</p>)}
            <label htmlFor={`n-${key}`}>Note for the log (optional)</label>
            <input id={`n-${key}`} value={notes[key] ?? ""} onChange={(e) => setNotes({ ...notes, [key]: e.target.value })} />
            <button className="secondary" disabled={busy} onClick={() => post("/api/mod/reports", body("dismiss"), "Closed without action.")}>Nothing to do</button>{" "}
            {r.targetKind === "activity" && <button className="secondary" disabled={busy} onClick={() => post("/api/mod/reports", body("hide"), "Activity hidden. Any gathering was cancelled.")}>Hide activity</button>}
            {r.targetKind === "person" && <button className="secondary" disabled={busy} onClick={() => post("/api/mod/reports", body("block"), "Account blocked and signed out.")}>Block account</button>}
          </div>
        );
      })}

      <h2>How it’s going</h2>
      <dl className="facts">
        <dt>Gatherings that happened</dt><dd>{m.gatheringsHappened}</dd>
        <dt>Activities that reached their minimum</dt><dd>{pct(m.cardsReachedMinimum.reached, m.cardsReachedMinimum.published)}</dd>
        <dt>Evening picks that became a gathering</dt><dd>{pct(m.roundsWon.won, m.roundsWon.closed)}</dd>
        <dt>Venue requests approved</dt><dd>{pct(m.venueRequests.approved, m.venueRequests.answeredOrExpired)}</dd>
        <dt>People who came a second time</dt><dd>{m.peopleCameBack}</dd>
        <dt>Activities suggested by participants</dt><dd>{m.cardsSuggestedByParticipants}</dd>
        <dt>Gatherings without a moderator there</dt><dd>{m.happenedWithoutModerator}</dd>
      </dl>
    </>
  );
}
