// Picking evenings (backlog 4.1, PRD TIME-01 and TIME-04). Pure, so it is unit-tested.
//
// When a card reaches its minimum, the platform offers two or three slots between
// `slot_earliest_days` and `slot_latest_days` from now. Each slot is scored by how many
// interested people said that kind of time suits them (no times ticked = any time suits).
// The first picks go to different kinds of time, so people with different weeks get a choice.
// For indoor cards, slots fall inside venues' standing windows when there are any.
// All clock times are Europe/London; stored values are UTC ISO strings.
import { DEFAULT_SETTINGS } from "./settings.ts";
import type { TimeChoice } from "./catalogue.ts";

const TZ = "Europe/London";
const DAY_MS = 24 * 60 * 60 * 1000;

export type Window = { weekday: number; startTime: string; endTime: string };

export type ProposedSlot = { startsAt: string; endsAt: string; kind: TimeChoice };

export type SlotSettings = Pick<
  typeof DEFAULT_SETTINGS,
  "slots_per_round" | "slot_earliest_days" | "slot_latest_days" | "round_close_days_before" | "weekday_evening_start" | "weekend_start"
>;

const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
});

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** London calendar date (YYYY-MM-DD), weekday (1 = Monday) and offset from UTC in minutes. */
export function londonParts(at: Date): { date: string; weekday: number; offsetMin: number } {
  const parts = Object.fromEntries(formatter.formatToParts(at).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  const wholeMinute = Math.floor(at.getTime() / 60000) * 60000;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS.indexOf(parts.weekday) + 1,
    offsetMin: Math.round((asUtc - wholeMinute) / 60000),
  };
}

/** The UTC instant of a London wall-clock time, across GMT and BST. */
export function londonToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, h, min);
  let utc = wall - londonParts(new Date(wall)).offsetMin * 60000;
  utc = wall - londonParts(new Date(utc)).offsetMin * 60000;
  return new Date(utc);
}

function minutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function kindOf(weekday: number): TimeChoice {
  if (weekday === 6) return "saturday";
  if (weekday === 7) return "sunday";
  return "weekday_evening";
}

type Candidate = ProposedSlot & { weight: number; date: string };

export function proposeSlots(input: {
  now: Date;
  durationMin: number;
  /** Each interested person's ticked times. */
  interestTimes: string[][];
  /** Venues' standing windows; when given and non-empty, slots must fit inside one. */
  windows?: Window[];
  settings?: SlotSettings;
}): ProposedSlot[] {
  const settings = input.settings ?? DEFAULT_SETTINGS;
  const windows = input.windows?.length ? input.windows : null;
  const candidates: Candidate[] = [];

  for (let offset = settings.slot_earliest_days; offset <= settings.slot_latest_days; offset++) {
    const { date, weekday } = londonParts(new Date(input.now.getTime() + offset * DAY_MS));
    const kind = kindOf(weekday);
    const weight = input.interestTimes.filter((times) => times.length === 0 || times.includes(kind)).length;
    let start: string | undefined;
    if (windows) {
      start = windows
        .filter((w) => w.weekday === weekday && minutes(w.endTime) - minutes(w.startTime) >= input.durationMin)
        .map((w) => w.startTime)
        .sort()[0];
      if (!start) continue;
    } else {
      start = kind === "weekday_evening" ? settings.weekday_evening_start : settings.weekend_start;
    }
    const startsAt = londonToUtc(date, start);
    candidates.push({
      date,
      kind,
      weight,
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + input.durationMin * 60000).toISOString(),
    });
  }

  // Times nobody asked for are offered only when fewer than two slots would be left otherwise.
  const wanted = candidates.filter((c) => c.weight > 0);
  const pool = (wanted.length >= 2 ? wanted : candidates).sort(
    (a, b) => b.weight - a.weight || a.startsAt.localeCompare(b.startsAt),
  );

  const picked: Candidate[] = [];
  const usedKinds = new Set<TimeChoice>();
  for (const c of pool) {
    if (picked.length >= settings.slots_per_round) break;
    if (!usedKinds.has(c.kind)) {
      picked.push(c);
      usedKinds.add(c.kind);
    }
  }
  for (const c of pool) {
    if (picked.length >= settings.slots_per_round) break;
    if (!picked.includes(c)) picked.push(c);
  }

  return picked
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map(({ startsAt, endsAt, kind }) => ({ startsAt, endsAt, kind }));
}

/** TIME-04: picking closes `round_close_days_before` days before the earliest slot. */
export function roundClosesAt(slots: ProposedSlot[], settings: SlotSettings = DEFAULT_SETTINGS): string {
  const earliest = Math.min(...slots.map((s) => Date.parse(s.startsAt)));
  return new Date(earliest - settings.round_close_days_before * DAY_MS).toISOString();
}

const dayLabel = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const timeLabel = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "Sat 28 Nov, 11:00–13:00", always in London time. */
export function slotLabel(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  return `${dayText(startsAt)}, ${timeLabel.format(start)}–${timeLabel.format(new Date(endsAt))}`;
}

/** "Thu 26 Nov", in London time. */
export function dayText(at: string): string {
  return dayLabel.format(new Date(at)).replace(",", "");
}

/** "3 can make it · 1 more needed" for one offered evening. */
export function slotCounter(canMake: number, minPeople: number): string {
  const more = Math.max(0, minPeople - canMake);
  return more ? `${canMake} can make it · ${more} more needed` : `${canMake} can make it`;
}
