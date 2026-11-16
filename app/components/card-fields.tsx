"use client";

// The fields of an activity card, shared by /suggest and the moderator's edit form.
export type CardDraft = {
  title: string;
  outcome: string;
  minPeople: string;
  maxPeople: string;
  durationHours: string;
  bring: string;
  materialsCost: string;
  placeKind: "public" | "venue";
  needsKnower: boolean;
  season: string;
  instructions: string;
};

export const EMPTY_CARD: CardDraft = {
  title: "", outcome: "", minPeople: "3", maxPeople: "8", durationHours: "2", bring: "", materialsCost: "0",
  placeKind: "venue", needsKnower: false, season: "", instructions: "",
};

export function toPayload(d: CardDraft) {
  return { ...d, minPeople: Number(d.minPeople), maxPeople: Number(d.maxPeople), durationHours: Number(d.durationHours), materialsCost: Number(d.materialsCost || 0) };
}

export function CardFields({ draft, onChange, fields, idPrefix = "c" }: {
  draft: CardDraft;
  onChange: (d: CardDraft) => void;
  fields: Record<string, string>;
  idPrefix?: string;
}) {
  const set = <K extends keyof CardDraft>(key: K, value: CardDraft[K]) => onChange({ ...draft, [key]: value });
  const err = (key: string) => (fields[key] ? <span className="form-error">{fields[key]}</span> : null);
  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <>
      <label htmlFor={id("title")}>Name of the activity</label>
      <input id={id("title")} value={draft.title} onChange={(e) => set("title", e.target.value)} maxLength={80} />{err("title")}
      <label htmlFor={id("outcome")}>What everyone has done or made by the end</label>
      <input id={id("outcome")} value={draft.outcome} onChange={(e) => set("outcome", e.target.value)} maxLength={200} />{err("outcome")}
      <label htmlFor={id("min")}>Fewest people it works with</label>
      <input id={id("min")} inputMode="numeric" value={draft.minPeople} onChange={(e) => set("minPeople", e.target.value)} />{err("minPeople")}
      <label htmlFor={id("max")}>Most people</label>
      <input id={id("max")} inputMode="numeric" value={draft.maxPeople} onChange={(e) => set("maxPeople", e.target.value)} />{err("maxPeople")}
      <label htmlFor={id("hours")}>How long, in hours</label>
      <input id={id("hours")} inputMode="decimal" value={draft.durationHours} onChange={(e) => set("durationHours", e.target.value)} />{err("durationHours")}
      <label htmlFor={id("bring")}>What to bring (optional)</label>
      <input id={id("bring")} value={draft.bring} onChange={(e) => set("bring", e.target.value)} maxLength={200} />
      <label htmlFor={id("cost")}>Materials per person, £ (0 if none)</label>
      <input id={id("cost")} inputMode="decimal" value={draft.materialsCost} onChange={(e) => set("materialsCost", e.target.value)} />{err("materialsCost")}
      <label htmlFor={id("kind")}>Where</label>
      <select id={id("kind")} value={draft.placeKind} onChange={(e) => set("placeKind", e.target.value as CardDraft["placeKind"])}>
        <option value="venue">Indoors, in a checked venue (hall, library room, café)</option>
        <option value="public">Outdoors, in a public place (park, street)</option>
      </select>{err("placeKind")}
      <div className="check">
        <input id={id("knower")} type="checkbox" checked={draft.needsKnower} onChange={(e) => set("needsKnower", e.target.checked)} />
        <label htmlFor={id("knower")}>Someone who already knows how is needed</label>
      </div>
      <label htmlFor={id("season")}>Season (optional, e.g. December)</label>
      <input id={id("season")} value={draft.season} onChange={(e) => set("season", e.target.value)} maxLength={40} />
      <label htmlFor={id("instr")}>Simple instructions, so beginners manage without an expert (optional)</label>
      <textarea id={id("instr")} value={draft.instructions} onChange={(e) => set("instructions", e.target.value)} maxLength={2000} rows={4} />
    </>
  );
}
