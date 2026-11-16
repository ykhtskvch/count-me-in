"use client";

import { useState } from "react";

// CAT-07: a link to invite a friend, wherever they live. Uses the phone's share sheet
// when there is one, otherwise copies the link.
export function ShareLink({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.href.split("?")[0];
    try {
      if (navigator.share) {
        await navigator.share({ title: `${title} · Count Me In`, text: `Fancy doing this together? ${title}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // The person closed the share sheet, or copying isn't allowed: nothing to do.
    }
  }

  return (
    <p className="small">
      <button className="link" onClick={share}>Invite a friend</button>
      {copied && <span role="status"> Link copied. Send it to anyone, wherever they live.</span>}
    </p>
  );
}
