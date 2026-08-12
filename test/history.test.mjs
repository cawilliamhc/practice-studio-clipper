// URL normalization carries the weight here: two visits to the same profile
// rarely produce byte-identical URLs, and a history that only matches exact
// strings would quietly never fire.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  describePriorClip,
  describeWhen,
  findPriorClip,
  nameKey,
  normalizeUrl,
  recordClip,
} from "../src/history.js";

const NOW = new Date("2026-08-12T12:00:00.000Z");
const daysBefore = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

describe("normalizeUrl", () => {
  test("ignores scheme, www, trailing slash, and fragment", () => {
    const canonical = "https://northgate.example/team/mira";
    for (const variant of [
      "http://northgate.example/team/mira",
      "https://www.northgate.example/team/mira/",
      "https://northgate.example/team/mira#bio",
      "https://NorthGate.example/team/mira",
    ]) {
      assert.equal(normalizeUrl(variant), canonical, variant);
    }
  });

  test("drops campaign parameters but keeps meaningful ones", () => {
    assert.equal(
      normalizeUrl("https://directory.example/p?id=482&utm_source=newsletter&fbclid=xyz"),
      "https://directory.example/p?id=482"
    );
  });

  test("keeps genuinely different pages apart", () => {
    assert.notEqual(normalizeUrl("https://a.example/one"), normalizeUrl("https://a.example/two"));
  });

  test("falls back to lowercased text for something unparseable", () => {
    assert.equal(normalizeUrl("Not A URL"), "not a url");
    assert.equal(normalizeUrl(null), "");
  });
});

describe("nameKey", () => {
  test("collapses case, punctuation, and spacing", () => {
    assert.equal(nameKey("  Mira   O'Konjo-Reyes "), "mira o konjo reyes");
  });

  test("tolerates missing input", () => {
    assert.equal(nameKey(undefined), "");
  });
});

describe("recordClip", () => {
  test("puts the newest clip first", () => {
    let clips = recordClip([], { url: "https://a.example/x", name: "Devi Ramanathan", savedAt: daysBefore(3) });
    clips = recordClip(clips, { url: "https://b.example/y", name: "Soren Blackwell", savedAt: daysBefore(1) });
    assert.deepEqual(clips.map((c) => c.name), ["Soren Blackwell", "Devi Ramanathan"]);
  });

  test("replaces an earlier clip of the same page rather than stacking", () => {
    let clips = recordClip([], { url: "https://a.example/x", name: "Devi Ramanathan", savedAt: daysBefore(9) });
    clips = recordClip(clips, { url: "https://www.a.example/x/", name: "Devi Ramanathan", savedAt: daysBefore(1) });
    assert.equal(clips.length, 1);
    assert.equal(clips[0].savedAt, daysBefore(1));
  });

  test("keeps the same person clipped from a genuinely different page", () => {
    let clips = recordClip([], { url: "https://own-site.example/about", name: "Mira Okonjo" });
    clips = recordClip(clips, { url: "https://directory.example/mira", name: "Mira Okonjo" });
    assert.equal(clips.length, 2);
  });

  test("caps the history so it can't grow without bound", () => {
    let clips = [];
    for (let i = 0; i < 520; i++) clips = recordClip(clips, { url: `https://a.example/${i}`, name: `Person ${i}` });
    assert.equal(clips.length, 500);
    assert.equal(clips[0].name, "Person 519");
  });

  test("survives a corrupt stored history", () => {
    const clips = recordClip([null, "junk", undefined], { url: "https://a.example/x", name: "Ines Vaughn" });
    assert.equal(clips.length, 1);
  });
});

describe("findPriorClip", () => {
  const clips = [
    { url: "https://own-site.example/about", nameKey: "mira okonjo", name: "Mira Okonjo", savedAt: daysBefore(2) },
    { url: "https://a.example/zora", nameKey: "zora vance", name: "Zora Vance", savedAt: daysBefore(40) },
  ];

  test("matches the same page across URL variations", () => {
    const found = findPriorClip(clips, { url: "http://www.own-site.example/about/", name: "Someone Else" });
    assert.equal(found.matchedOn, "url");
  });

  test("matches the same person from a different page", () => {
    const found = findPriorClip(clips, { url: "https://directory.example/mira", name: "Mira Okonjo" });
    assert.equal(found.matchedOn, "name");
    assert.equal(found.clip.name, "Mira Okonjo");
  });

  test("prefers the URL match when both would hit", () => {
    const found = findPriorClip(clips, { url: "https://a.example/zora", name: "Mira Okonjo" });
    assert.equal(found.matchedOn, "url");
    assert.equal(found.clip.name, "Zora Vance");
  });

  test("returns null for a page and person never seen", () => {
    assert.equal(findPriorClip(clips, { url: "https://new.example/x", name: "Ines Vaughn" }), null);
  });

  test("does not match on an empty name", () => {
    assert.equal(findPriorClip(clips, { url: "https://new.example/x", name: "" }), null);
  });

  test("tolerates a missing history", () => {
    assert.equal(findPriorClip(undefined, { url: "https://a.example/x", name: "X" }), null);
  });
});

describe("describeWhen", () => {
  test("uses plain words for recent clips", () => {
    assert.equal(describeWhen(daysBefore(0), NOW), "today");
    assert.equal(describeWhen(daysBefore(1), NOW), "yesterday");
    assert.equal(describeWhen(daysBefore(6), NOW), "6 days ago");
  });

  test("falls back to a date once it's stale", () => {
    assert.match(describeWhen(daysBefore(45), NOW), /2026/);
  });

  test("degrades gracefully on a bad timestamp", () => {
    assert.equal(describeWhen("not a date", NOW), "earlier");
  });
});

describe("describePriorClip", () => {
  test("says it's this page when the URL matched", () => {
    const prior = { matchedOn: "url", clip: { savedAt: daysBefore(1) } };
    assert.equal(describePriorClip(prior, NOW), "You clipped this page yesterday.");
  });

  test("names the person when only the name matched", () => {
    const prior = { matchedOn: "name", clip: { name: "Mira Okonjo", savedAt: daysBefore(3) } };
    assert.equal(describePriorClip(prior, NOW), "You clipped Mira Okonjo 3 days ago, from another page.");
  });

  test("says nothing when there's no prior clip", () => {
    assert.equal(describePriorClip(null, NOW), null);
  });
});
