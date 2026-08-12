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

  // Words no personal name contains. Their presence marks a string as a
  // headline, tagline, or practice name — "Affirmative psychotherapy with
  // Kay Teresa Hall" is a page banner, not a person.
  const NOT_IN_A_NAME = new Set([
    "with", "and", "for", "the", "of", "in", "at", "on", "your", "my", "our", "a", "an", "to",
    "by", "from", "is", "are", "am", "welcome", "home", "about", "meet",
    "psychotherapy", "therapy", "therapist", "counseling", "counselling", "counselor",
    "counsellor", "services", "service", "practice", "clinic", "center", "centre", "group",
    "associates", "partners", "wellness", "health", "healing", "support", "llc", "pllc", "inc", "pc",
  ]);

  // Lowercase particles that legitimately sit inside a personal name.
  const NAME_PARTICLES = new Set([
    "van", "von", "de", "del", "della", "da", "di", "la", "le", "du", "den", "der", "bin", "al", "ben", "st",
  ]);

  /** Strips leading punctuation and trailing non-name characters — real pages
   *  produce things like "%Affirmative …" from stray markup. */
  function trimNameJunk(raw) {
    return clean(raw).replace(/^[^\p{L}]+/u, "").replace(/[^\p{L}.]+$/u, "");
  }

  /**
   * True when a string reads like a person's name rather than a headline.
   *
   * Deliberately strict, because the cost is asymmetric: a rejected name
   * leaves the field blank, which the local model may fill and which the
   * popup shows as "not found" — whereas an accepted headline becomes a
   * contact literally named "Affirmative psychotherapy with Kay Teresa Hall",
   * which no name matcher will ever connect to the real person.
   */
  function looksLikePersonName(raw) {
    const value = clean(raw);
    if (!value || value.length > 60) return false;
    if (/[\d%|+:/@!?]/.test(value)) return false;
    const words = value.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 5) return false;
    for (const word of words) {
      const bare = word.replace(/[.,'’\-]/g, "").toLowerCase();
      if (!bare) continue;
      if (NOT_IN_A_NAME.has(bare)) return false;
      if (!/^\p{Lu}/u.test(word) && !NAME_PARTICLES.has(bare)) return false;
    }
    return true;
  }

  /** Pulls a person out of a headline that ends with one — "…psychotherapy
   *  with Kay Teresa Hall" gives up "Kay Teresa Hall". */
  function personNameWithin(raw) {
    const match = clean(raw).match(
      // Both cases spelled out rather than an /i flag: that would also relax
      // \p{Lu} and let a lowercase word pass as a name.
      /\b(?:[Ww]ith|[Bb]y|[Mm]eet|[Ff]eaturing)\s+(\p{Lu}[\p{L}'’.-]*(?:\s+\p{Lu}[\p{L}'’.-]*){1,3})\s*$/u
    );
    return match ? match[1] : "";
  }

  /** A heuristic name candidate, kept only if it reads like a person — or if
   *  a person's name can be lifted out of it. */
  function personish(raw) {
    const cleaned = trimNameJunk(raw);
    if (looksLikePersonName(cleaned)) return cleaned;
    const within = personNameWithin(cleaned);
    return looksLikePersonName(within) ? within : "";
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
        if (!key) return false;
        // No name to compare against — every chunk is a candidate. Without
        // this guard an empty nameKey makes startsWith("") true for all of
        // them, so a rejected name would silently cost the organization too.
        if (!nameKey) return true;
        return key !== nameKey && !key.startsWith(nameKey);
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

  // ---- location -----------------------------------------------------------

  const STATE_ABBREVIATIONS =
    "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
  const STATE_NAMES =
    "Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia";

  // "Ashford, VT" / "Ashford, Vermont" / "New Haven, CT" — a capitalised
  // place followed by a state. The comma does most of the work: it's what
  // separates a real location from two ordinary words in a sentence.
  const CITY_STATE = new RegExp(
    `\\b([A-Z][a-z]+(?:[ -][A-Z][a-z]+){0,2}),\\s*(${STATE_ABBREVIATIONS}|${STATE_NAMES})\\b`
  );

  /** A street address the page marked up as one. */
  function addressElement() {
    const el = document.querySelector("address");
    return el ? clean(el.innerText || el.textContent || "") : "";
  }

  /** Falls back to the first "City, State" in the copy — enough to know where
   *  someone practises, which is what a referral directory needs. */
  function locationFromText(pageText) {
    const match = pageText.match(CITY_STATE);
    return match ? `${match[1]}, ${match[2]}` : "";
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

  // ---- tags ---------------------------------------------------------------

  // A closed vocabulary, matched literally against the page copy. Closed on
  // purpose: every tag becomes a contact group in Practice Studio, and
  // free-form phrases would breed a hundred one-off groups. Nothing here is
  // generated — if the words aren't on the page, the tag isn't applied.
  //
  // Entries are deliberately limited to terms whose mere mention is
  // meaningful. "Insurance" and "Medicare" are left out: "I don't accept
  // insurance" is as common as the opposite, and a plain match can't tell.
  const TAG_VOCABULARY = [
    // Modalities
    ["EMDR", /\bEMDR\b/i],
    ["Internal Family Systems", /\b(?:IFS|internal family systems)\b/i],
    ["CBT", /\b(?:CBT|cognitive[ -]behaviou?ral)\b/i],
    ["DBT", /\b(?:DBT|dialectical behaviou?r)/i],
    ["ACT", /\bacceptance and commitment\b/i],
    ["Somatic", /\bsomatic(?:\s+experiencing)?\b/i],
    ["Sensorimotor", /\bsensorimotor\b/i],
    ["Brainspotting", /\bbrainspotting\b/i],
    ["AEDP", /\bAEDP\b/i],
    ["Emotionally Focused", /\b(?:EFT|emotionally[ -]focused)\b/i],
    ["Gottman", /\bgottman\b/i],
    ["Play Therapy", /\bplay therapy\b/i],
    ["Art Therapy", /\bart therapy\b/i],
    ["Psychodynamic", /\bpsychodynamic\b/i],
    ["Psychoanalytic", /\bpsychoanaly(?:sis|tic)\b/i],
    ["Narrative Therapy", /\bnarrative therapy\b/i],
    ["Solution-Focused", /\bsolution[ -]focused\b/i],
    ["Mindfulness", /\bmindfulness\b/i],
    ["Motivational Interviewing", /\bmotivational interviewing\b/i],
    ["Gestalt", /\bgestalt\b/i],
    ["Jungian", /\bjungian\b/i],
    ["Ketamine-Assisted", /\bketamine[ -]assisted\b/i],
    ["Psychedelic-Assisted", /\bpsychedelic[ -]assisted\b/i],
    // Who they see
    ["Children", /\b(?:children|child therapy)\b/i],
    ["Adolescents", /\b(?:adolescen|teens?\b|teenagers)/i],
    ["Adults", /\badults\b/i],
    ["Older Adults", /\b(?:older adults|geriatric|seniors)\b/i],
    ["Couples", /\bcouples\b/i],
    ["Families", /\bfamily therapy|families\b/i],
    ["Groups", /\bgroup therapy\b/i],
    ["LGBTQIA+", /\b(?:LGBTQ|queer[- ]affirm|gender[- ]affirm)/i],
    ["Veterans", /\bveterans\b/i],
    ["Perinatal", /\b(?:perinatal|postpartum|maternal mental health)\b/i],
    // What they work with
    ["Trauma", /\b(?:trauma|PTSD)\b/i],
    ["Anxiety", /\banxiety\b/i],
    ["Depression", /\bdepression\b/i],
    ["Grief", /\b(?:grief|bereavement)\b/i],
    ["Eating Disorders", /\b(?:eating disorder|anorexia|bulimia|binge eating)\b/i],
    ["OCD", /\b(?:OCD|obsessive[- ]compulsive)\b/i],
    ["ADHD", /\bADHD\b/i],
    ["Autism", /\b(?:autis|neurodiverg)/i],
    ["Substance Use", /\b(?:substance use|addiction|recovery from|alcoholism)\b/i],
    ["Chronic Illness", /\bchronic (?:illness|pain)\b/i],
    ["Attachment", /\battachment\b/i],
    ["Burnout", /\bburnout\b/i],
    ["Divorce", /\b(?:divorce|separation)\b/i],
    ["Infertility", /\b(?:infertility|pregnancy loss)\b/i],
    // How they work
    ["Telehealth", /\b(?:telehealth|teletherapy|virtual sessions|online therapy)\b/i],
    ["Sliding Scale", /\bsliding scale\b/i],
    ["Supervision", /\b(?:clinical supervision|supervisor)\b/i],
    ["Walk-and-Talk", /\bwalk[ -]and[ -]talk\b/i],
    ["Intensives", /\bintensives?\b/i],
  ];

  const MAX_TAGS = 10;

  /** Vocabulary terms the page actually uses, in vocabulary order so the same
   *  page always yields the same list. */
  function tagsFromText(text) {
    const found = [];
    for (const [name, pattern] of TAG_VOCABULARY) {
      if (pattern.test(text)) found.push(name);
      if (found.length >= MAX_TAGS) break;
    }
    return found;
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

  // Pattern matching reads the whole page — a phone number or a city in the
  // footer is still a phone number or a city. Only the model's slice is
  // capped, because that one costs tokens.
  const fullText = clean(document.body?.innerText || "");
  const pageText = fullText.slice(0, MAX_PAGE_TEXT);
  const ld = fromJsonLd();
  const mt = fromMeta();
  const dom = fromDom(fullText);
  const canonical = document.querySelector('link[rel="canonical"]')?.href || "";

  // The name is resolved first: credentials are split off whichever string
  // became the name, and the org candidate from <title> needs the name to
  // know what to discard.
  // Structured data is taken at its word; the heuristic tiers have to prove
  // they found a person rather than a headline.
  const namePick = pick([
    ["json-ld", trimNameJunk(ld.fullName)],
    ["page heading", personish(dom.fullName)],
    ["page title", personish(mt.fullName)],
  ]);
  const split = splitCredentials(namePick.value);

  const chosen = {
    fullName: namePick,
    organization: pick([
      ["json-ld", ld.organization],
      ["site name", mt.organization],
      ["page title", orgFromTitle(split.name)],
    ]),
    phone: pick([["json-ld", ld.phone], ["tel: link", dom.phone], ["page text", phoneFromText(fullText)]]),
    email: pick([["json-ld", ld.email], ["mailto: link", dom.email]]),
    website: pick([["json-ld", ld.website], ["canonical", canonical], ["address bar", location.href]]),
    specialization: pick([["json-ld", ld.specialization]]),
    address: pick([
      ["json-ld", ld.address],
      ["address block", addressElement()],
      ["page text", locationFromText(fullText)],
    ]),
    tags: pick([["page copy", tagsFromText(fullText).join(", ")]]),
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
    tags: chosen.tags.value,
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
    tags: chosen.tags.source,
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
