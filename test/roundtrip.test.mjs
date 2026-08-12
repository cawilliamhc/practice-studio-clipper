// Round-trips this extension's output through Practice Studio's REAL parser
// rather than a local copy of what it's assumed to do — the whole point of the
// card is that the app reads it correctly, and a reimplementation of the
// parser here could agree with the writer while both disagree with the app.
//
// Node strips the type-only import in vcard.ts natively, so the app's module
// loads without its build toolchain. Skipped when the sibling checkout isn't
// present, so this repo still tests standalone.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildVCard } from "../src/vcard.js";

const APP_VCARD = fileURLToPath(
  new URL("../../practice-studio-desktop/client/src/lib/vcard.ts", import.meta.url)
);

const available = existsSync(APP_VCARD);
let parseVCard, splitVCards;

before(async () => {
  if (!available) return;
  ({ parseVCard, splitVCards } = await import(APP_VCARD));
});

describe("Practice Studio reads what the clipper writes", { skip: !available && "sibling checkout not found" }, () => {
  const card = () =>
    buildVCard(
      {
        fullName: "Mira Okonjo",
        credentials: "LMFT",
        organization: "Northgate Family Therapy, LLC",
        phone: "(555) 010-2288",
        email: "mira@northgate.example",
        website: "https://northgate.example/team/mira",
        specialization: "Couples work; perinatal",
        address: "9 Larkspur Ave, Ashford, VT",
      },
      { uid: "abc-123", sourceUrl: "https://northgate.example/team/mira", scrapedAt: "2026-08-12T00:00:00.000Z" }
    );

  test("core fields survive the round trip", () => {
    const parsed = parseVCard(card());
    assert.equal(parsed.id, "abc-123");
    assert.equal(parsed.fullName, "Mira Okonjo, LMFT");
    assert.equal(parsed.organization, "Northgate Family Therapy, LLC");
    assert.equal(parsed.phone, "(555) 010-2288");
    assert.equal(parsed.email, "mira@northgate.example");
    assert.equal(parsed.website, "https://northgate.example/team/mira");
    assert.equal(parsed.type, "therapist");
  });

  test("escaped separators come back as typed, not as vCard structure", () => {
    const parsed = parseVCard(card());
    assert.ok(parsed.organization.includes(","), "comma in org survived");
    assert.ok(parsed.specialization.includes(";"), "semicolon in specialization survived");
  });

  test("specialization arrives as a field, not buried in the notes", () => {
    const parsed = parseVCard(card());
    assert.equal(parsed.specialization, "Couples work; perinatal");
    assert.doesNotMatch(parsed.notes, /Specialization:/);
  });

  test("provenance and address reach the notes field", () => {
    const notes = parseVCard(card()).notes;
    assert.match(notes, /Address: 9 Larkspur Ave, Ashford, VT/);
    assert.match(notes, /Clipped from https:\/\/northgate\.example\/team\/mira on 2026-08-12/);
    assert.match(notes, /\n/, "note lines unescape to real newlines");
  });

  test("long folded values unfold back to the original text", () => {
    // Both a long NOTE (address plus provenance) and a long property value
    // wrap past the 75-char fold, and both have to survive the trip.
    const address = "Suite 300, " + "1600 Longmeadow Boulevard East, ".repeat(3) + "Ashford, VT";
    const specialization = "trauma, attachment, grief work, and perinatal mental health".repeat(2);
    const parsed = parseVCard(
      buildVCard(
        { fullName: "Ines Vaughn", credentials: "PsyD", address, specialization },
        { uid: "def-456", sourceUrl: "https://example.test/ines", scrapedAt: "2026-08-12T00:00:00.000Z" }
      )
    );
    assert.ok(parsed.notes.includes(address), "folded NOTE reassembled intact");
    assert.equal(parsed.specialization, specialization);
  });

  test("several clipped cards concatenate into one importable file", () => {
    const one = buildVCard({ fullName: "Devi Ramanathan", credentials: "LPC" }, { uid: "u1" });
    const two = buildVCard({ fullName: "Soren Blackwell", credentials: "LCSW" }, { uid: "u2" });
    const cards = splitVCards(one + two);
    assert.equal(cards.length, 2);
    assert.deepEqual(cards.map((c) => parseVCard(c).fullName), [
      "Devi Ramanathan, LPC",
      "Soren Blackwell, LCSW",
    ]);
  });
});
