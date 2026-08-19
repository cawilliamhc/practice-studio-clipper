// Turning a scraped book page into the record Practice Studio's library
// imports.
//
// Everything here is pure and Node-testable. The DOM half lives in
// scrape-book.js, which must stay a self-contained IIFE (executeScript hands
// back a completion value and knows nothing about this module) — so the
// split is: that file finds strings on the page, this file decides what they
// mean.

/** The one shape the app agrees to read. Bumped only if the meaning of an
 *  existing field changes; adding an optional field doesn't need it. */
export const RECORD_KIND = "practice-studio/library-book";
export const RECORD_VERSION = 1;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// Retailer titles carry the edition and format after a dash: "Anchors and
// Sails: A Field Guide – Paperback, January 3 2021". The format clause is
// about a copy for sale, not about the book, and it makes two clips of the
// same title look like two books.
const FORMAT_CLAUSE =
  /\s*[–—-]\s*(?:paperback|hardcover|hardback|kindle edition|audiobook|audio cd|mass market paperback|board book|library binding|spiral-bound|illustrated|abridged|unabridged|large print)\b.*$/i;

// A trailing site name: "The Quiet Hour | Bookshop.org", "… - Goodreads".
const SITE_TAGLINE = /\s*[|·—–-]\s*(?:bookshop(?:\.org)?|goodreads|amazon(?:\.[a-z.]+)?|barnes\s*&\s*noble|waterstones|google books|apple books|abebooks|thriftbooks)\s*$/i;

/**
 * The book's title, with the shopfront filed off.
 *
 * Conservative on purpose: subtitles are kept (they're part of the title and
 * often the only thing distinguishing two similar books), and only clauses
 * that are unambiguously about a listing rather than a work are removed.
 */
export function tidyTitle(raw) {
  let value = clean(raw);
  value = value.replace(SITE_TAGLINE, "");
  value = value.replace(FORMAT_CLAUSE, "");
  // "(Paperback)" / "[Hardcover]" as a trailing parenthetical.
  value = value.replace(/\s*[([](?:paperback|hardcover|hardback|kindle|audiobook|ebook)[\])]\s*$/i, "");
  return clean(value);
}

// Retailer bylines: "by R. Vantree (Author)", "R. Vantree (Author, Editor)",
// "Visit Amazon's R. Vantree Page".
const BYLINE_NOISE = [
  /^by\s+/i,
  /\s*\((?:author|editor|translator|illustrator|foreword|contributor)[^)]*\)\s*/gi,
  /\s*\(.*?\bpage\b.*?\)\s*/gi,
  /^visit\s+\S+\s+/i,
];

/**
 * One author name.
 *
 * A book with several authors keeps only the first — the app stores a single
 * author line, and "R. Vantree, L. Strand, and eleven others" in a field
 * meant for a name helps nobody. The full byline is still on the page if it
 * matters.
 */
export function tidyAuthor(raw) {
  let value = clean(raw);
  for (const pattern of BYLINE_NOISE) value = value.replace(pattern, " ");
  value = clean(value);
  // Split on separators that mean "and another author", not on a comma —
  // "Vantree, R." is one person written surname-first.
  const [first] = value.split(/\s*(?:;|\band\b|&|\|)\s*/i);
  return clean(first).replace(/[,;]+$/, "");
}

/**
 * An ISBN reduced to comparable digits, or "" if it isn't one.
 *
 * Validated rather than merely cleaned: this is the dedupe key on import, and
 * a mangled number matches nothing while quietly looking authoritative. Both
 * lengths are accepted and neither is converted to the other — the app treats
 * it as an identifier to compare, not to compute with.
 */
export function normalizeIsbn(raw) {
  const value = clean(raw).replace(/^isbn(?:-1[03])?:?\s*/i, "").replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{13}$/.test(value)) return value;
  if (/^\d{9}[\dX]$/.test(value)) return value;
  return "";
}

export function slugify(value, fallback = "book") {
  const slug = String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || fallback;
}

/** The filename a clipped book is written under. Chrome uniquifies a
 *  collision, and the app's importer matches on ISBN or title rather than on
 *  filename, so a repeat clip updates rather than duplicating. */
export function bookFileName(fields) {
  return `${slugify(fields.title)}.book.json`;
}

const COVER_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "avif"];

/**
 * What to call the downloaded cover. The extension comes from the image URL
 * when it has a recognisable one and falls back to .jpg, which is what most
 * retailer covers are; the app validates the extension again on the way in,
 * so a wrong guess costs a picture, not a bad file in the tree.
 */
export function coverFileName(fields, imageUrl) {
  let ext = "jpg";
  try {
    const path = new URL(imageUrl, "https://example.invalid").pathname.toLowerCase();
    const found = path.slice(path.lastIndexOf(".") + 1);
    if (COVER_EXTENSIONS.includes(found)) ext = found === "jpeg" ? "jpg" : found;
  } catch {
    // Not a parseable URL — the fallback extension stands.
  }
  return `${slugify(fields.title)}.${ext}`;
}

/**
 * The record written to the inbox.
 *
 * Deliberately small. A book is a title, who wrote it, a number that
 * identifies the edition, and a picture — nothing about this record should
 * ever describe a person, because the extension has no business knowing who
 * a book is for. That's the boundary the file-drop inbox exists to keep.
 */
export function buildBookRecord(fields, { coverFile = "", sourceUrl = "", clippedAt } = {}) {
  const title = tidyTitle(fields.title);
  if (!title) throw new Error("A book needs a title.");
  const author = tidyAuthor(fields.author);
  const isbn = normalizeIsbn(fields.isbn);
  return {
    kind: RECORD_KIND,
    version: RECORD_VERSION,
    title,
    ...(author ? { author } : {}),
    ...(isbn ? { isbn } : {}),
    ...(coverFile ? { cover_file: coverFile } : {}),
    ...(sourceUrl ? { source_url: sourceUrl } : {}),
    clipped_at: clippedAt ?? new Date().toISOString(),
  };
}
