// Popup: scrape the active tab, let Carl correct anything, write the .vcf.
//
// The scrape runs from here rather than from a background service worker for
// two reasons: activeTab's permission is granted by the toolbar click that
// opened this popup, and blob/data URL creation for the download needs a
// document context, which a MV3 service worker doesn't have.
import { buildVCard, displayName, vcardFileName } from "./vcard.js";
import { normalizeWithLocalModel } from "./llm.js";
import {
  describePriorClip,
  findPriorClip,
  loadClipHistory,
  recordClip,
  saveClipHistory,
} from "./history.js";

const INBOX_SUBFOLDER = "ps-contact-inbox";
const USE_MODEL_KEY = "useLocalModel";

const FIELDS = [
  ["fullName", "Full name"],
  ["credentials", "Credentials"],
  ["organization", "Practice / organization"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["website", "Website"],
  ["specialization", "Specialization"],
  ["address", "Address"],
];

const form = document.getElementById("form");
const saveButton = document.getElementById("save");
const status = document.getElementById("status");
const pageUrl = document.getElementById("page-url");
const useModel = document.getElementById("use-model");
const prior = document.getElementById("prior");

let scraped = null;
let clipHistory = [];

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
    labelEl.htmlFor = `f-${key}`;

    const source = document.createElement("span");
    const from = sources[key];
    source.className = from ? "src" : "src empty";
    source.textContent = from ? `from ${from}` : "not found";

    row.append(labelEl, source);

    const input = document.createElement("input");
    input.id = `f-${key}`;
    input.name = key;
    input.value = fields[key] || "";
    input.addEventListener("input", () => {
      refreshSaveState();
      // Correcting the name can reveal a prior clip of the same person under
      // a different URL, so the notice is re-checked as it's typed.
      if (key === "fullName") refreshPriorNotice();
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
  saveButton.disabled = !currentFields().fullName;
}

/** Shows whether this page — or this person — has been clipped before. Purely
 *  informational: re-clipping updates rather than duplicates on import. */
function refreshPriorNotice() {
  const message = describePriorClip(
    findPriorClip(clipHistory, { url: scraped?.sourceUrl, name: currentFields().fullName })
  );
  prior.textContent = message ?? "";
  prior.hidden = !message;
}

async function scrapeActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab.");
  if (/^(chrome|vivaldi|edge|about|chrome-extension):/i.test(tab.url || "")) {
    throw new Error("This page can't be clipped — open the therapist's site first.");
  }
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["src/scrape.js"],
  });
  if (!injection?.result) throw new Error("Couldn't read that page.");
  return injection.result;
}

async function save() {
  const fields = currentFields();
  saveButton.disabled = true;
  setStatus("Saving…");
  try {
    const text = buildVCard(fields, {
      uid: crypto.randomUUID(),
      sourceUrl: scraped.sourceUrl,
      scrapedAt: scraped.scrapedAt,
    });
    // A data: URL rather than a blob: URL — the popup can be dismissed the
    // instant the download starts, which would revoke a blob out from under it.
    const url = `data:text/vcard;charset=utf-8,${encodeURIComponent(text)}`;
    await chrome.downloads.download({
      url,
      filename: `${INBOX_SUBFOLDER}/${vcardFileName(fields)}`,
      conflictAction: "uniquify",
      saveAs: false,
    });
    clipHistory = recordClip(clipHistory, {
      url: scraped.sourceUrl,
      name: fields.fullName,
      savedAt: new Date().toISOString(),
    });
    await saveClipHistory(clipHistory);
    refreshPriorNotice();
    setStatus(`Saved ${displayName(fields)} to ${INBOX_SUBFOLDER}/`, "ok");
  } catch (err) {
    setStatus(err?.message || "Couldn't save that card.", "err");
    saveButton.disabled = false;
  }
}

saveButton.addEventListener("click", save);

/**
 * Asks the local model to fill whatever the page didn't yield. Deterministic
 * values are never revisited — the normalizer only sees blank fields — and
 * anything it supplies is relabelled so it's obvious which values came from a
 * model rather than off the page.
 */
async function runLocalModel() {
  const before = currentFields();
  setStatus("Asking the local model…");

  const result = await normalizeWithLocalModel(before, scraped.pageText);

  if (result.skipped) {
    setStatus("Nothing left for the model to fill.");
    return;
  }
  if (result.error) {
    setStatus(result.error, "err");
    return;
  }

  const filledKeys = Object.keys(result.filled);
  if (filledKeys.length === 0) {
    const note = result.rejected.length > 0 ? " (some answers weren't on the page)" : "";
    setStatus(`The model found nothing to add${note}.`);
    return;
  }

  const fields = { ...before, ...result.filled };
  const sources = { ...scraped.sources };
  for (const key of filledKeys) sources[key] = "local model";
  render(fields, sources);
  refreshSaveState();
  // The model can supply the name itself, which may match an earlier clip.
  refreshPriorNotice();

  const dropped = result.rejected.length > 0 ? `, ${result.rejected.length} dropped as unverifiable` : "";
  setStatus(`Filled ${filledKeys.join(", ")}${dropped}. Worth a check.`, "ok");
}

async function loadUseModelPreference() {
  try {
    const stored = await chrome.storage.local.get(USE_MODEL_KEY);
    return stored?.[USE_MODEL_KEY] === true;
  } catch {
    return false;
  }
}

useModel.addEventListener("change", async () => {
  chrome.storage.local.set({ [USE_MODEL_KEY]: useModel.checked });
  if (useModel.checked && scraped) await runLocalModel();
});

(async () => {
  try {
    useModel.checked = await loadUseModelPreference();
    clipHistory = await loadClipHistory();
    scraped = await scrapeActiveTab();
    pageUrl.textContent = scraped.sourceUrl;
    render(scraped.fields, scraped.sources);
    refreshSaveState();
    refreshPriorNotice();
    if (!scraped.fields.fullName) setStatus("No name found — type one to save.", "err");
    if (useModel.checked) await runLocalModel();
  } catch (err) {
    pageUrl.textContent = "";
    setStatus(err?.message || "Something went wrong.", "err");
  }
})();
