"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { slotLabel } from "@/lib/slots";

type Window = { weekday: number; startTime: string; endTime: string; autoApprove: boolean };
type Place = {
  id: string;
  name: string;
  address: string;
  postcodeDistrict: string;
  kind: "venue" | "public";
  capacity: number | null;
  facilities: string;
  stepFree: boolean;
  priceText: string | null;
  termsText: string | null;
  bookingEmail: string | null;
  active: boolean;
  windows: Window[];
};
type Gathering = {
  id: string;
  title: string;
  status: "awaiting_place" | "scheduled";
  startsAt: string;
  endsAt: string;
  placeName: string | null;
  going: number;
  minPeople: number;
  hasHost: boolean;
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Draft = {
  id: string | null;
  name: string;
  address: string;
  postcode: string;
  kind: "venue" | "public";
  capacity: string;
  facilities: string;
  stepFree: boolean;
  priceText: string;
  termsText: string;
  bookingEmail: string;
  active: boolean;
  windows: Window[];
};

const EMPTY: Draft = {
  id: null, name: "", address: "", postcode: "", kind: "public", capacity: "", facilities: "", stepFree: false,
  priceText: "", termsText: "", bookingEmail: "", active: true, windows: [],
};

function toDraft(p: Place): Draft {
  return {
    id: p.id, name: p.name, address: p.address, postcode: p.postcodeDistrict, kind: p.kind,
    capacity: p.capacity?.toString() ?? "", facilities: p.facilities, stepFree: p.stepFree,
    priceText: p.priceText ?? "", termsText: p.termsText ?? "", bookingEmail: p.bookingEmail ?? "",
    active: p.active, windows: p.windows,
  };
}

type Loaded = { places: Place[]; gatherings: Gathering[] } | { error: string; status: number };

async function fetchAll(): Promise<Loaded> {
  try {
    const [p, g] = await Promise.all([fetch("/api/mod/places"), fetch("/api/mod/gatherings")]);
    if (!p.ok) return { error: ((await p.json()) as { error?: string }).error ?? "Not available.", status: p.status };
    const { places } = (await p.json()) as { places: Place[] };
    const { gatherings } = (await g.json()) as { gatherings: Gathering[] };
    return { places, gatherings };
  } catch {
    return { error: "The service is unavailable. Please refresh.", status: 503 };
  }
}

export default function ModeratePage() {
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [gatherings, setGatherings] = useState<Gathering[]>([]);
  const [denied, setDenied] = useState<{ error: string; status: number } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = useCallback((result: Loaded) => {
    if ("error" in result) {
      setDenied(result);
      return;
    }
    setPlaces(result.places);
    setGatherings(result.gatherings);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchAll().then((result) => {
      if (!cancelled) apply(result);
    });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  async function savePlace(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setFields({});
    setMessage("");
    try {
      const response = await fetch(draft.id ? `/api/mod/places/${draft.id}` : "/api/mod/places", {
        method: draft.id ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...draft, capacity: draft.capacity === "" ? null : Number(draft.capacity) }),
      });
      const data = (await response.json()) as { error?: string; fields?: Record<string, string> };
      if (!response.ok) {
        setFields(data.fields ?? {});
        setMessage(data.error ?? "That didn’t save.");
        return;
      }
      setDraft(null);
      setMessage("Saved.");
      apply(await fetchAll());
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/mod/gatherings/${id}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reasons[id] ?? "" }),
      });
      const data = (await response.json()) as { error?: string };
      setMessage(response.ok ? "Cancelled. Everyone going will get an email." : (data.error ?? "That didn’t work."));
      if (response.ok) apply(await fetchAll());
    } finally {
      setBusy(false);
    }
  }

  if (denied) {
    return (
      <main>
        <h1>Moderate</h1>
        <p className="form-error" role="alert">{denied.error}</p>
        {denied.status === 401 && <p><Link href="/signin?next=/moderate">Sign in</Link></p>}
      </main>
    );
  }
  if (!places) return <main><p className="small" aria-live="polite">Loading…</p></main>;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const err = (key: string) => fields[key] && <span className="form-error">{fields[key]}</span>;

  return (
    <main>
      <h1>Moderate</h1>
      {message && <p className="notice" role="status">{message}</p>}

      <h2>Gatherings</h2>
      {gatherings.length === 0 && <p className="small">No live gatherings.</p>}
      {gatherings.map((g) => (
        <div className="card" key={g.id}>
          <h3><Link href={`/gathering/${g.id}`}>{g.title}</Link></h3>
          <p className="small">
            {slotLabel(g.startsAt, g.endsAt)} · {g.placeName ?? "no place yet"} · {g.going} going (min {g.minPeople}) ·{" "}
            {g.hasHost ? "host confirmed" : "no host yet"} · {g.status === "scheduled" ? "booked" : "getting ready"}
          </p>
          <label htmlFor={`r-${g.id}`}>Reason for cancelling (kept in the log, not shown to participants)</label>
          <input id={`r-${g.id}`} value={reasons[g.id] ?? ""} onChange={(e) => setReasons({ ...reasons, [g.id]: e.target.value })} />
          <button className="secondary" onClick={() => cancel(g.id)} disabled={busy || !(reasons[g.id] ?? "").trim()}>Cancel gathering</button>
        </div>
      ))}

      <h2>Places</h2>
      <p className="small">Gatherings can only happen at places on this list. Never add a home.</p>
      {places.map((p) => (
        <div className="card" key={p.id}>
          <h3>{p.name}{p.active ? "" : " (switched off)"}</h3>
          <p className="small">
            {p.kind === "venue" ? "Indoor venue" : "Public place"} · {p.address}, {p.postcodeDistrict}
            {p.capacity ? ` · up to ${p.capacity}` : ""}{p.stepFree ? " · step-free" : ""}
            {p.windows.length ? ` · windows: ${p.windows.map((w) => `${DAYS[w.weekday - 1]} ${w.startTime}–${w.endTime}`).join(", ")}` : ""}
          </p>
          <button className="secondary" onClick={() => { setDraft(toDraft(p)); setFields({}); }}>Edit</button>
        </div>
      ))}
      {!draft && <button onClick={() => { setDraft({ ...EMPTY }); setFields({}); }}>Add a place</button>}

      {draft && (
        <form onSubmit={savePlace} className="card">
          <h3>{draft.id ? "Edit place" : "New place"}</h3>
          <label htmlFor="pl-kind">Type</label>
          <select id="pl-kind" value={draft.kind} onChange={(e) => set("kind", e.target.value as Draft["kind"])}>
            <option value="public">Public place (park, square, library forecourt)</option>
            <option value="venue">Indoor venue (hall, café, library room)</option>
          </select>
          <label htmlFor="pl-name">Name</label>
          <input id="pl-name" value={draft.name} onChange={(e) => set("name", e.target.value)} />{err("name")}
          <label htmlFor="pl-address">Address and where exactly to meet</label>
          <input id="pl-address" value={draft.address} onChange={(e) => set("address", e.target.value)} />{err("address")}
          <label htmlFor="pl-postcode">Postcode</label>
          <input id="pl-postcode" value={draft.postcode} onChange={(e) => set("postcode", e.target.value)} />{err("postcode")}
          <label htmlFor="pl-capacity">Capacity (optional)</label>
          <input id="pl-capacity" inputMode="numeric" value={draft.capacity} onChange={(e) => set("capacity", e.target.value)} />{err("capacity")}
          <label htmlFor="pl-facilities">What’s there (tables, toilets, power…)</label>
          <input id="pl-facilities" value={draft.facilities} onChange={(e) => set("facilities", e.target.value)} />
          <div className="check">
            <input id="pl-step" type="checkbox" checked={draft.stepFree} onChange={(e) => set("stepFree", e.target.checked)} />
            <label htmlFor="pl-step">Step-free access</label>
          </div>
          {draft.kind === "venue" && (
            <>
              <label htmlFor="pl-email">Booking email (requests go here)</label>
              <input id="pl-email" type="email" value={draft.bookingEmail} onChange={(e) => set("bookingEmail", e.target.value)} />{err("bookingEmail")}
              <label htmlFor="pl-price">Price</label>
              <input id="pl-price" value={draft.priceText} onChange={(e) => set("priceText", e.target.value)} />
              <label htmlFor="pl-terms">Hire terms</label>
              <input id="pl-terms" value={draft.termsText} onChange={(e) => set("termsText", e.target.value)} />
            </>
          )}
          <fieldset className="times">
            <legend>Standing windows (optional)</legend>
            {draft.windows.map((w, i) => (
              <div className="check" key={i}>
                <select aria-label="Day" value={w.weekday} onChange={(e) => set("windows", draft.windows.map((x, j) => (j === i ? { ...x, weekday: Number(e.target.value) } : x)))}>
                  {DAYS.map((d, n) => <option key={d} value={n + 1}>{d}</option>)}
                </select>
                <input aria-label="From" type="time" value={w.startTime} onChange={(e) => set("windows", draft.windows.map((x, j) => (j === i ? { ...x, startTime: e.target.value } : x)))} />
                <input aria-label="To" type="time" value={w.endTime} onChange={(e) => set("windows", draft.windows.map((x, j) => (j === i ? { ...x, endTime: e.target.value } : x)))} />
                <button type="button" className="secondary" onClick={() => set("windows", draft.windows.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
            {err("windows")}
            <button type="button" className="secondary" onClick={() => set("windows", [...draft.windows, { weekday: 3, startTime: "19:00", endTime: "21:00", autoApprove: false }])}>
              Add a window
            </button>
          </fieldset>
          <div className="check">
            <input id="pl-active" type="checkbox" checked={draft.active} onChange={(e) => set("active", e.target.checked)} />
            <label htmlFor="pl-active">In use (untick to switch the place off without deleting it)</label>
          </div>
          <button type="submit" disabled={busy}>Save place</button>{" "}
          <button type="button" className="secondary" onClick={() => setDraft(null)}>Close</button>
        </form>
      )}
    </main>
  );
}
