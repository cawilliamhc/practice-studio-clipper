// Injected into the active tab by the popup via chrome.scripting.executeScript.
//
// This must stay a self-contained IIFE with no imports: executeScript hands
// back the script's completion value, and nothing from the extension's own
// modules exists in the page's world.
//
// Extraction runs in tiers, most trustworthy first, and every field records
// which tier produced it so the popup can show where a value came from. The
// tiers matter because they're also the honesty boundary for the LLM step
// added later: phone and email are only ever taken from structured data or a
// real tel:/mailto: link, never inferred from prose.
(() => {
  const MAX_PAGE_TEXT = 5000;

  const clean = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

  // ---- names and credentials ----------------------------------------------

  // Post-nominals common on US therapist sites. Matched against a token with
  // its dots stripped, so "Ph.D." and "PhD" both land here.
  const CREDENTIAL =
    /^(?:phd|psyd|edd|md|do|lcsw|licsw|lisw|lmsw|msw|lcsww|lmft|amft|lpc|lpcc|lcpc|lmhc|lpca|lcat|atr|atrbc|ncc|bcba|rn|np|pmhnp|pmhnpbc|ma|ms|med|mft|casac|cadc|sep|cst|ryt)$/i;

  const TAGLINE_SPLIT = /\s+[—–|·]\s+|\s+\|\s+/;

  /** Splits "Rowan Aldridge, LCSW" into name + credentials. Anything after the
   *  first comma has to look entirely like post-nominals, otherwise the string
   *  is left alone — "Aldridge, Rowan" is a name, not a credential. */
  function splitCredentials(raw) {
    const whole = clean(raw);
    const parts = whole.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) return { name: whole, credentials: "" };
    const creds = [];
    for (const part of parts.slice(1)) {
      const tokens = part.split(/[\s/]+/).filter(Boolean);
      if (!tokens.every((t) => CREDENTIAL.test(t.replace(/\./g, "")))) {
        return { name: whole, credentials: "" };
      }
      creds.push(part);
    }
    return { name: parts[0], credentials: creds.join(", ") };
  }

  /** Drops a trailing tagline from a title-ish string: a page <title> is very
   *  often "Rowan Aldridge, LCSW | Trauma Therapy in Austin". */
  function stripTagline(raw) {
    const whole = clean(raw);
    const [first] = whole.split(TAGLINE_SPLIT);
    return clean(first) || whole;
  }

  // ---- tier 1: JSON-LD ----------------------------------------------------

  const PERSON_TYPES = new Set(["person"]);
  const ORG_TYPES = new Set([
    "localbusiness", "medicalbusiness", "psychologist", "physician",
    "professionalservice", "medicalclinic", "organization",
    "healthandbeautybusiness", "medicalorganization",
  ]);

  function collectNodes(value, out) {
    if (Array.isArray(value)) {
      for (const item of value) collectNodes(item, out);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (value["@type"]) out.push(value);
    for (const nested of Object.values(value)) {
      if (nested && typeof nested === "object") collectNodes(nested, out);
    }
  }

  function jsonLdNodes() {
    const out = [];
    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      let parsed;
      try {
        parsed = JSON.parse(el.textContent || "");
      } catch {
        continue; // one malformed block must not lose the rest of the page
      }
      collectNodes(parsed, out);
    }
    return out;
  }

  const typesOf = (node) =>
    []
      .concat(node["@type"] || [])
      .map((t) => String(t).toLowerCase().replace(/^https?:\/\/schema\.org\//, ""));

  function formatAddress(addr) {
    if (!addr) return "";
    if (typeof addr === "string") return clean(addr);
    const line = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode]
      .map(clean)
      .filter(Boolean);
    return line.join(", ");
  }

  function firstString(value) {
    if (typeof value === "string") return clean(value);
    if (Array.isArray(value)) return clean(value.map(firstString).filter(Boolean)[0] || "");
    if (value && typeof value === "object") return clean(value.name || "");
    return "";
  }

  /** schema.org `image` is a string, an ImageObject, or an array of either. */
  function imageUrl(value) {
    if (!value) return "";
    if (typeof value === "string") return clean(value);
    if (Array.isArray(value)) return imageUrl(value.find(Boolean));
    if (typeof value === "object") return clean(value.url || value.contentUrl || "");
    return "";
  }

  function listOf(value) {
    if (!value) return [];
    const items = Array.isArray(value) ? value : [value];
    return items.map(firstString).filter(Boolean);
  }

  function fromJsonLd() {
    const nodes = jsonLdNodes();
    const person = nodes.find((n) => typesOf(n).some((t) => PERSON_TYPES.has(t)));
    const org = nodes.find((n) => typesOf(n).some((t) => ORG_TYPES.has(t)));
    const primary = person || org;
    if (!primary) return {};

    const orgName = person
      ? firstString(person.worksFor || person.affiliation) || firstString(org && org.name)
      : firstString(org && org.name);

    const specialization = [
      ...listOf(primary.knowsAbout),
      ...(person ? listOf(person.jobTitle) : []),
      ...listOf(primary.medicalSpecialty),
    ];

    return {
      fullName: firstString(primary.name),
      organization: orgName,
      phone: firstString(primary.telephone),
      email: firstString(primary.email).replace(/^mailto:/i, ""),
      website: firstString(primary.url),
      specialization: [...new Set(specialization)].join(", "),
      address: formatAddress(primary.address),
      // Only ever a Person's own image. An organization's `image` is very
      // often the practice logo, which is not a headshot.
      photoUrl: person ? imageUrl(person.image) : "",
    };
  }

  // ---- tier 2: meta tags --------------------------------------------------

  const meta = (selector) => clean(document.querySelector(selector)?.content || "");

  // Page-title chunks that name a section rather than a practice.
  const GENERIC_TITLE =
    /^(?:about(?: us| me)?|home|contact(?: us)?|services|team|our team|welcome|therapy|counseling|counselling|blog|faq|resources)$/i;

  const compareKey = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");

  function fromMeta() {
    return {
      fullName: stripTagline(meta('meta[property="og:title"]') || document.title),
      organization: meta('meta[property="og:site_name"]'),
      photoUrl: meta('meta[property="og:image"]'),
    };
  }

  /** A practice name hiding in the <title>, e.g. "About | Northgate Family
   *  Therapy". Chunks are considered in either order, and anything that just
   *  restates the therapist's own name is discarded so the org doesn't end up
   *  duplicating it. */
  function orgFromTitle(name) {
    const nameKey = compareKey(name);
    const candidates = clean(document.title)
      .split(TAGLINE_SPLIT)
      .map(clean)
      .filter(Boolean)
      .filter((chunk) => !GENERIC_TITLE.test(chunk))
      .filter((chunk) => {
        const key = compareKey(chunk);
        return key && key !== nameKey && !key.startsWith(nameKey);
      });
    return candidates.sort((a, b) => b.length - a.length)[0] || "";
  }

  // ---- tier 3: DOM --------------------------------------------------------

  // Platform-issued addresses that appear in page source but belong to the
  // site builder, not the therapist.
  const EMAIL_NOISE = /@(?:wixpress|sentry|squarespace|godaddy|example|wordpress|sentry-cdn)\.[a-z.]+$/i;
  const LOOSE_PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/;

  function hrefValues(scheme) {
    return [...document.querySelectorAll(`a[href^="${scheme}:"]`)]
      .map((a) => {
        const raw = a.getAttribute("href") || "";
        const body = raw.slice(scheme.length + 1).split("?")[0];
        try {
          return clean(decodeURIComponent(body));
        } catch {
          return clean(body);
        }
      })
      .filter(Boolean);
  }

  function fromDom(pageText) {
    const phone = hrefValues("tel").find((v) => (v.match(/\d/g) || []).length >= 10) || "";
    const email = hrefValues("mailto").find((v) => v.includes("@") && !EMAIL_NOISE.test(v)) || "";
    const heading = document.querySelector("h1");
    return {
      fullName: heading ? stripTagline(heading.innerText || heading.textContent || "") : "",
      phone,
      email,
    };
  }

  function phoneFromText(pageText) {
    const match = pageText.match(LOOSE_PHONE);
    return match ? clean(match[0]) : "";
  }

  // ---- headshot -----------------------------------------------------------

  // Words that mark an image as furniture rather than a person.
  const NOT_A_PERSON = /logo|icon|badge|seal|banner|sprite|favicon|placeholder|background|pattern|divider|arrow|button/i;
  // Words that mark one as likely to be the person.
  const LOOKS_LIKE_PORTRAIT = /headshot|portrait|profile|bio|avatar|photo|team|staff|about|therapist|counselor|counsellor|founder|me\b/i;

  /** Lowercased words, punctuation flattened to spaces — for loose token
   *  matching against alt text and class names. */
  const wordsOf = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  const absoluteUrl = (value) => {
    if (!value) return "";
    try {
      const url = new URL(value, document.baseURI);
      return /^https?:$/.test(url.protocol) ? url.toString() : "";
    } catch {
      return "";
    }
  };

  function imageDimensions(img) {
    const width = img.naturalWidth || Number(img.getAttribute("width")) || img.clientWidth || 0;
    const height = img.naturalHeight || Number(img.getAttribute("height")) || img.clientHeight || 0;
    return { width, height };
  }

  /**
   * Scores every image on the page and takes the best, if any clears the bar.
   *
   * The signals are deliberately dull: portraits are reasonably large, close
   * to square or a little taller than wide, described with the person's name
   * or a word like "headshot", and near the top of the page. Nothing here is
   * clever enough to be confidently wrong — a miss leaves the field blank and
   * visible in the popup, which beats attaching a stranger's face to a
   * colleague's record.
   */
  function findHeadshot(personName) {
    const nameTokens = wordsOf(personName).split(" ").filter((t) => t.length > 2);
    let best = null;

    for (const img of document.images) {
      const src = absoluteUrl(img.currentSrc || img.src);
      if (!src) continue;
      const { width, height } = imageDimensions(img);
      if (width < 80 || height < 80) continue; // spacers, icons, tracking pixels

      const describedBy = `${img.alt || ""} ${img.className || ""} ${img.id || ""} ${src}`;
      if (NOT_A_PERSON.test(describedBy)) continue;

      const ratio = width / height;
      if (ratio < 0.5 || ratio > 1.9) continue; // banners and slivers aren't headshots

      let score = 0;
      const described = wordsOf(describedBy);
      if (nameTokens.length > 0 && nameTokens.every((t) => described.includes(t))) score += 5;
      if (LOOKS_LIKE_PORTRAIT.test(describedBy)) score += 3;
      if (ratio >= 0.7 && ratio <= 1.3) score += 2; // square-ish
      if (width >= 200 && height >= 200) score += 1;
      // Earlier in the document is likelier to be the subject of the page.
      const position = [...document.images].indexOf(img);
      if (position <= 2) score += 1;

      if (score > 0 && (!best || score > best.score)) best = { src, score };
    }

    return best ? best.src : "";
  }

  // ---- assembly -----------------------------------------------------------

  /** First non-empty candidate wins; remembers which tier supplied it. */
  function pick(candidates) {
    for (const [source, value] of candidates) {
      const cleaned = clean(value);
      if (cleaned) return { value: cleaned, source };
    }
    return { value: "", source: "" };
  }

  const pageText = clean(document.body?.innerText || "").slice(0, MAX_PAGE_TEXT);
  const ld = fromJsonLd();
  const mt = fromMeta();
  const dom = fromDom(pageText);
  const canonical = document.querySelector('link[rel="canonical"]')?.href || "";

  // The name is resolved first: credentials are split off whichever string
  // became the name, and the org candidate from <title> needs the name to
  // know what to discard.
  const namePick = pick([
    ["json-ld", ld.fullName],
    ["page heading", dom.fullName],
    ["page title", mt.fullName],
  ]);
  const split = splitCredentials(namePick.value);

  const chosen = {
    fullName: namePick,
    organization: pick([
      ["json-ld", ld.organization],
      ["site name", mt.organization],
      ["page title", orgFromTitle(split.name)],
    ]),
    phone: pick([["json-ld", ld.phone], ["tel: link", dom.phone], ["page text", phoneFromText(pageText)]]),
    email: pick([["json-ld", ld.email], ["mailto: link", dom.email]]),
    website: pick([["json-ld", ld.website], ["canonical", canonical], ["address bar", location.href]]),
    specialization: pick([["json-ld", ld.specialization]]),
    address: pick([["json-ld", ld.address]]),
    // og:image ranks below the page scan on purpose: it's frequently a logo
    // or a social share card, whereas the scan rejects logo-ish images and
    // insists on portrait-ish dimensions before offering anything.
    photoUrl: pick([
      ["json-ld", absoluteUrl(ld.photoUrl)],
      ["page image", findHeadshot(split.name)],
      ["og:image", absoluteUrl(mt.photoUrl)],
    ]),
  };

  const fields = {
    fullName: split.name,
    credentials: split.credentials,
    organization: chosen.organization.value,
    phone: chosen.phone.value,
    email: chosen.email.value,
    website: chosen.website.value,
    specialization: chosen.specialization.value,
    address: chosen.address.value,
    photoUrl: chosen.photoUrl.value,
  };

  const sources = {
    fullName: chosen.fullName.source,
    credentials: split.credentials ? chosen.fullName.source : "",
    organization: chosen.organization.source,
    phone: chosen.phone.source,
    email: chosen.email.source,
    website: chosen.website.source,
    specialization: chosen.specialization.source,
    address: chosen.address.source,
    photoUrl: chosen.photoUrl.source,
  };

  return {
    fields,
    sources,
    sourceUrl: canonical || location.href,
    scrapedAt: new Date().toISOString(),
    // Carried for the LLM normalizer step, which reads only what the
    // deterministic tiers left blank. Unused today.
    pageText,
  };
})();
