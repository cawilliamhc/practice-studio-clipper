// A restricted page is the ordinary case — you open the panel, then go and
// find the therapist's site — so it has to read like a nudge, not a crash.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readableScrapeError } from "../src/active-tab.js";

describe("readableScrapeError", () => {
  // Chrome's own wording, raised from inside executeScript. The guard in
  // active-tab.js can't catch this: activeTab is never granted on a
  // restricted page, so there is no tab.url for it to test.
  test("translates Chrome's chrome:// refusal", () => {
    const msg = readableScrapeError(new Error("Cannot access a chrome:// URL"));
    assert.match(msg, /open the therapist's site/);
    assert.doesNotMatch(msg, /chrome:\/\//);
  });

  test("translates the extension-gallery and extension-page variants", () => {
    for (const raw of [
      "Cannot access contents of the page. Extension manifest must request permission",
      "The extensions gallery cannot be scripted.",
      "Cannot access a chrome-extension:// URL of different extension",
    ]) {
      assert.match(readableScrapeError(new Error(raw)), /open the therapist's site/, raw);
    }
  });

  // Anything else keeps its own words — a real fault shouldn't be dressed up
  // as "you're on the wrong tab".
  test("leaves an unrelated failure alone", () => {
    assert.equal(readableScrapeError(new Error("Couldn't read that page.")), "Couldn't read that page.");
    assert.equal(readableScrapeError(new Error("No active tab.")), "No active tab.");
  });

  test("has something to say when the error carries nothing", () => {
    assert.equal(readableScrapeError(new Error("")), "Something went wrong.");
    assert.equal(readableScrapeError(undefined), "Something went wrong.");
  });
});
