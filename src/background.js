// The one job a service worker has here: open the side panel on a toolbar
// click, in the one way that also grants permission to read the page.
//
// The panel exists because a popup CANNOT stay open. A popup closes the
// instant it loses focus — browser behaviour, not a setting — so clicking
// into the page to copy a sentence threw away whatever had been typed.
//
// WHY `setPanelBehavior({ openPanelOnActionClick: true })` IS NOT USED, since
// it is the obvious way to do this and was the first thing tried:
//
//   It makes the BROWSER handle the toolbar click. No event is dispatched to
//   the extension, so `chrome.action.onClicked` never fires — and, the part
//   that actually broke things, `activeTab` is never granted. The panel then
//   opened perfectly and every scrape failed with "Cannot access contents of
//   the page", on ordinary therapist sites, because nothing had given the
//   extension permission to read the tab.
//
// Handling the click ourselves is what makes it an extension invocation:
// `activeTab` is granted for that tab, and the panel can then read it. This
// keeps the permission model as it was — the extension can read a page only
// on a tab where the button was clicked, never any tab at any time, which is
// what `host_permissions: ["<all_urls>"]` would have traded away to fix the
// same symptom.
//
// The consequence to know about: the grant is per-tab. Switching tabs and
// pressing "Read this page" reads nothing, because that tab was never
// invoked — click the toolbar button on it instead. active-tab.js says so.
//
// `default_popup` stays absent from the manifest; with it set, the click
// opens a popup and neither this listener nor the panel gets a look in.
chrome.action.onClicked.addListener(async (tab) => {
  try {
    // Called first and without awaiting anything before it: opening a panel
    // needs the user gesture, and a prior await spends it.
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (err) {
    console.warn("[clipper] couldn't open the side panel:", err);
  }
});
