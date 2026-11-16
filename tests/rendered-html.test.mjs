import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/", init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" }, ...init }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the Count Me In landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Count Me In<\/title>/i);
  assert.match(html, /Count me in/);
  assert.match(html, /<html lang="en"/i);
});

test("sign-in page asks only for an email", async () => {
  const html = await (await render("/signin")).text();
  assert.match(html, /Email me a link/);
  assert.match(html, /type="email"/);
  assert.doesNotMatch(html, /type="password"/i);
});

test("first sign-in asks for a name, postcode district, 18+ and the rules, nothing more", async () => {
  const html = await (await render("/welcome")).text();
  assert.match(html, /Your name/);
  assert.match(html, /First part of your postcode/);
  assert.match(html, /18 or over/);
  assert.match(html, /href="\/rules"/);
  assert.doesNotMatch(html, /type="(tel|date|password)"|autoComplete="(family-name|tel|bday|street-address)"/i);
  // Two text fields (name, district) and three checkboxes (18+, rules, show name).
  assert.equal((html.match(/<input/g) ?? []).length, 5);
});

test("rules page is marked as a draft", async () => {
  const html = await (await render("/rules")).text();
  assert.match(html, /Draft/);
  assert.match(html, /never at someone’s home/);
});

const post = (path, body) =>
  render(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("sign-in link request rejects a bad email before touching anything", async () => {
  const response = await post("/api/auth/request-link", { email: "nope" });
  assert.equal(response.status, 400);
});

test("first sign-in rejects a missing 18+ mark and a full address", async () => {
  const response = await post("/api/account", { displayName: "Ann", postcode: "12 Willow Street", adult: false, rules: true });
  assert.equal(response.status, 400);
  const data = await response.json();
  assert.ok(data.fields.adult);
  assert.ok(data.fields.postcode);
});

test("cross-site form posts are refused", async () => {
  const response = await render("/api/auth/request-link", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: JSON.stringify({ email: "a@example.org" }),
  });
  assert.equal(response.status, 403);
});

test("activity page renders its shell and says only counts are public", async () => {
  const response = await render("/activity/some-card");
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Loading/);
});

test("Count me in without signing in asks to sign in", async () => {
  const response = await render("/api/activities/some-card/interest", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ times: ["saturday"] }),
  });
  assert.equal(response.status, 401);
});

test("Count me in from another site is refused", async () => {
  const response = await render("/api/activities/some-card/interest", {
    method: "PUT",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: "{}",
  });
  assert.equal(response.status, 403);
});

test("picking an evening without signing in asks to sign in", async () => {
  const response = await render("/api/slots/some-slot/vote", { method: "PUT" });
  assert.equal(response.status, 401);
});

test("hosting page does nothing until a button is pressed", async () => {
  const html = await (await render("/host?token=abc")).text();
  assert.match(html, /Would you greet everyone/);
  assert.match(html, /Not this time/);
});

test("a malformed hosting link is refused", async () => {
  const response = await post("/api/host-offer", { token: "abc", accept: true });
  assert.equal(response.status, 400);
});

test("joining a gathering without signing in asks to sign in", async () => {
  const response = await render("/api/gatherings/some-gathering/attendance", { method: "PUT" });
  assert.equal(response.status, 401);
});
