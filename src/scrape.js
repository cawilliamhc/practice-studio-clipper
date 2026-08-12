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
