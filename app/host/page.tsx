"use client";

import Link from "next/link";
import { useState } from "react";

// GAT-02: the page behind the "Would you greet everyone?" email. Nothing happens on
// opening the link; only a button press answers, so mail scanners can't answer for you.
export default function HostOfferPage() {
  const [result, setResult] = useState<"accepted" | "declined" | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function answer(accept: boolean) {
    setBusy(true);
    setError("");
    try {
      const token = new URLSearchParams(window.location.search).get("token") ?? "";
      const response = await fetch("/api/host-offer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, accept }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "That didn’t work. Please try again.");
        return;
      }
      setResult(accept ? "accepted" : "declined");
    } catch {
      setError("The service is unavailable. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Would you greet everyone?</h1>
      {result === null && (
        <>
          <p className="lede">The host arrives a few minutes early, says hello and keeps an eye on the time. Nothing more: no organising, no money, no responsibility for anyone else.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button onClick={() => answer(true)} disabled={busy}>Yes, I’ll greet everyone</button>{" "}
          <button className="secondary" onClick={() => answer(false)} disabled={busy}>Not this time</button>
          <p className="small">If you say no, we’ll ask the next person. You’re still going either way.</p>
        </>
      )}
      {result === "accepted" && <p className="notice" role="status">Thank you! We’ll email everyone the details once the place is confirmed.</p>}
      {result === "declined" && <p className="notice" role="status">No problem. We’ll ask someone else. You’re still going.</p>}
      <p><Link href="/">All activities</Link></p>
    </main>
  );
}
