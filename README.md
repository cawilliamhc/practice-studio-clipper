# Practice Studio Clipper

A Chrome/Vivaldi extension that reads a therapist's website, shows you what it found, and
writes a vCard into an inbox folder for Practice Studio to import.

Every card is filed as a **mental health provider** (`X-CONTACT-TYPE:therapist`).

## Status — step 1 of 4

- [x] **Step 1** — extension skeleton, deterministic scrape, `.vcf` download
- [ ] **Step 2** — `contactInboxPath` setting + "Import from inbox" in Practice Studio
- [ ] **Step 3** — LM Studio normalizer for what the deterministic tiers miss
- [ ] **Step 4** — clipped-URL history ("you saved this one on 3 Aug")

Until step 2 lands, import the saved file with **Contacts → Import vCard…** in Practice
Studio and point it at `~/Downloads/ps-contact-inbox/`.

## Installing

It's an unpacked MV3 extension — no build step.

- **Chrome** — `chrome://extensions` → enable Developer mode → *Load unpacked* → pick this folder
- **Vivaldi** — `vivaldi://extensions` → same steps

Reload the extension from that page after editing any file.

## Using it

1. Open a therapist's site or directory profile
2. Click the toolbar button
3. Check the fields — each shows where it came from (`from json-ld`, `from tel: link`,
   `not found`), and every one is editable
4. **Save to inbox** → `~/Downloads/ps-contact-inbox/rowan-aldridge-lcsw.vcf`

Same-name files get a numeric suffix rather than overwriting. Practice Studio's importer
matches on name and only fills blank fields, so re-clipping someone updates rather than
duplicates them.

## How it extracts

Tiers, most trustworthy first — the first tier to produce a value wins, and the popup names
it:

1. **JSON-LD** `schema.org` `Person` / `LocalBusiness` / `Psychologist` — what Psychology
   Today and most Squarespace/Wix templates emit
2. **Meta tags** — `og:title`, `og:site_name`, `<title>`
3. **DOM** — `tel:` and `mailto:` links, `<h1>`
4. **Page text** — phone numbers only, and only when there's no `tel:` link

Phone and email are never inferred from prose beyond that last conservative step. When the
LLM normalizer arrives in step 3 it will only ever read fields the tiers left blank, and
contact details it returns get checked against the raw page text before they're accepted —
a hallucinated phone number in a referral directory is the failure mode worth designing
against.

Platform noise (`@wixpress.com`, `@squarespace.com`) is filtered out of email candidates.

## Field mapping

| Popup field | vCard | Practice Studio |
|---|---|---|
| Full name + credentials | `FN`, `N` | `fullName` — its matcher strips post-nominals, so "Rowan Aldridge, LCSW" still matches an existing "Rowan Aldridge" |
| Practice | `ORG` | `organization` |
| Phone | `TEL;TYPE=WORK` | `phone` |
| Email | `EMAIL;TYPE=INTERNET` | `email` |
| Website | `URL` | `website` |
| Specialization | `X-SPECIALIZATION` **and** `NOTE` | `notes` (see below) |
| Address | `NOTE` | `notes` |
| — | `X-CONTACT-TYPE:therapist` | set by the import dialog's dropdown, which already defaults to therapist |

Specialization is written twice on purpose. Practice Studio's `parseVCardRows` hardcodes
`specialization: ""` — correct for an address-book export, which has no such concept, but it
would silently drop ours. `NOTE` survives that path today; the `X-` property is there for
when step 2 teaches the importer to read it.

## Tests

```bash
npm test
```

`test/roundtrip.test.mjs` imports Practice Studio's **actual** parser from the sibling
`practice-studio-desktop` checkout (Node strips its type-only import natively) and asserts
the app reads back what this extension writes. A local reimplementation of that parser could
happily agree with the writer while both disagreed with the app. Those tests skip
automatically if the sibling repo isn't there.

## Verifying the scraper by hand

`test/fixtures/` holds two pages — one with full JSON-LD, one with none — and
`.claude/launch.json` serves the project on `:8765`:

```bash
python3 -m http.server 8765 --directory .
```

Then from the page console:

```js
const r = eval(await (await fetch('/src/scrape.js')).text()); console.table(r.fields);
```

## Known rough edges

- `jobTitle` gets folded into specialization, so a card can read "…, Clinical Social Worker"
  alongside an LCSW credential. Harmless, editable, and step 3's job to tidy.
- Group-practice pages listing several therapists yield only the first one. One page, one
  card, for now.
- The inbox folder is fixed at `Downloads/ps-contact-inbox` (`INBOX_SUBFOLDER` in
  `src/popup.js`). Chrome's downloads API can't write outside Downloads; step 2 can switch
  to the File System Access API if writing straight into the Drive tree is worth the
  permission friction.
