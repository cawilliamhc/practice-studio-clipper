// The one job a service worker has here: make the toolbar button open the
// side panel.
//
// It exists because a popup CANNOT stay open. A popup closes the instant it
// loses focus — that is browser behaviour, not a setting — so clicking into
// the page to copy a sentence threw away whatever had been typed. The side
// panel is docked rather than transient, so the page and the form are usable
// at the same time, which is the whole point of the change.
//
// `default_popup` is deliberately absent from the manifest: with it set, the
// toolbar click opens the popup and the panel never gets a look in. Removing
// it and setting this behaviour is what routes the click to the panel.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.warn("[clipper] couldn't set panel behaviour:", err));

// Fallback for a Chromium build that has the sidePanel API but ignores
// openPanelOnActionClick — without this the button would do nothing at all,
// which is a worse failure than opening the wrong surface.
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (err) {
    console.warn("[clipper] couldn't open the side panel:", err);
  }
});
