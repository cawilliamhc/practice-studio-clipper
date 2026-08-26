// Two failures look identical from the outside and need opposite advice.
// Collapsing them is what produced "open the therapist's site" while I was
// already on it — so each case is pinned here.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readableScrapeError } from "../src/active-tab.js";

const RESTRICTED = /browsers keep extensions out/;
const NOT_INVOKED = /button in the toolbar on this tab/;

describe("readableScrapeError", () => {
  test("a browser page says go somewhere else", () => {
    for (const raw of [
      "Cannot access a chrome:// URL",
      "The extensions gallery cannot be scripted.",
      "Cannot access a chrome-extension:// URL of different extension",
    ]) {
      assert.match(readableScrapeError(new Error(raw)), RESTRICTED, raw);
    }
  });

  // The one that was actually breaking real clips: an ordinary site the
  // extension has no grant for, because the panel was opened on another tab.
  test("a missing grant says to click the button on this tab", () => {
    for (const raw of [
      "Cannot access contents of the page. Extension manifest must request permission to access the respective host.",
      "Cannot access contents of url. Extension manifest must request permission.",
    ]) {
      assert.match(readableScrapeError(new Error(raw)), NOT_INVOKED, raw);
    }
  });

  // Order matters: a chrome:// failure also contains "cannot access", so the
  // restricted branch has to win or every browser page gets the wrong advice.
  test("a chrome:// failure isn't mistaken for a missing grant", () => {
    const msg = readableScrapeError(new Error("Cannot access a chrome:// URL"));
    assert.match(msg, RESTRICTED);
    assert.doesNotMatch(msg, NOT_INVOKED);
  });

  test("an unrelated failure keeps its own words", () => {
    assert.equal(readableScrapeError(new Error("Couldn't read that page.")), "Couldn't read that page.");
    assert.equal(readableScrapeError(new Error("No active tab.")), "No active tab.");
  });

  test("has something to say when the error carries nothing", () => {
    assert.equal(readableScrapeError(new Error("")), "Something went wrong.");
    assert.equal(readableScrapeError(undefined), "Something went wrong.");
  });
});
