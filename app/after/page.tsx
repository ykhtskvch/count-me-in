"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { slotLabel } from "@/lib/slots";

type View = { title: string; startsAt: string; endsAt: string; answered: boolean };
type Loaded = { followup: View } | { error: string };

async function load(token: string): Promise<Loaded> {
  try {
    const response = await fetch(`/api/followup?token=${encodeURIComponent(token)}`);
    const data = (await response.json()) as { followup?: View; error?: string };
    return data.followup ? { followup: data.followup } : { error: data.error ?? "This link isn’t valid." };
  } catch {
    return { error: "The service is unavailable. Please try again." };
  }
}

// GAT-07: two questions after a gathering.
export default function AfterPage() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [happened, setHappened] = useState<boolean | null>(null);
  const [again, setAgain] = useState<boolean | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    load(new URLSearchParams(window.location.search).get("token") ?? "").then((value) => {
      if (!cancelled) setLoaded(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function send() {
    setBusy(true);
    setError("");
    try {
      const token = new URLSearchParams(window.location.search).get("token") ?? "";
      const response = await fetch("/api/followup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, happened, again }),
      });
      if (response.ok) setDone(true);
      else setError(((await response.json()) as { error?: string }).error ?? "That didn’t save. Please try again.");
    } catch {
      setError("The service is unavailable. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <main><h1>How was it?</h1><p className="small" aria-live="polite">Loading…</p></main>;
  if ("error" in loaded) return <main><h1>How was it?</h1><p className="form-error" role="alert">{loaded.error}</p></main>;
  const f = loaded.followup;
  if (done || f.answered) {
    return (
      <main>
        <h1>Thank you</h1>
        <p className="notice" role="status">{again ? "We’ve counted you in for next time." : "Your answer is saved."}</p>
        <p><Link href="/">All activities</Link></p>
      </main>
    );
  }

  const pair = (name: string, value: boolean | null, set: (v: boolean) => void, yes: string, no: string) => (
    <div className="check">
      <input id={`${name}-y`} type="radio" name={name} checked={value === true} onChange={() => set(true)} />
      <label htmlFor={`${name}-y`}>{yes}</label>
      <input id={`${name}-n`} type="radio" name={name} checked={value === false} onChange={() => set(false)} />
      <label htmlFor={`${name}-n`}>{no}</label>
    </div>
  );

  return (
    <main>
      <h1>How was {f.title}?</h1>
      <p className="lede">{slotLabel(f.startsAt, f.endsAt)}</p>
      <fieldset className="times">
        <legend>Did it happen?</legend>
        {pair("happened", happened, setHappened, "Yes", "No")}
      </fieldset>
      <fieldset className="times">
        <legend>Would you come to this again?</legend>
        {pair("again", again, setAgain, "Yes, count me in next time", "Not this one")}
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button onClick={send} disabled={busy || happened === null || again === null}>Send</button>
    </main>
  );
}
