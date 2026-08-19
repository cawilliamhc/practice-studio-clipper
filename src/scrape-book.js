// Injected into the active tab to read a book page. Sibling of scrape.js, and
// under the same constraint: a self-contained IIFE with no imports, because
// executeScript hands back the completion value and nothing from the
// extension's own modules exists in the page's world.
//
// Tiers, most trustworthy first, and each field records which tier produced
// it so the popup can say where a value came from. Cleaning up what's found
// happens in book.js, which is testable in Node — this file only locates
// strings.
(() => {
  const clean = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

  // ---- tier 1: JSON-LD ----------------------------------------------------

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

  // Book first, Product second: a retailer marks the listing as a Product and
  // the work as a Book, and the Book node is the one describing the thing on
  // the shelf.
  const BOOK_TYPES = new Set(["book", "ebook", "audiobook", "bookseries"]);
  const PRODUCT_TYPES = new Set(["product", "productmodel", "individualproduct"]);

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

  /** An ISBN can arrive as `isbn`, or as a gtin13 on the Product wrapper —
   *  a 13-digit book gtin IS the ISBN. Anything else is left for book.js to
   *  reject. */
  function isbnOf(node) {
    return firstString(node.isbn) || firstString(node.gtin13) || firstString(node.gtin) || "";
  }

  function fromJsonLd() {
    const nodes = jsonLdNodes();
    const book = nodes.find((n) => typesOf(n).some((t) => BOOK_TYPES.has(t)));
    const product = nodes.find((n) => typesOf(n).some((t) => PRODUCT_TYPES.has(t)));
    const primary = book || product;
    if (!primary) return { isBook: false };
    // A work often has a `workExample` edition carrying the ISBN the page is
    // actually selling.
    const edition = []
      .concat(primary.workExample || [])
      .find((e) => e && typeof e === "object" && isbnOf(e));
    return {
      isBook: Boolean(book),
      title: firstString(primary.name),
      author: firstString(primary.author) || firstString(primary.creator),
      isbn: isbnOf(primary) || (edition ? isbnOf(edition) : ""),
      coverUrl: imageUrl(primary.image),
    };
  }

  // ---- tier 2: meta tags --------------------------------------------------

  const meta = (selector) => clean(document.querySelector(selector)?.content || "");

  function fromMeta() {
    return {
      isBook: /^books?\./i.test(meta('meta[property="og:type"]')) || meta('meta[property="og:type"]') === "book",
      title: meta('meta[property="og:title"]') || clean(document.title),
      author: meta('meta[property="books:author"]') || meta('meta[name="author"]'),
      isbn: meta('meta[property="books:isbn"]') || meta('meta[name="isbn"]'),
      coverUrl: meta('meta[property="og:image"]'),
    };
  }

  // ---- tier 3: the handful of sites actually used -------------------------
  //
  // Per-site selectors are a maintenance cost and they're accepted for
  // exactly the pages a therapist's shelf comes from. Everything else falls
  // back to the generic heading, which is honest about being a guess: the
  // popup labels it and every field is editable before saving.
  const SITE_RULES = [
    {
      host: /(^|\.)amazon\./i,
      title: "#productTitle, #ebooksProductTitle",
      author: "#bylineInfo .author .contributorNameID, #bylineInfo .author a, #bylineInfo span.author",
      cover: "#landingImage, #imgBlkFront, #ebooksImgBlkFront",
      // Amazon puts the ISBN in a detail list rather than anywhere structured.
      isbnFromText: /ISBN-1[03]\s*:?\s*([\d-]{10,17}[\dX])/i,
    },
    {
      host: /(^|\.)goodreads\.com$/i,
      title: '[data-testid="bookTitle"], h1#bookTitle, h1.Text__title1',
      author: '[data-testid="name"], a.authorName span, .ContributorLink__name',
      cover: ".BookCover__image img, img#coverImage",
      isbnFromText: /ISBN\s*:?\s*([\d-]{10,17}[\dX])/i,
    },
    {
      host: /(^|\.)bookshop\.org$/i,
      title: "h1",
      author: '[itemprop="author"], .author-name, a[href*="/contributors/"]',
      cover: ".cover-image img, img.book-cover",
      isbnFromText: /ISBN[-\s]*13\s*:?\s*([\d-]{13,17})/i,
    },
  ];

  const text = (selector) => {
    if (!selector) return "";
    const el = document.querySelector(selector);
    return el ? clean(el.textContent) : "";
  };

  function fromDom(pageText) {
    const rule = SITE_RULES.find((r) => r.host.test(location.hostname));
    if (!rule) {
      // Generic fallback: the page's own heading. No author guess — a wrong
      // author is worse than a blank one, and every book page worth clipping
      // states its title in an h1.
      return { title: text("h1"), author: "", isbn: "", coverUrl: "" };
    }
    const img = document.querySelector(rule.cover);
    const isbnMatch = rule.isbnFromText ? pageText.match(rule.isbnFromText) : null;
    return {
      title: text(rule.title),
      author: text(rule.author),
      isbn: isbnMatch ? isbnMatch[1] : "",
      coverUrl: clean(img?.currentSrc || img?.src || ""),
    };
  }

  // ---- assembly -----------------------------------------------------------

  function absoluteUrl(value) {
    const raw = clean(value);
    if (!raw) return "";
    try {
      return new URL(raw, location.href).href;
    } catch {
      return "";
    }
  }

  /** First tier with a value wins, and its label travels with it. */
  function pick(candidates) {
    for (const [source, value] of candidates) {
      const cleaned = clean(value);
      if (cleaned) return { value: cleaned, source };
    }
    return { value: "", source: "" };
  }

  const pageText = clean(document.body?.innerText || "");
  const ld = fromJsonLd();
  const mt = fromMeta();
  const dom = fromDom(pageText);
  const canonical = document.querySelector('link[rel="canonical"]')?.href || "";

  const chosen = {
    // The site rules are trusted above og:title because a retailer's og:title
    // is frequently the listing headline ("Amazon.com: The Quiet Hour: …")
    // while #productTitle is the title of the book.
    title: pick([
      ["json-ld", ld.title],
      ["the page", dom.title],
      ["og:title", mt.title],
    ]),
    author: pick([
      ["json-ld", ld.author],
      ["the page", dom.author],
      ["meta tag", mt.author],
    ]),
    isbn: pick([
      ["json-ld", ld.isbn],
      ["the page", dom.isbn],
      ["meta tag", mt.isbn],
    ]),
    coverUrl: pick([
      ["json-ld", absoluteUrl(ld.coverUrl)],
      ["the page", absoluteUrl(dom.coverUrl)],
      ["og:image", absoluteUrl(mt.coverUrl)],
    ]),
  };

  return {
    fields: {
      title: chosen.title.value,
      author: chosen.author.value,
      isbn: chosen.isbn.value,
      coverUrl: chosen.coverUrl.value,
    },
    sources: {
      title: chosen.title.source,
      author: chosen.author.source,
      isbn: chosen.isbn.source,
      coverUrl: chosen.coverUrl.source,
    },
    // Whether this page announced itself as a book, rather than us having
    // guessed from a heading. The popup opens in book mode on the strength of
    // this, and never on the strength of a title alone.
    looksLikeBook: Boolean(ld.isBook || mt.isBook || SITE_RULES.some((r) => r.host.test(location.hostname))),
    sourceUrl: canonical || location.href,
    scrapedAt: new Date().toISOString(),
  };
})();
