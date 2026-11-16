import assert from "node:assert/strict";
import test from "node:test";
import { TICK_PATH, signTick, verifyTick } from "../lib/scheduler.ts";

const secret = "a".repeat(64);
const now = Date.parse("2026-11-16T10:00:00Z");
const stamp = String(now / 1000);

async function call(init: { time?: string; signature?: string; path?: string; origin?: string; method?: string } = {}) {
  const headers: Record<string, string> = {
    "x-cmi-time": init.time ?? stamp,
    "x-cmi-signature": init.signature ?? (await signTick(secret, init.time ?? stamp)),
  };
  if (init.origin) headers.origin = init.origin;
  return new Request(`https://example.org${init.path ?? TICK_PATH}`, { method: init.method ?? "POST", headers });
}

test("a fresh, correctly signed call is accepted", async () => {
  assert.equal(await verifyTick(await call(), secret, now), true);
});

test("wrong key, stale time, other path, browser origin or GET are refused", async () => {
  assert.equal(await verifyTick(await call({ signature: await signTick("b".repeat(64), stamp) }), secret, now), false);
  assert.equal(await verifyTick(await call(), secret, now + 301_000), false);
  assert.equal(await verifyTick(await call({ path: "/api/internal/tick?x=1" }), secret, now), false);
  assert.equal(await verifyTick(await call({ origin: "https://example.org" }), secret, now), false);
  assert.equal(await verifyTick(await call({ method: "GET" }), secret, now), false);
});

test("no secret configured means nothing is accepted", async () => {
  assert.equal(await verifyTick(await call(), undefined, now), false);
  assert.equal(await verifyTick(await call(), "short", now), false);
});

test("the SQL script signs the same message the site checks", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../ops/supabase/scheduler.sql", import.meta.url), "utf8");
  assert.match(sql, /'count-me-in-tick-v1' \|\| chr\(10\) \|\| 'POST' \|\| chr\(10\) \|\| '\/api\/internal\/tick' \|\| chr\(10\) \|\| stamp/);
  assert.match(sql, /'x-cmi-time'/);
  assert.match(sql, /'x-cmi-signature'/);
});
