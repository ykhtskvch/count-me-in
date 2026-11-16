"use client";

import { type FormEvent, useState } from "react";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const returnTo = new URLSearchParams(window.location.search).get("next") ?? undefined;
      const response = await fetch("/api/auth/request-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, returnTo }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "We couldn’t send your sign-in email.");
        return;
      }
      setSent(true);
    } catch {
      setError("The sign-in service is unavailable. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <main>
        <h1>Check your email</h1>
        <p className="lede">We’ve sent a sign-in link to {email}. It works for 30 minutes.</p>
        <p>Not there? Check spam, or <button className="link-button" onClick={() => setSent(false)}>try another address</button>.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Sign in</h1>
      <p className="lede">No password. We’ll email you a link, and you’re in.</p>
      <form onSubmit={submit} noValidate>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} aria-describedby={error ? "email-error" : undefined} aria-invalid={error ? true : undefined} />
        {error && <p id="email-error" className="form-error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? "Sending…" : "Email me a link"}</button>
      </form>
      <p className="small">We use your email only to sign you in and to tell you about gatherings you said yes to.</p>
    </main>
  );
}
