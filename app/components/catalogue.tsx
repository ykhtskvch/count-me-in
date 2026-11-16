"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Item = {
  id: string;
  title: string;
  outcome: string;
  minPeople: number;
  interested: number;
  interestedNearby: number;
  stillNeeded: number;
  durationMin: number;
  placeKind: "venue" | "public";
  state: string;
  timesRun: number;
  mine: boolean;
};

export function counterText(item: Pick<Item, "interested" | "stillNeeded" | "state">): string {
  if (item.state === "choosing") return `${item.interested} in · picking an evening`;
  if (item.state === "awaiting_place") return `${item.interested} in · finding a place`;
  if (item.state === "scheduled") return `${item.interested} in · gathering booked`;
  if (item.stillNeeded === 0) return `${item.interested} in`;
  return `${item.interested} in · ${item.stillNeeded} more needed`;
}

export function Catalogue() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/activities")
      .then(async (response) => {
        const data = (await response.json()) as { activities?: Item[]; error?: string };
        if (!response.ok) throw new Error(data.error);
        setItems(data.activities ?? []);
      })
      .catch(() => setError("We couldn’t load the activities. Please refresh."));
  }, []);

  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!items) return <p className="small" aria-live="polite">Loading activities…</p>;
  if (items.length === 0) return <p>No activities yet. New ones are on their way.</p>;

  return (
    <ul className="cards">
      {items.map((item) => (
        <li key={item.id} className="card">
          <h3><Link href={`/activity/${item.id}`}>{item.title}</Link></h3>
          <p>{item.outcome}</p>
          <p className="counter">{counterText(item)}</p>
          <p className="small">
            {Math.round(item.durationMin / 60 * 10) / 10} h · {item.placeKind === "venue" ? "indoors" : "outdoors"}
            {item.timesRun > 0 ? " · done before" : ""}
            {item.mine ? " · you’re in" : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}
