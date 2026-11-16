"use client";

import { useState } from "react";

// MOD-03: one button, an optional note, and only moderators see it.
export function ReportButton({ url, label, signInNext }: { url: string; label: string; signInNext: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");

  async function send() {
    setState("busy");
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      if (response.status === 401) return window.location.assign(`/signin?next=${encodeURIComponent(signInNext)}`);
      setState(response.ok ? "sent" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "sent") return <p className="small" role="status">Thank you. A moderator will look at it. Nobody else sees reports.</p>;
  if (!open) return <p className="small"><button className="link" onClick={() => setOpen(true)}>{label}</button></p>;
  return (
    <div className="card">
      <label htmlFor="report-text">What’s wrong? (optional, only a moderator reads this)</label>
      <textarea id="report-text" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
      {state === "error" && <p className="form-error" role="alert">That didn’t send. Please try again.</p>}
      <button className="secondary" onClick={send} disabled={state === "busy"}>Send report</button>{" "}
      <button className="link" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}
