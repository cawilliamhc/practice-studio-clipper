// vCard 3.0 writer, shaped for Practice Studio's reader
// (practice-studio-desktop/client/src/lib/vcard.ts).
//
// Two deliberate choices about how much this file trusts the app:
//
//   * X-SPECIALIZATION is written, but the specialization ALSO goes into NOTE.
//     The app's inbox path runs cards through parseVCardRows, which hardcodes
//     specialization to "" — correct for an address-book export, which has no
//     such notion, but it would silently drop ours. NOTE survives that path
//     today; the X- property is there for when the app learns to read it.
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
  const specialization = (fields.specialization || "").trim();
  const address = (fields.address || "").trim();
  if (specialization) lines.push(`Specialization: ${specialization}`);
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
export function buildVCard(fields, { uid, sourceUrl = "", scrapedAt = "" } = {}) {
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
