// vCard 3.0 writer, shaped for Practice Studio's reader
// (practice-studio-desktop/client/src/lib/vcard.ts).
//
// Two deliberate choices about how much this file trusts the app:
//
//   * Specialization rides in X-SPECIALIZATION alone. It was duplicated into
//     NOTE while parseVCardRows still hardcoded specialization to "" — correct
//     for an address-book export, which has no such notion, but it dropped
//     ours. The app reads the property directly as of the contact-inbox work,
//     so the NOTE copy would now just restate a field the contact already has.
//
//   * Credentials stay appended to FN rather than riding in a custom property.
//     The app has no credentials field, and its name matcher already strips
//     post-nominals, so "Rowan Aldridge, LCSW" still matches an existing
//     "Rowan Aldridge" instead of creating a duplicate.

const LINE_LENGTH = 75;

/** Escapes the characters that are structural in a vCard text value. The app's
 *  parser unescapes exactly these, so a comma in an org name round-trips. */
export function escapeText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\r?\n/g, "\\n");
}

/** Folds an over-long line into CRLF + single-space continuations, matching
 *  the app's unfoldLines, which strips one leading space per continuation. */
export function foldLine(line) {
  if (line.length <= LINE_LENGTH) return line;
  const chunks = [];
  let rest = line;
  while (rest.length > LINE_LENGTH) {
    chunks.push(rest.slice(0, LINE_LENGTH));
    rest = rest.slice(LINE_LENGTH);
  }
  chunks.push(rest);
  return chunks.join("\r\n ");
}

export function slugify(value, fallback = "contact") {
  const slug = String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

/** "Rowan Aldridge" + "LCSW" -> "Rowan Aldridge, LCSW" */
export function displayName(fields) {
  const name = (fields.fullName || "").trim();
  const credentials = (fields.credentials || "").trim();
  if (!name) return "";
  return credentials ? `${name}, ${credentials}` : name;
}

function noteLines(fields, sourceUrl, scrapedAt) {
  const lines = [];
  const address = (fields.address || "").trim();
  // Address has no field of its own on a Contact, so unlike specialization it
  // genuinely needs the note to survive at all.
  if (address) lines.push(`Address: ${address}`);
  if (sourceUrl) {
    const day = scrapedAt ? String(scrapedAt).slice(0, 10) : "";
    lines.push(day ? `Clipped from ${sourceUrl} on ${day}` : `Clipped from ${sourceUrl}`);
  }
  return lines;
}

/**
 * Serializes scraped fields to vCard 3.0 text.
 *
 * `uid` is injectable so tests are deterministic; in the popup it's a real
 * crypto.randomUUID(). Writing a UID at all matters because the app mints a
 * fresh random one on every folder scan for cards that lack it.
 */
export function buildVCard(fields, { uid, sourceUrl = "", scrapedAt = "", photoFileName = "" } = {}) {
  const name = displayName(fields);
  if (!name) throw new Error("A contact needs a name.");

  const lines = ["BEGIN:VCARD", "VERSION:3.0"];
  lines.push(`UID:${escapeText(uid || crypto.randomUUID())}`);
  lines.push(`FN:${escapeText(name)}`);
  lines.push(`N:${escapeText(name)};;;;`); // write-only, for stricter importers

  const push = (property, value) => {
    const trimmed = (value || "").trim();
    if (trimmed) lines.push(`${property}:${escapeText(trimmed)}`);
  };

  push("ORG", fields.organization);
  push("TEL;TYPE=WORK", fields.phone);
  push("EMAIL;TYPE=INTERNET", fields.email);
  // URL is not escaped: it's a URI value, and escaping its commas would
  // corrupt the link rather than protect it.
  if ((fields.website || "").trim()) lines.push(`URL:${fields.website.trim()}`);

  // A bare sibling filename, not a URI — the app resolves it against the
  // folder the card was read from, and rejects anything with a path
  // separator or scheme in it. Written only once the image is actually on
  // disk, so a card never points at a headshot that isn't there.
  if (photoFileName.trim()) lines.push(`PHOTO;VALUE=uri:${photoFileName.trim()}`);

  const notes = noteLines(fields, sourceUrl, scrapedAt);
  if (notes.length) lines.push(`NOTE:${escapeText(notes.join("\n"))}`);

  // Every card this extension writes is a mental health provider.
  lines.push("X-CONTACT-TYPE:therapist");
  push("X-SPECIALIZATION", fields.specialization);

  lines.push("END:VCARD");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** Filename for the inbox drop, e.g. "rowan-aldridge-lcsw.vcf". */
export function vcardFileName(fields) {
  return `${slugify(displayName(fields))}.vcf`;
}

const EXTENSION_BY_TYPE = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
};

/** Content type first, then the URL's own extension, then a plain guess —
 *  the app only accepts a known image extension, so there has to be one. */
export function photoExtension(url, contentType = "") {
  const byType = EXTENSION_BY_TYPE[String(contentType).split(";")[0].trim().toLowerCase()];
  if (byType) return byType;
  // A relative URL can't be parsed without a base, so fall back to trimming
  // the query and fragment off by hand rather than giving up on the path.
  let path;
  try {
    path = new URL(url).pathname;
  } catch {
    path = String(url ?? "").split(/[?#]/)[0];
  }
  const match = path.match(/\.(jpe?g|png|webp|gif|avif)$/i);
  if (match) return `.${match[1].toLowerCase()}`.replace(".jpeg", ".jpg");
  return ".jpg";
}

/** Headshot filename, matching the card's stem so the pair reads as a pair. */
export function photoFileName(fields, url, contentType = "") {
  return `${slugify(displayName(fields))}${photoExtension(url, contentType)}`;
}
