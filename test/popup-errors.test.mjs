// The guard in runInActiveTab throws RESTRICTED_PAGE by name now that
// host_permissions makes tab.url readable. Under activeTab it couldn't: the
// url was itself permission-gated, so on exactly the pages worth rejecting it
// saw undefined and waved them through.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readableScrapeError } from "../src/active-tab.js";

const RESTRICTED = /browsers keep extensions out/;

describe("readableScrapeError", () => {
  test("translates the guard's own signal", () => {
    assert.match(readableScrapeError(new Error("RESTRICTED_PAGE")), RESTRICTED);
  });

  // Still matched for a page that slips past the guard — a redirect to a
  // browser page between the check and the injection.
  test("still translates Chrome's wordings", () => {
    for (const raw of [
      "Cannot access a chrome:// URL",
      "The extensions gallery cannot be scripted.",
      "Cannot access a chrome-extension:// URL of different extension",
      "Cannot access contents of the page.",
    ]) {
      assert.match(readableScrapeError(new Error(raw)), RESTRICTED, raw);
    }
  });

  test("never leaks the internal signal to the screen", () => {
    assert.doesNotMatch(readableScrapeError(new Error("RESTRICTED_PAGE")), /RESTRICTED_PAGE/);
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
