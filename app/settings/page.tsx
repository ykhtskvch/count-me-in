"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Settings = { displayName: string; postcodeDistrict: string; showName: boolean; digest: boolean; role: string };
type Loaded = { settings: Settings } | { status: number };

async function load(): Promise<Loaded> {
  try {
    const response = await fetch("/api/settings");
    if (!response.ok) return { status: response.status };
    return { settings: (await response.json()) as Settings };
  } catch {
    return { status: 503 };
  }
}

// NTF-03 (every email links here), INT-03 (name shown only if allowed), ACC-04 (delete).
export default function SettingsPage() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    load().then((value) => {
      if (!cancelled) setLoaded(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function change(patch: { showName?: boolean; digest?: boolean }) {
    setBusy(true);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (response.ok && loaded && "settings" in loaded) setLoaded({ settings: { ...loaded.settings, ...patch } });
      setMessage(response.ok ? "Saved." : "That didn’t save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm }),
      });
      const data = (await response.json()) as { error?: string };
      if (response.ok) return window.location.assign("/?deleted=1");
      setMessage(data.error ?? "That didn’t work.");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <main><h1>Settings</h1><p className="small" aria-live="polite">Loading…</p></main>;
  if ("status" in loaded) {
    return (
      <main>
        <h1>Settings</h1>
        {loaded.status === 401 ? <p><Link href="/signin?next=/settings">Sign in</Link> to see your settings.</p> : loaded.status === 403 ? <p><Link href="/welcome?next=/settings">Finish setting up your account</Link> first.</p> : <p className="form-error">The service is unavailable. Please refresh.</p>}
      </main>
    );
  }
  const s = loaded.settings;

  return (
    <main>
      <p><Link href="/">← All activities</Link></p>
      <h1>Settings</h1>
      <dl className="facts">
        <dt>Name</dt><dd>{s.displayName}</dd>
        <dt>Area</dt><dd>{s.postcodeDistrict}</dd>
      </dl>
      <div className="check">
        <input id="show-name" type="checkbox" checked={s.showName} onChange={(e) => change({ showName: e.target.checked })} disabled={busy} />
        <label htmlFor="show-name">Others going to the same gathering may see my name</label>
      </div>
      <h2>Emails</h2>
      <p className="small">We only email about activities you said Count me in to: evenings to pick, a gathering that’s on or off, and a reminder the day before. No adverts. If you don’t want these emails, take back your interest, or delete your account.</p>
      <div className="check">
        <input id="digest" type="checkbox" checked={s.digest} onChange={(e) => change({ digest: e.target.checked })} disabled={busy} />
        <label htmlFor="digest">Also email me when there are new activities, at most once a week</label>
      </div>
      {message && <p className="notice" role="status">{message}</p>}
      <h2>Delete my account</h2>
      <p className="small">This removes your name, area, interest and gatherings from Count Me In and deletes your sign-in. Activities you suggested stay, without your name. It can’t be undone.</p>
      <label htmlFor="confirm">Type DELETE to confirm</label>
      <input id="confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
      <button className="secondary" onClick={remove} disabled={busy || confirm !== "DELETE"}>Delete my account</button>
    </main>
  );
}
