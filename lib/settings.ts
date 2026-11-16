// Timings and limits (backlog item 0.7). Values are starting points from the PRD;
// the pilot will change them, so they live in the `setting` table and these are
// only the defaults used when a key is missing.
// "assumption" marks values the PRD does not give; they await Yuliya's confirmation.

export const DEFAULT_SETTINGS = {
  slots_per_round: 3, // PRD: two or three
  slot_earliest_days: 7, // assumption: leaves at least 4 days to pick
  slot_latest_days: 14, // PRD: within the next 10-14 days
  round_close_days_before: 3, // PRD TIME-04
  venue_reply_hours: 48, // PRD PLC-04
  host_reply_hours: 24, // assumption
  reminder_hours_before: 24, // PRD NTF-01: the day before
  weekday_evening_start: "18:30", // assumption
  weekend_start: "11:00", // assumption
  followup_hour: 10, // assumption, P1
  stale_after_days: 30, // assumption, P1
  digest_weekday: 1, // assumption, P1, Monday
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;
