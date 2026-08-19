// Which pane the popup opens on, and the switch between them.
//
// The mode is guessed from the page and then left alone: a page that declares
// itself a book (schema.org Book, og:type=book, or one of the shops in
// scrape-book.js) opens on Books, everything else on Contact — which is what
// most clipping still is. A guess is never binding; the switch is right there,
// and the other pane reads the page the first time it's shown.
import { runInActiveTab } from "./active-tab.js";
import { startContactMode, hideContactMode } from "./popup.js";
import { startBookMode, hideBookMode } from "./book-popup.js";

const buttons = [...document.querySelectorAll("#mode-switch button")];

let bookScrape = null;
/** One read of the page, shared by the probe and the book pane — the probe
 *  already has everything the pane needs, and re-injecting would be a second
 *  trip for the same answer. */
async function scrapeBookPage() {
  if (!bookScrape) bookScrape = await runInActiveTab("src/scrape-book.js");
  return bookScrape;
}

async function show(mode) {
  for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  if (mode === "book") {
    hideContactMode();
    await startBookMode(scrapeBookPage);
  } else {
    hideBookMode();
    await startContactMode();
  }
}

for (const button of buttons) {
  button.addEventListener("click", () => show(button.dataset.mode));
}

(async () => {
  let looksLikeBook = false;
  try {
    looksLikeBook = Boolean((await scrapeBookPage()).looksLikeBook);
  } catch {
    // An unreadable page is the contact pane's problem to report — it has the
    // status line and the better message for it.
  }
  await show(looksLikeBook ? "book" : "contact");
})();
