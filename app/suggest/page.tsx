"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { CardFields, type CardDraft, EMPTY_CARD, toPayload } from "../components/card-fields";

// CAT-03: anyone signed in can suggest an activity; a moderator checks it first.
export default function SuggestPage() {
  const [draft, setDraft] = useState<CardDraft>(EMPTY_CARD);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [done, setDone] = useState<"review" | "published" | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setFields({});
    try {
      const response = await fetch("/api/activities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toPayload(draft)),
      });
      const data = (await response.json()) as { error?: string; fields?: Record<string, string>; published?: boolean; needsWelcome?: boolean };
      if (response.status === 401) return window.location.assign("/signin?next=/suggest");
      if (data.needsWelcome) return window.location.assign("/welcome?next=/suggest");
      if (!response.ok) {
        setFields(data.fields ?? {});
        setError(data.error ?? "That didn’t work. Please try again.");
        return;
      }
      setDone(data.published ? "published" : "review");
    } catch {
      setError("The service is unavailable. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <main>
        <h1>Thank you</h1>
        <p className="notice" role="status">
          {done === "published" ? "It’s in the catalogue." : "A moderator will check it soon. We’ll email you when it’s in the catalogue."}
        </p>
        <p><Link href="/">All activities</Link></p>
      </main>
    );
  }

  return (
    <main>
      <p><Link href="/">← All activities</Link></p>
      <h1>Suggest an activity</h1>
      <p className="lede">Something a few neighbours could do together in one evening. You won’t have to organise it.</p>
      <p className="small">
        We publish activities for adults that happen at a public place or a checked venue. We don’t publish activities at
        someone’s home, risky ones, adverts for paid services, or anything meant for children.
      </p>
      <form onSubmit={submit}>
        <CardFields draft={draft} onChange={setDraft} fields={fields} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>Send for checking</button>
      </form>
    </main>
  );
}
