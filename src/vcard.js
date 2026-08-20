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
//   * Credentials ride in X-CREDENTIALS, and FN carries the bare name. They
//     used to be pasted onto FN because the app had no credentials field;
//     it does now, so pasting them on would mean the app splitting apart a
//     string this file had just joined. They are ALSO written into N's suffix
//     component, which is where the vCard spec puts post-nominals, so a card
//     opened in an ordinary address book still shows them.
//
//     Note the version coupling this creates: a Practice Studio build older
//     than the credentials field ignores X-CREDENTIALS, so a card written here
//     lands there with the letters missing. Nothing is corrupted and re-saving
//     from the clipper fixes it — but update the two together.
//
//     The filename still uses the combined form (see vcardFileName): two
//     colleagues can share a name, and the letters are what tell the files
//     apart on disk.

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

// NOTE carries only what has nowhere else to go. A "clipped from <url> on
// <date>" line used to ride along here too, but provenance every contact
// keeps forever is clutter in the record, and the URL is already on the
// contact as its website.
function noteLines(fields) {
  const lines = [];
  const address = (fields.address || "").trim();
  // Location has no field of its own on a Contact, so unlike specialization
  // and tags it genuinely needs the note to survive at all.
  if (address) lines.push(`Location: ${address}`);
  return lines;
}

/**
 * Serializes scraped fields to vCard 3.0 text.
 *
 * `uid` is injectable so tests are deterministic; in the popup it's a real
 * crypto.randomUUID(). Writing a UID at all matters because the app mints a
 * fresh random one on every folder scan for cards that lack it.
 */
export function buildVCard(fields, { uid, photoFileName = "" } = {}) {
  const name = (fields.fullName || "").trim();
  if (!name) throw new Error("A contact needs a name.");
  const credentials = (fields.credentials || "").trim();

  const lines = ["BEGIN:VCARD", "VERSION:3.0"];
  lines.push(`UID:${escapeText(uid || crypto.randomUUID())}`);
  lines.push(`FN:${escapeText(name)}`);
  // N is Family;Given;Additional;Prefix;Suffix. The whole name has always gone
  // in the first component rather than being split into parts this scraper
  // cannot reliably tell apart; the suffix, though, we do know.
  lines.push(`N:${escapeText(name)};;;;${escapeText(credentials)}`); // write-only, for stricter importers

  const push = (property, value) => {
    const trimmed = (value || "").trim();
    if (trimmed) lines.push(`${property}:${escapeText(trimmed)}`);
  };

  push("X-CREDENTIALS", fields.credentials);
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

  const notes = noteLines(fields);
  if (notes.length) lines.push(`NOTE:${escapeText(notes.join("\n"))}`);

  // CATEGORIES is the standard vCard property for tags, so a card exported
  // from anywhere else carries them here too. Each value is escaped
  // individually and joined with plain commas — the commas are the
  // separator, so escaping them away would collapse the list into one tag.
  const tags = String(fields.tags || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (tags.length > 0) lines.push(`CATEGORIES:${tags.map(escapeText).join(",")}`);

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
