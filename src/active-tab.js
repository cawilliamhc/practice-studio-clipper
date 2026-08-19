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
