// Email texts (epic 7). Pure: the sender loads the facts, this file turns them into words.
// English, plain and short. Each email says why it was sent and links to the one page
// where the person can act. No other participant is ever named, except the host to the
// people going (GAT-01).
import type { Template } from "../db/outbox.ts";
import { dateTimeText, dayText, slotLabel } from "./slots.ts";

export type EmailFacts = {
  siteUrl: string;
  title: string;
  activityId: string;
  gatheringId?: string;
  startsAt?: string;
  endsAt?: string;
  closesAt?: string;
  place?: { name: string; address: string } | null;
  bring?: string;
  hostName?: string | null;
  minPeople?: number;
  going?: number;
  token?: string;
  deadlineAt?: string;
  reason?: "no_host" | "moderator";
};

export type RenderedEmail = { subject: string; text: string; html: string };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c] ?? c);
}

type Draft = { subject: string; lines: string[]; action?: { label: string; url: string } };

const FOOTER = "Count Me In is a non-profit for neighbours. No fees, no ads.";

function when(f: EmailFacts): string {
  return f.startsAt && f.endsAt ? slotLabel(f.startsAt, f.endsAt) : "";
}

function where(f: EmailFacts): string {
  return f.place ? `${f.place.name}, ${f.place.address}` : "to be confirmed";
}

function draft(template: Template, f: EmailFacts): Draft {
  const activityUrl = `${f.siteUrl}/activity/${f.activityId}`;
  const gatheringUrl = `${f.siteUrl}/gathering/${f.gatheringId}`;
  switch (template) {
    case "round_opened":
      return {
        subject: `Enough people for ${f.title}: pick your evenings`,
        lines: [
          `Enough neighbours said Count me in for ${f.title}.`,
          "Tick every evening you can make. The first one to reach the minimum happens.",
          f.closesAt ? `Picking closes on ${dayText(f.closesAt)}.` : "",
        ],
        action: { label: "Pick evenings", url: activityUrl },
      };
    case "round_failed":
      return {
        subject: `${f.title}: no evening worked this time`,
        lines: [
          `None of the offered evenings for ${f.title} got enough people.`,
          "You’re still counted in. We’ll offer new evenings when it fills up again.",
        ],
        action: { label: "See the activity", url: activityUrl },
      };
    case "host_offer":
      return {
        subject: `Would you greet everyone at ${f.title}?`,
        lines: [
          `${f.title} is happening on ${when(f)}.`,
          "Every gathering needs one person to arrive a few minutes early, say hello and keep an eye on the time. Nothing more: no organising, no money.",
          `You were first to say you could make it, so we’re asking you first.${f.deadlineAt ? ` Please answer by ${dateTimeText(f.deadlineAt)}.` : ""}`,
          "If you say no, or don’t answer, we’ll ask the next person. You’re still going either way.",
        ],
        action: { label: "Answer", url: `${f.siteUrl}/host?token=${f.token}` },
      };
    case "gathering_scheduled":
      return {
        subject: `${f.title} is on: ${when(f)}`,
        lines: [
          `When: ${when(f)}`,
          `Where: ${where(f)}`,
          `Bring: ${f.bring || "nothing"}`,
          f.hostName ? `Host: ${f.hostName} will greet everyone.` : "",
          "Can’t make it after all? Say so on the page, so others know. No explanation needed.",
        ],
        action: { label: "See the gathering", url: gatheringUrl },
      };
    case "below_minimum":
      return {
        subject: `${f.title}: fewer people now`,
        lines: [
          `A few people can no longer make ${f.title} on ${when(f)}. ${f.going ?? 0} are still going, fewer than the ${f.minPeople ?? 0} it was planned for.`,
          "The gathering is still on. It’s up to you whether to go.",
        ],
        action: { label: "See the gathering", url: gatheringUrl },
      };
    case "gathering_cancelled":
      return {
        subject: `${f.title} on ${when(f)} is cancelled`,
        lines: [
          f.reason === "no_host"
            ? "We couldn’t find someone to greet everyone, so the gathering won’t go ahead."
            : "Our moderator had to cancel this gathering.",
          "The activity is back in the catalogue and can gather again.",
        ],
        action: { label: "See the activity", url: activityUrl },
      };
    case "reminder":
      return {
        subject: `Tomorrow: ${f.title}`,
        lines: [`When: ${when(f)}`, `Where: ${where(f)}`, `Bring: ${f.bring || "nothing"}`, f.hostName ? `Host: ${f.hostName}` : ""],
        action: { label: "See the gathering", url: gatheringUrl },
      };
  }
}

export function renderEmail(template: Template, facts: EmailFacts): RenderedEmail {
  const d = draft(template, facts);
  const lines = d.lines.filter(Boolean);
  const text = [...lines, "", d.action ? `${d.action.label}: ${d.action.url}` : "", "", FOOTER].join("\n").trim();
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1d2420;max-width:560px">${lines
    .map((l) => `<p>${escapeHtml(l)}</p>`)
    .join("")}${
    d.action
      ? `<p><a href="${escapeHtml(d.action.url)}" style="display:inline-block;background:#1d2420;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px">${escapeHtml(d.action.label)}</a></p>`
      : ""
  }<p style="color:#66706a;font-size:12px">${escapeHtml(FOOTER)}</p></div>`;
  return { subject: d.subject, text, html };
}
