import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildVCard,
  displayName,
  escapeText,
  foldLine,
  normalizePhone,
  photoExtension,
  photoFileName,
  slugify,
  vcardFileName,
} from "../src/vcard.js";

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

const build = (overrides = {}) => buildVCard({ ...SAMPLE, ...overrides }, { uid: UID });

describe("buildVCard", () => {
  test("emits a well-formed card with CRLF line endings", () => {
    const card = build();
    assert.ok(card.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n"));
    assert.ok(card.endsWith("END:VCARD\r\n"));
    assert.ok(card.includes(`UID:${UID}`));
    assert.ok(!card.includes("\n\n"));
  });

  // FN is the bare name; the letters go in their own property, and in N's
  // suffix component for address books that never heard of X-CREDENTIALS.
  test("keeps credentials out of the display name", () => {
    assert.ok(build().includes("FN:Rowan Aldridge\r\n"));
    assert.ok(build().includes("X-CREDENTIALS:LCSW"));
    assert.ok(build().includes("N:Rowan Aldridge;;;;LCSW"));
  });

  test("writes no credential property when there are none", () => {
    const card = build({ credentials: "" });
    assert.ok(card.includes("FN:Rowan Aldridge\r\n"));
    assert.ok(!card.includes("X-CREDENTIALS"));
    assert.ok(card.includes("N:Rowan Aldridge;;;;\r\n"));
  });

  test("always files the contact as a mental health provider", () => {
    assert.ok(build().includes("X-CONTACT-TYPE:therapist"));
    assert.ok(build({ specialization: "" }).includes("X-CONTACT-TYPE:therapist"));
  });

  test("carries specialization in X-SPECIALIZATION only, not restated in NOTE", () => {
    const card = build();
    assert.ok(card.includes("X-SPECIALIZATION:EMDR\\, adolescent anxiety"));
    assert.ok(!unfold(card).includes("Specialization: "));
  });

  test("keeps the location in NOTE, which is the only place it can survive", () => {
    assert.ok(unfold(build()).includes("Location: 18 Fern Street\\, Suite 4\\, Ashford\\, VT"));
  });

  test("records nothing about where the card came from", () => {
    // Provenance every contact keeps forever is clutter in the record, and
    // the page URL is already on the contact as its website.
    const card = unfold(build());
    assert.ok(!card.includes("Clipped from"));
    assert.ok(!card.includes("cedarhollow.example/about") || card.includes("URL:https://cedarhollow.example/about"));
  });

  test("writes no NOTE at all when there's no address", () => {
    assert.ok(!build({ address: "" }).includes("NOTE"));
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

describe("tags and location", () => {
  test("writes tags as CATEGORIES", () => {
    assert.ok(build({ tags: "EMDR, Trauma, Couples" }).includes("CATEGORIES:EMDR,Trauma,Couples"));
  });

  test("treats every comma in the Tags field as a separator", () => {
    // The popup's Tags field is comma-separated, so a comma there always
    // means "next tag" — there's no way to type one into a tag, and none of
    // the vocabulary contains one.
    assert.ok(build({ tags: "Children, teens, EMDR" }).includes("CATEGORIES:Children,teens,EMDR"));
  });

  test("escapes a semicolon in a tag, which would otherwise read as structure", () => {
    assert.ok(build({ tags: "Grief; loss" }).includes("CATEGORIES:Grief\\; loss"));
  });

  test("drops empty entries and writes nothing when there are no tags", () => {
    assert.ok(build({ tags: "EMDR, , Trauma" }).includes("CATEGORIES:EMDR,Trauma"));
    assert.ok(!build({ tags: "" }).includes("CATEGORIES"));
    assert.ok(!build({ tags: " , " }).includes("CATEGORIES"));
  });

  test("puts the location in NOTE, where it has nowhere else to go", () => {
    assert.ok(unfold(build()).includes("Location: 18 Fern Street"));
  });
});

describe("headshots", () => {
  test("references the image as a bare sibling filename", () => {
    const card = buildVCard(SAMPLE, { uid: UID, photoFileName: "rowan-aldridge-lcsw.jpg" });
    assert.ok(card.includes("PHOTO;VALUE=uri:rowan-aldridge-lcsw.jpg"));
  });

  test("writes no PHOTO line when no image was saved", () => {
    assert.ok(!build().includes("PHOTO"));
    assert.ok(!buildVCard(SAMPLE, { uid: UID, photoFileName: "   " }).includes("PHOTO"));
  });

  test("names the image to match the card", () => {
    assert.equal(vcardFileName(SAMPLE), "rowan-aldridge-lcsw.vcf");
    assert.equal(photoFileName(SAMPLE, "https://x.test/a.jpg"), "rowan-aldridge-lcsw.jpg");
  });

  test("prefers the served content type over the URL's extension", () => {
    assert.equal(photoExtension("https://x.test/photo.jpg", "image/png"), ".png");
    assert.equal(photoExtension("https://x.test/photo", "image/webp; charset=binary"), ".webp");
  });

  test("falls back to the URL extension, ignoring query strings", () => {
    assert.equal(photoExtension("https://x.test/photo.PNG?w=400"), ".png");
    assert.equal(photoExtension("https://x.test/photo.jpeg"), ".jpg");
  });

  test("reads the extension off a relative URL, which has no parseable base", () => {
    assert.equal(photoExtension("/assets/img-headshot.png"), ".png");
    assert.equal(photoExtension("../photos/me.webp?v=2"), ".webp");
  });

  test("guesses jpg when nothing says otherwise", () => {
    assert.equal(photoExtension("https://x.test/image-handler?id=9"), ".jpg");
    assert.equal(photoExtension("not a url"), ".jpg");
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

// A phone number in a referral directory gets dialled, so the rule that
// matters most here is what this REFUSES to reformat.
describe("normalizePhone", () => {
  test("formats a bare tel: href", () => {
    assert.equal(normalizePhone("+15550102288"), "(555) 010-2288");
    assert.equal(normalizePhone("5550102288"), "(555) 010-2288");
  });

  test("normalises whatever punctuation the site used", () => {
    for (const written of [
      "555.010.2288",
      "(555)010-2288",
      "555 010 2288",
      "+1 (555) 010-2288",
      "1-555-010-2288",
      "555–010–2288",
    ]) {
      assert.equal(normalizePhone(written), "(555) 010-2288", written);
    }
  });

  test("collapses non-breaking spaces and stray prose spacing", () => {
    assert.equal(normalizePhone("  (555) 010‑2288  "), "(555) 010-2288");
  });

  test("keeps an extension rather than losing it silently", () => {
    assert.equal(normalizePhone("555-010-2288 ext 4"), "(555) 010-2288 ext. 4");
    assert.equal(normalizePhone("555-010-2288 x212"), "(555) 010-2288 ext. 212");
    assert.equal(normalizePhone("(555) 010-2288 extension 9"), "(555) 010-2288 ext. 9");
  });

  test("takes the first of two numbers run together", () => {
    assert.equal(normalizePhone("55501022885550103399"), "(555) 010-2288");
    assert.equal(normalizePhone("(555) 010-2288(555) 010-3399"), "(555) 010-2288");
  });

  // Everything below is a number this must NOT rewrite.
  test("leaves an international number as written", () => {
    assert.equal(normalizePhone("+44 20 7946 0018"), "+44 20 7946 0018");
  });

  test("leaves a run of digits that isn't a phone number", () => {
    assert.equal(normalizePhone("1234567890"), "1234567890");
    assert.equal(normalizePhone("0123456789"), "0123456789");
  });

  test("leaves something too short to be one", () => {
    assert.equal(normalizePhone("555-2288"), "555-2288");
  });

  test("handles nothing at all", () => {
    assert.equal(normalizePhone(""), "");
    assert.equal(normalizePhone(undefined), "");
    assert.equal(normalizePhone(null), "");
  });
});
