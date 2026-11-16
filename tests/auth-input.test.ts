import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDisplayName,
  normalizeEmail,
  normalizePostcodeDistrict,
  normalizeReturnTo,
} from "../lib/auth-input.ts";

test("email is trimmed, lower-cased and checked", () => {
  assert.equal(normalizeEmail("  Ann@Example.ORG "), "ann@example.org");
  assert.equal(normalizeEmail("not an email"), null);
  assert.equal(normalizeEmail("a@b"), null);
});

test("return path stays on this site", () => {
  assert.equal(normalizeReturnTo("/activity/abc?x=1"), "/activity/abc?x=1");
  assert.equal(normalizeReturnTo("//evil.example/x"), null);
  assert.equal(normalizeReturnTo("https://evil.example"), null);
  assert.equal(normalizeReturnTo(""), null);
});

test("name is one short self-entered name", () => {
  assert.equal(normalizeDisplayName("  Ann   Marie "), "Ann Marie");
  assert.equal(normalizeDisplayName(""), null);
  assert.equal(normalizeDisplayName("x".repeat(41)), null);
  assert.equal(normalizeDisplayName("ann@example.org"), null);
});

test("postcode district: districts pass, full postcodes are cut to the first half", () => {
  assert.equal(normalizePostcodeDistrict("e17"), "E17");
  assert.equal(normalizePostcodeDistrict("SW9"), "SW9");
  assert.equal(normalizePostcodeDistrict("EC1A"), "EC1A");
  assert.equal(normalizePostcodeDistrict("E17 4AB"), "E17");
  assert.equal(normalizePostcodeDistrict("sw1a1aa"), "SW1A");
  assert.equal(normalizePostcodeDistrict("12345"), null);
  assert.equal(normalizePostcodeDistrict("London"), null);
});
