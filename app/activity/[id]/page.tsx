"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { dayText, slotCounter, slotLabel } from "@/lib/slots";
import { counterText } from "../../components/catalogue";

type Detail = {
  id: string;
  title: string;
  outcome: string;
  minPeople: number;
  maxPeople: number;
  durationMin: number;
  bring: string;
  materialsCostPence: number;
  placeKind: "venue" | "public";
  needsKnower: boolean;
  season: string | null;
  state: string;
  interested: number;
  stillNeeded: number;
  timesRun: number;
  mine: boolean;
  myTimes: string[];
};

const TIMES = [
  ["weekday_evening", "Weekday evening"],
  ["saturday", "Saturday"],
  ["sunday", "Sunday"],
] as const;

type Round = {
  closesAt: string;
  slots: { id: string; startsAt: string; endsAt: string; canMake: number; mine: boolean }[];
};

type Loaded = { activity: Detail; round: Round | null; gatheringId: string | null; signedIn: boolean } | { error: string };

async function fetchActivity(id: string): Promise<Loaded> {
  try {
    const response = await fetch(`/api/activities/${encodeURIComponent(id)}`);
    const data = (await response.json()) as { activity?: Detail; round?: Round | null; gatheringId?: string | null; signedIn?: boolean; error?: string };
    if (!response.ok || !data.activity) return { error: data.error ?? "This activity isn’t available." };
    return { activity: data.activity, round: data.round ?? null, gatheringId: data.gatheringId ?? null, signedIn: Boolean(data.signedIn) };
  } catch {
    return { error: "We couldn’t load this activity. Please refresh." };
  }
}

export default function ActivityPage() {
  const { id } = useParams<{ id: string }>();
  const [activity, setActivity] = useState<Detail | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [gatheringId, setGatheringId] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [times, setTimes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = useCallback((result: Loaded) => {
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setActivity(result.activity);
    setRound(result.round);
    setGatheringId(result.gatheringId);
    setTimes(result.activity.myTimes);
    setSignedIn(result.signedIn);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchActivity(id).then((result) => {
      if (!cancelled) apply(result);
    });
    return () => {
      cancelled = true;
    };
  }, [id, apply]);

  function save(method: "PUT" | "DELETE", nextTimes = times) {
    return send(`/api/activities/${encodeURIComponent(id)}/interest`, method, method === "PUT" ? { times: nextTimes } : undefined, (data) =>
      data.roundOpened
        ? "You’re in, and that makes enough people. Pick the evenings you can make below."
        : method === "PUT"
          ? "You’re in. We’ll email you when enough people join."
          : "Done. You’re no longer counted.",
    );
  }

  function vote(slotId: string, canMake: boolean) {
    return send(`/api/slots/${encodeURIComponent(slotId)}/vote`, canMake ? "PUT" : "DELETE", undefined, (data) =>
      data.gathering
        ? "That evening has enough people now. We’re confirming a host and a place, then we’ll email everyone."
        : canMake
          ? "Noted. Tick every evening you can make."
          : "Done. That evening is unticked.",
    );
  }

  type Reply = { error?: string; needsWelcome?: boolean; roundOpened?: boolean; gathering?: string | null };

  async function send(url: string, method: "PUT" | "DELETE", body: unknown, done: (data: Reply) => string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await response.json()) as Reply;
      if (response.status === 401) {
        window.location.assign(`/signin?next=${encodeURIComponent(`/activity/${id}`)}`);
        return;
      }
      if (data.needsWelcome) {
        window.location.assign(`/welcome?next=${encodeURIComponent(`/activity/${id}`)}`);
        return;
      }
      if (!response.ok) {
        setError(data.error ?? "That didn’t work. Please try again.");
        return;
      }
      setNotice(done(data));
      apply(await fetchActivity(id));
    } catch {
      setError("The service is unavailable. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function toggleTime(value: string) {
    const next = times.includes(value) ? times.filter((t) => t !== value) : [...times, value];
    setTimes(next);
    if (activity?.mine) void save("PUT", next);
  }

  if (error && !activity) {
    return <main><p className="form-error" role="alert">{error}</p><p><Link href="/">All activities</Link></p></main>;
  }
  if (!activity) return <main><p className="small" aria-live="polite">Loading…</p></main>;

  const open = activity.state === "in_catalogue" || activity.state === "choosing";
  const cost = activity.materialsCostPence > 0 ? `about £${(activity.materialsCostPence / 100).toFixed(2)}` : "none";

  return (
    <main>
      <p><Link href="/">← All activities</Link></p>
      <h1>{activity.title}</h1>
      <p className="lede">{activity.outcome}</p>
      <p className="counter" aria-live="polite">{counterText(activity)}</p>

      {gatheringId && (
        <p className="notice">An evening has enough people. <Link href={`/gathering/${gatheringId}`}>See the gathering</Link></p>
      )}

      <dl className="facts">
        <dt>People</dt><dd>{activity.minPeople}–{activity.maxPeople}</dd>
        <dt>How long</dt><dd>{Math.round(activity.durationMin / 60 * 10) / 10} hours</dd>
        <dt>Where</dt><dd>{activity.placeKind === "venue" ? "A checked indoor venue" : "A public place outdoors"}</dd>
        <dt>Bring</dt><dd>{activity.bring || "Nothing"}</dd>
        <dt>Materials</dt><dd>{cost}</dd>
        <dt>Someone who knows how</dt><dd>{activity.needsKnower ? "Needed" : "Not needed"}</dd>
        {activity.season && (<><dt>Season</dt><dd>{activity.season}</dd></>)}
      </dl>

      {open && (
        <fieldset className="times">
          <legend>When suits you? (optional)</legend>
          {TIMES.map(([value, label]) => (
            <div className="check" key={value}>
              <input id={`t-${value}`} type="checkbox" checked={times.includes(value)} onChange={() => toggleTime(value)} disabled={busy} />
              <label htmlFor={`t-${value}`}>{label}</label>
            </div>
          ))}
        </fieldset>
      )}

      {round && round.slots.length > 0 && (
        <fieldset className="times">
          <legend>Pick every evening you can make</legend>
          <p className="small">The first evening to reach {activity.minPeople} people happens. Picking closes {dayText(round.closesAt)}.</p>
          {round.slots.map((slot) => (
            <div className="check" key={slot.id}>
              <input id={`s-${slot.id}`} type="checkbox" checked={slot.mine} onChange={() => vote(slot.id, !slot.mine)} disabled={busy} />
              <label htmlFor={`s-${slot.id}`}>
                {slotLabel(slot.startsAt, slot.endsAt)} <span className="small">· {slotCounter(slot.canMake, activity.minPeople)}</span>
              </label>
            </div>
          ))}
        </fieldset>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      {open && !activity.mine && (
        <button onClick={() => save("PUT")} disabled={busy}>Count me in</button>
      )}
      {activity.mine && (
        <button className="secondary" onClick={() => save("DELETE")} disabled={busy}>I’m out</button>
      )}
      {!signedIn && open && <p className="small">You’ll be asked to sign in first. It takes one email.</p>}
      <p className="small">Only the number of people is shown. Nobody sees who else is in.</p>
    </main>
  );
}
