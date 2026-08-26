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
/**
 * Tidies a scraped phone number into one house format: `(555) 010-2288`.
 *
 * What arrives is rarely clean. A `tel:` href gives bare digits
 * (`tel:+15550102288`); page text gives whatever the site's designer typed —
 * `555.010.2288`, `(555)010-2288`, non-breaking spaces, an en dash, a
 * "Call:" prefix, or two numbers run together when a footer lists office and
 * mobile side by side.
 *
 * NEVER INVENTS ONE. A phone number in a referral directory gets dialled, so
 * anything this can't confidently read as a 10-digit North American number is
 * returned with its whitespace collapsed and nothing else touched — visibly
 * odd, which is the right outcome, rather than confidently wrong. That means
 * international numbers pass through as written instead of being mangled into
 * a shape they don't have.
 *
 * An extension is kept and normalised to `ext.`, since losing one silently
 * means calling a main line that doesn't reach the person.
 */
export function normalizePhone(raw) {
  const text = String(raw ?? "").replace(/[\u00a0\u2007\u202f]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return "";

  const ext = text.match(/(?:\b(?:ext|ext\.|x|extension)\s*)(\d{1,6})\s*$/i);
  const body = ext ? text.slice(0, ext.index) : text;
  const suffix = ext ? ` ext. ${ext[1]}` : "";

  // A country code that isn't North America's, said explicitly. Cheaper to
  // read than to infer from the digit count, and it catches the short ones.
  if (/^\+(?!1\b)/.test(body.trim()) && !/^\+1[\s.\-(]/.test(body.trim()) && !/^\+1\d{10}$/.test(body.replace(/[^\d+]/g, ""))) {
    return text;
  }

  let digits = (body.match(/\d/g) || []).join("");
  // A leading country code for North America, however it was written.
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);

  // Two numbers jammed together — an office and a mobile with nothing between
  // them in a footer. The first is the one the page led with, and it is the
  // only one this field can hold.
  //
  // Both halves have to look like real numbers before this splits anything.
  // Taking the first ten digits of any long run is how "+44 20 7946 0018"
  // becomes "(442) 079-4600" — a number that dials someone, invented out of a
  // number that didn't. My own test caught that; the check below is what
  // stops it, because an international number leaves a remainder that is not
  // itself a plausible North American number.
  if (digits.length > 11) {
    const lead = digits.startsWith("1") ? digits.slice(1, 11) : digits.slice(0, 10);
    let rest = digits.slice(digits.startsWith("1") ? 11 : 10);
    if (rest.length === 11 && rest.startsWith("1")) rest = rest.slice(1);
    const bothPlausible = /^[2-9]\d{9}$/.test(lead) && /^[2-9]\d{9}$/.test(rest);
    return bothPlausible ? format(lead) + suffix : text;
  }

  if (digits.length !== 10) return text;
  // A North American area code never starts with 0 or 1. A 10-digit run that
  // does is something else — a date, an id — and not ours to reformat.
  if (!/^[2-9]/.test(digits)) return text;
  return format(digits) + suffix;
}

function format(d) {
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

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
