// The book half of the popup: read a book page, let Carl correct it, write a
// .book.json into the library inbox for Practice Studio to import.
//
// It owns #book-pane and nothing else; the contact half in popup.js owns its
// own subtree, and popup-main.js decides which one is showing.
//
// Nothing here knows or asks who a book is for. The extension writes a title,
// an author, a number and a picture — the loan is recorded in the app, where
// the client data already lives. That boundary is the point of clipping
// through a file drop rather than an endpoint: there is nothing here worth
// attacking.
import { bookFileName, buildBookRecord, coverFileName, normalizeIsbn, tidyAuthor, tidyTitle } from "./book.js";
import { describePriorClip, findPriorClip, loadClipHistory, recordClip, saveClipHistory } from "./history.js";

const INBOX_SUBFOLDER = "ps-library-inbox";

const FIELDS = [
  ["title", "Title"],
  ["author", "Author"],
  ["isbn", "ISBN"],
];

const pane = document.getElementById("book-pane");
const form = document.getElementById("book-form");
const saveButton = document.getElementById("book-save");
const status = document.getElementById("book-status");
const prior = document.getElementById("book-prior");
const coverBlock = document.getElementById("cover");
const coverImg = document.getElementById("cover-img");
const coverSrc = document.getElementById("cover-src");
const coverClear = document.getElementById("cover-clear");

let scraped = null;
let clipHistory = [];
let coverUrl = null;
let started = false;

function setStatus(message, kind = "") {
  status.textContent = message;
  status.className = kind;
}

function render(fields, sources) {
  form.replaceChildren();
  for (const [key, label] of FIELDS) {
    const wrapper = document.createElement("div");
    wrapper.className = "field";

    const row = document.createElement("div");
    row.className = "row";

    const labelEl = document.createElement("label");
    labelEl.textContent = label;
    labelEl.htmlFor = `b-${key}`;

    const source = document.createElement("span");
    const from = sources[key];
    source.className = from ? "src" : "src empty";
    source.textContent = from ? `from ${from}` : "not found";

    row.append(labelEl, source);

    const input = document.createElement("input");
    input.id = `b-${key}`;
    input.name = key;
    input.value = fields[key] || "";
    input.addEventListener("input", () => {
      refreshSaveState();
      if (key === "title") refreshPriorNotice();
    });

    wrapper.append(row, input);
    form.append(wrapper);
  }
}

function currentFields() {
  const out = {};
  for (const [key] of FIELDS) out[key] = form.elements[key]?.value.trim() ?? "";
  return out;
}

function refreshSaveState() {
  saveButton.disabled = !currentFields().title;
}

/** The cover, shown rather than described — the wrong picture is obvious at a
 *  glance and invisible as a URL. One that won't load is dropped silently,
 *  since a broken preview is worse than none. */
function showCover(url, source) {
  coverUrl = url || null;
  if (!coverUrl) {
    coverBlock.hidden = true;
    return;
  }
  coverImg.onerror = () => {
    coverUrl = null;
    coverBlock.hidden = true;
  };
  coverImg.src = coverUrl;
  coverSrc.textContent = source ? `from ${source}` : "";
  coverBlock.hidden = false;
}

coverClear.addEventListener("click", () => showCover(null));

function refreshPriorNotice() {
  const message = describePriorClip(
    findPriorClip(clipHistory, { url: scraped?.sourceUrl, name: currentFields().title })
  );
  prior.textContent = message ?? "";
  prior.hidden = !message;
}

/**
 * Downloads the cover beside the record and reports the name it actually
 * landed under — Chrome uniquifies a colliding filename, so a record naming
 * the file it asked for can end up pointing at nothing.
 *
 * A cover that won't save is not worth losing the book over: the app draws a
 * typographic cover when there's no picture.
 */
async function saveCover(fields) {
  if (!coverUrl) return null;
  try {
    const wanted = coverFileName(fields, coverUrl);
    const id = await chrome.downloads.download({
      url: coverUrl,
      filename: `${INBOX_SUBFOLDER}/${wanted}`,
      conflictAction: "uniquify",
      saveAs: false,
    });
    for (let attempt = 0; attempt < 15; attempt++) {
      const [item] = await chrome.downloads.search({ id });
      if (item?.state === "interrupted") return null;
      if (item?.state === "complete" && item.filename) {
        return item.filename.split(/[\\/]/).pop() || null;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    // Still downloading: a large image is fine, and the importer skips a
    // cover whose file isn't there when it runs.
    return wanted;
  } catch {
    return null;
  }
}

async function save() {
  const fields = currentFields();
  saveButton.disabled = true;
  setStatus("Saving…");
  try {
    // The picture goes first: the record must name a file that exists, and
    // only the finished download knows what that is.
    const savedCover = await saveCover(fields);
    const record = buildBookRecord(fields, {
      coverFile: savedCover || "",
      sourceUrl: scraped?.sourceUrl || "",
    });
    // A data: URL rather than a blob: URL — the popup can be dismissed the
    // instant the download starts, which would revoke a blob out from under it.
    const url = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(record, null, 2))}`;
    await chrome.downloads.download({
      url,
      filename: `${INBOX_SUBFOLDER}/${bookFileName(fields)}`,
      conflictAction: "uniquify",
      saveAs: false,
    });
    clipHistory = recordClip(clipHistory, {
      url: scraped?.sourceUrl,
      name: record.title,
      savedAt: new Date().toISOString(),
    });
    await saveClipHistory(clipHistory);
    refreshPriorNotice();
    const coverNote = coverUrl && !savedCover ? " (cover couldn't be saved)" : "";
    setStatus(`Saved ${record.title} to ${INBOX_SUBFOLDER}/${coverNote}`, coverNote ? "" : "ok");
  } catch (err) {
    setStatus(err?.message || "Couldn't save that book.", "err");
    saveButton.disabled = false;
  }
}

saveButton.addEventListener("click", save);

/** Runs the scrape once and fills the pane. Safe to call again — switching
 *  back and forth between modes shouldn't re-read the page. */
export async function startBookMode(scrapeBookPage) {
  pane.hidden = false;
  if (started) return;
  started = true;
  try {
    clipHistory = await loadClipHistory();
    scraped = await scrapeBookPage();
    // The page's raw strings become a book here — see book.js for why the
    // cleanup is deliberately conservative.
    render(
      {
        title: tidyTitle(scraped.fields.title),
        author: tidyAuthor(scraped.fields.author),
        isbn: normalizeIsbn(scraped.fields.isbn),
      },
      scraped.sources
    );
    showCover(scraped.fields.coverUrl, scraped.sources.coverUrl);
    refreshSaveState();
    refreshPriorNotice();
    if (!currentFields().title) setStatus("No title found — type one to save.", "err");
    else if (!scraped.looksLikeBook) setStatus("This page didn't say it was a book — worth a check.", "");
  } catch (err) {
    setStatus(err?.message || "Something went wrong.", "err");
  }
}

export function hideBookMode() {
  pane.hidden = true;
}
