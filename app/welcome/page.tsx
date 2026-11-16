"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

type Fields = Partial<Record<"displayName" | "postcode" | "adult" | "rules", string>>;

export default function WelcomePage() {
  const [displayName, setDisplayName] = useState("");
  const [postcode, setPostcode] = useState("");
  const [adult, setAdult] = useState(false);
  const [rules, setRules] = useState(false);
  const [showName, setShowName] = useState(false);
  const [fields, setFields] = useState<Fields>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setFields({});
    try {
      const response = await fetch("/api/account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName, postcode, adult, rules, showName }),
      });
      const data = (await response.json()) as { error?: string; fields?: Fields };
      if (!response.ok && response.status !== 409) {
        setFields(data.fields ?? {});
        setError(data.error ?? "We couldn’t save this.");
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch {
      setError("The service is unavailable. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const describe = (key: keyof Fields) => (fields[key] ? `${key}-error` : undefined);

  return (
    <main>
      <h1>Welcome</h1>
      <p className="lede">Three things and you’re in. We don’t ask for your surname, phone or address.</p>
      <form onSubmit={submit} noValidate>
        <label htmlFor="displayName">Your name</label>
        <p className="hint" id="displayName-hint">One name, as you’d like others at a gathering to see it.</p>
        <input id="displayName" autoComplete="given-name" maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} aria-describedby={["displayName-hint", describe("displayName")].filter(Boolean).join(" ")} aria-invalid={fields.displayName ? true : undefined} />
        {fields.displayName && <p id="displayName-error" className="form-error">{fields.displayName}</p>}

        <label htmlFor="postcode">First part of your postcode</label>
        <p className="hint" id="postcode-hint">Like E17 or SW9. It’s only used to show you what’s nearby.</p>
        <input id="postcode" autoComplete="off" maxLength={8} value={postcode} onChange={(e) => setPostcode(e.target.value)} aria-describedby={["postcode-hint", describe("postcode")].filter(Boolean).join(" ")} aria-invalid={fields.postcode ? true : undefined} />
        {fields.postcode && <p id="postcode-error" className="form-error">{fields.postcode}</p>}

        <div className="check">
          <input id="adult" type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} aria-describedby={describe("adult")} />
          <label htmlFor="adult">I’m 18 or over</label>
        </div>
        {fields.adult && <p id="adult-error" className="form-error">{fields.adult}</p>}

        <div className="check">
          <input id="rules" type="checkbox" checked={rules} onChange={(e) => setRules(e.target.checked)} aria-describedby={describe("rules")} />
          <label htmlFor="rules">I accept the <Link href="/rules" target="_blank">rules</Link></label>
        </div>
        {fields.rules && <p id="rules-error" className="form-error">{fields.rules}</p>}

        <div className="check">
          <input id="showName" type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} />
          <label htmlFor="showName">Show my name to others going to the same gathering</label>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? "Saving…" : "Continue"}</button>
      </form>
    </main>
  );
}
