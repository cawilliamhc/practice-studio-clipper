// The one job a service worker has here: open the side panel on a toolbar
// click.
//
// The panel exists because a popup CANNOT stay open. A popup closes the
// instant it loses focus — browser behaviour, not a setting — so clicking
// into the page to copy a sentence threw away whatever had been typed.
//
// WHY `setPanelBehavior({ openPanelOnActionClick: true })` IS NOT USED: it
// makes the BROWSER handle the click, so no event reaches the extension and
// `chrome.action.onClicked` never fires. Handling the click here is what
// opens the panel at all.
//
// That used to matter for a second reason — the click was also what granted
// `activeTab` — and that was the wrong foundation. A panel that stays open
// while you browse to OTHER tabs is exactly what a per-invocation grant does
// not cover, so reading a second therapist's page failed every time. The
// extension now holds standing `host_permissions` for http/https instead,
// and this click only has to open the panel. The README says what that
// widened and why it was the right trade for this extension.
chrome.action.onClicked.addListener(async (tab) => {
  try {
    // Called before any other await: opening a panel needs the user gesture,
    // and an earlier await spends it.
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (err) {
    console.warn("[clipper] couldn't open the side panel:", err);
  }
});
