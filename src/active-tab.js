// Running a scraper in the page the toolbar button was clicked on.
//
// Shared by both panes: activeTab's permission is granted by that click, and
// the injected file has to be named relative to the extension root.
export async function runInActiveTab(file) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab.");
  if (/^(chrome|vivaldi|edge|about|chrome-extension):/i.test(tab.url || "")) {
    throw new Error("This page can't be clipped — open the site first.");
  }
  const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [file] });
  if (!injection?.result) throw new Error("Couldn't read that page.");
  return injection.result;
}

/**
 * Turns a failed page read into something worth reading.
 *
 * The guard in active-tab.js checks `tab.url`, and on a restricted page there
 * is no `tab.url` to check — activeTab is never granted for one, so the guard
 * waves it through and Chrome raises "Cannot access a chrome:// URL" from
 * inside executeScript instead. Accurate, and it reads like a crash rather
 * than like the ordinary "you are on the wrong tab" that it is.
 */
export function readableScrapeError(err) {
  const raw = err?.message || "";
  // Chrome's exact wordings, which are worth pinning rather than paraphrasing:
  // "Cannot access a chrome:// URL", "Cannot access contents of the page.",
  // "The extensions gallery cannot be scripted." (note the plural, which an
  // earlier version of this pattern got wrong and a test caught), and
  // "Cannot access a chrome-extension:// URL of different extension".
  if (/cannot access|chrome:\/\/|extensions? gallery|chrome-extension:|cannot be scripted/i.test(raw)) {
    return "This page can't be clipped — open the therapist's site, then Read this page.";
  }
  return raw || "Something went wrong.";
}
