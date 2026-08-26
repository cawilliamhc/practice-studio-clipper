// Running a scraper in the page the toolbar button was clicked on.
//
// Shared by both panes: activeTab's permission is granted by that click, and
// the injected file has to be named relative to the extension root.
export async function runInActiveTab(file) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab.");
  // Now that host_permissions covers http/https, `tab.url` is actually
  // readable, so this guard finally does its job. Under activeTab it could
  // not: the url was itself permission-gated, so on exactly the pages worth
  // rejecting it saw undefined and waved them through to executeScript,
  // which then failed with Chrome's own wording instead of this one.
  if (!/^https?:/i.test(tab.url || "")) {
    throw new Error("RESTRICTED_PAGE");
  }
  const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [file] });
  if (!injection?.result) throw new Error("Couldn't read that page.");
  return injection.result;
}

/**
 * Turns a failed page read into something worth acting on.
 *
 * Far less to translate since host_permissions replaced activeTab: the
 * "click the button on this tab" case is gone entirely, because there is no
 * longer a per-tab grant to be missing. What remains is a page no extension
 * can read, which the guard above now catches by name rather than leaving
 * for Chrome to report from inside executeScript.
 *
 * The Chrome wordings are still matched, for a page that slips past the
 * guard — a redirect to a browser page between the check and the injection.
 */
export function readableScrapeError(err) {
  const raw = err?.message || "";
  if (raw === "RESTRICTED_PAGE" ||
      /chrome:\/\/|chrome-extension:|extensions? gallery|cannot be scripted|cannot access/i.test(raw)) {
    return "This page can't be clipped — browsers keep extensions out of their own pages. Open the therapist's site, then Read this page.";
  }
  return raw || "Something went wrong.";
}
