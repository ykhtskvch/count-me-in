"use client";

import Link from "next/link";
import { useState } from "react";

export default function ConfirmPage() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams(window.location.search);
      const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const linkError = fragment.get("error_description") || query.get("error_description");
      if (linkError) {
        setError(linkError);
        return;
      }
      const response = await fetch("/api/auth/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pending: query.get("pending") ?? "",
          tokenHash: query.get("token_hash") ?? "",
          accessToken: fragment.get("access_token") ?? "",
          type: query.get("type") ?? "email",
        }),
      });
      const data = (await response.json()) as { error?: string; returnTo?: string };
      if (!response.ok) {
        setError(data.error ?? "We couldn’t check this sign-in link.");
        return;
      }
      window.location.replace(data.returnTo || "/");
    } catch {
      setError("The sign-in service is unavailable. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>One more click</h1>
      <p className="lede">This step stops email scanners from using your link before you do.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button onClick={confirm} disabled={busy}>{busy ? "Checking…" : "Continue"}</button>
      <p><Link href="/signin">Ask for a new link</Link></p>
    </main>
  );
}
