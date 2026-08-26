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
 * Turns a failed page read into something worth acting on.
 *
 * Two failures look alike from here and need opposite advice, and an earlier
 * version of this collapsed them into one — which sent me to "open the
 * therapist's site" while I was already standing on it:
 *
 *   RESTRICTED PAGE — chrome://, the web store, another extension. Nothing
 *   can ever read these. Go somewhere else.
 *
 *   NOT INVOKED ON THIS TAB — an ordinary site the extension simply has no
 *   permission for, because `activeTab` is granted per tab by clicking the
 *   toolbar button, and this tab never got that click. Common now the panel
 *   outlives the tab it was opened on: browsing to a second therapist and
 *   pressing "Read this page" lands here every time.
 *
 * The guard above catches neither, and can't: it tests `tab.url`, which is
 * itself only readable with permission, so on both of these it sees undefined
 * and waves the tab through to executeScript.
 */
export function readableScrapeError(err) {
  const raw = err?.message || "";

  // Chrome's exact wordings, pinned rather than paraphrased. "extensions
  // gallery" is plural — an earlier pattern got that wrong and a test caught it.
  if (/chrome:\/\/|chrome-extension:|extensions? gallery|cannot be scripted/i.test(raw)) {
    return "This page can't be clipped — browsers keep extensions out of their own pages. Open the therapist's site instead.";
  }
  // "Cannot access contents of the page. Extension manifest must request
  // permission to access the respective host."
  if (/cannot access contents|must request permission|cannot access/i.test(raw)) {
    return "Click the Practice Studio button in the toolbar on this tab, then try again — the extension only gets to read a page you've opened it on.";
  }
  return raw || "Something went wrong.";
}
