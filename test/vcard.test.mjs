import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildVCard, displayName, escapeText, foldLine, slugify, vcardFileName } from "../src/vcard.js";

const UID = "00000000-0000-4000-8000-000000000001";

const SAMPLE = {
  fullName: "Rowan Aldridge",
  credentials: "LCSW",
  organization: "Cedar Hollow Counseling, PLLC",
  phone: "(555) 010-4477",
  email: "rowan@cedarhollow.example",
  website: "https://cedarhollow.example/about",
  specialization: "EMDR, adolescent anxiety",
  address: "18 Fern Street, Suite 4, Ashford, VT",
};

/** Rejoins folded continuation lines, the way any vCard reader does. */
const unfold = (card) => card.replace(/\r\n /g, "");

const build = (overrides = {}) =>
  buildVCard(
    { ...SAMPLE, ...overrides },
    { uid: UID, sourceUrl: "https://cedarhollow.example/about", scrapedAt: "2026-08-12T14:03:00.000Z" }
  );

describe("buildVCard", () => {
  test("emits a well-formed card with CRLF line endings", () => {
    const card = build();
    assert.ok(card.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n"));
    assert.ok(card.endsWith("END:VCARD\r\n"));
    assert.ok(card.includes(`UID:${UID}`));
    assert.ok(!card.includes("\n\n"));
  });

  test("appends credentials to the display name", () => {
    assert.ok(build().includes("FN:Rowan Aldridge\\, LCSW"));
  });

  test("omits the credential separator when there are none", () => {
    assert.ok(build({ credentials: "" }).includes("FN:Rowan Aldridge\r\n"));
  });

  test("always files the contact as a mental health provider", () => {
    assert.ok(build().includes("X-CONTACT-TYPE:therapist"));
    assert.ok(build({ specialization: "" }).includes("X-CONTACT-TYPE:therapist"));
  });

  test("carries specialization in NOTE as well as X-SPECIALIZATION", () => {
    const card = build();
    assert.ok(card.includes("X-SPECIALIZATION:EMDR\\, adolescent anxiety"));
    assert.ok(card.includes("Specialization: EMDR\\, adolescent anxiety"));
  });

  test("records where the card came from", () => {
    // Unfold first: a NOTE this long wraps, so the provenance line is split
    // across continuations in the raw text.
    assert.ok(unfold(build()).includes("Clipped from https://cedarhollow.example/about on 2026-08-12"));
  });

  test("leaves the URL unescaped so the link stays usable", () => {
    const card = build({ website: "https://example.test/a,b" });
    assert.ok(card.includes("URL:https://example.test/a,b"));
  });

  test("skips properties with no value", () => {
    const card = build({ phone: "", email: "", organization: "" });
    assert.ok(!card.includes("TEL"));
    assert.ok(!card.includes("EMAIL"));
    assert.ok(!card.includes("ORG:"));
  });

  test("refuses a card with no name", () => {
    assert.throws(() => build({ fullName: "", credentials: "" }), /needs a name/);
  });
});

describe("helpers", () => {
  test("escapeText escapes structural characters only", () => {
    assert.equal(escapeText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  });

  test("foldLine leaves short lines alone", () => {
    assert.equal(foldLine("NOTE:short"), "NOTE:short");
  });

  test("foldLine wraps with CRLF plus one space", () => {
    const folded = foldLine("NOTE:" + "x".repeat(100));
    assert.ok(folded.includes("\r\n "));
    for (const line of folded.split("\r\n")) assert.ok(line.length <= 76);
  });

  test("slugify falls back when nothing survives", () => {
    assert.equal(slugify("Rowan Aldridge, LCSW"), "rowan-aldridge-lcsw");
    assert.equal(slugify("—"), "contact");
  });

  test("vcardFileName includes credentials", () => {
    assert.equal(vcardFileName(SAMPLE), "rowan-aldridge-lcsw.vcf");
  });

  test("displayName tolerates missing credentials", () => {
    assert.equal(displayName({ fullName: "Mira Okonjo" }), "Mira Okonjo");
  });
});
