// Remembers what's already been clipped, so revisiting a therapist's site a
// month later says so instead of quietly producing a second card.
//
// Re-clipping is harmless — the inbox uniquifies the filename and Practice
// Studio matches on name and fills only blank fields, so a repeat import
// updates rather than duplicates. This is about not wasting the trip, not
// about preventing damage.
//
// Two ways a repeat is recognized. The URL catches the ordinary case. The
// name catches the more interesting one: the same person clipped from their
// own site and later from a directory profile, where the URLs share nothing.

const MAX_CLIPS = 500;
const STORAGE_KEY = "clipHistory";

/** Collapses a name for comparison — case, punctuation, and spacing stop
 *  mattering, so "Okonjo, Mira" and "mira okonjo" are not both stored. */
export function nameKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Reduces a URL to the thing worth comparing: scheme and `www.` don't
 * distinguish two visits to the same page, a fragment never does, and
 * campaign parameters actively lie — the same profile shared from a
 * newsletter and from search would otherwise look like two different pages.
 */
export function normalizeUrl(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    url.hash = "";
    url.protocol = "https:";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || /^(fbclid|gclid|mc_cid|mc_eid|igshid)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString().replace(/\/$/, "");
  } catch {
    return text.toLowerCase();
  }
}

/**
 * Finds an earlier clip of this page or this person.
 *
 * URL wins over name: it's the stronger signal, and saying "you clipped this
 * page" is more useful than "you clipped someone with this name" when both
 * are true.
 */
export function findPriorClip(clips, { url, name }) {
  const list = Array.isArray(clips) ? clips : [];
  const targetUrl = normalizeUrl(url);
  if (targetUrl) {
    const byUrl = list.find((clip) => clip?.url === targetUrl);
    if (byUrl) return { clip: byUrl, matchedOn: "url" };
  }
  const targetName = nameKey(name);
  if (targetName) {
    const byName = list.find((clip) => clip?.nameKey === targetName);
    if (byName) return { clip: byName, matchedOn: "name" };
  }
  return null;
}

/**
 * Returns the history with this clip recorded, newest first.
 *
 * Re-clipping the same URL replaces the old entry rather than stacking up.
 * The same person from a *different* URL is kept as its own entry — that's
 * two real pages, and losing one would make the next visit to it look new.
 */
export function recordClip(clips, { url, name, savedAt }) {
  const list = Array.isArray(clips) ? clips.filter((c) => c && typeof c === "object") : [];
  const entry = {
    url: normalizeUrl(url),
    nameKey: nameKey(name),
    name: String(name ?? "").trim(),
    savedAt: savedAt || new Date().toISOString(),
  };
  return [entry, ...list.filter((clip) => clip.url !== entry.url)].slice(0, MAX_CLIPS);
}

/** "today" / "yesterday" / "6 days ago" / "3 Aug 2026" — vague on purpose;
 *  the point is roughly how stale it is, not the timestamp. */
export function describeWhen(savedAt, now = new Date()) {
  const then = new Date(savedAt);
  if (Number.isNaN(then.getTime())) return "earlier";
  const days = Math.floor((now - then) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** The sentence the popup shows. Null when there's nothing to say. */
export function describePriorClip(prior, now = new Date()) {
  if (!prior?.clip) return null;
  const when = describeWhen(prior.clip.savedAt, now);
  if (prior.matchedOn === "url") return `You clipped this page ${when}.`;
  const who = prior.clip.name || "this person";
  return `You clipped ${who} ${when}, from another page.`;
}

export async function loadClipHistory() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const clips = stored?.[STORAGE_KEY];
    return Array.isArray(clips) ? clips : [];
  } catch {
    return [];
  }
}

export async function saveClipHistory(clips) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: clips });
  } catch {
    // History is a convenience; failing to persist it must never fail a save.
  }
}
