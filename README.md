# Practice Studio Clipper

A Chrome/Vivaldi extension that reads a therapist's website, shows you what it found, and
writes a vCard into an inbox folder for Practice Studio to import.

Every card is filed as a **mental health provider** (`X-CONTACT-TYPE:therapist`).

## Status — step 1 of 4

- [x] **Step 1** — extension skeleton, deterministic scrape, `.vcf` download
- [x] **Step 2** — `contactInboxPath` setting + "Import from inbox" in Practice Studio
- [x] **Step 3** — LM Studio normalizer for what the deterministic tiers miss
- [x] **Step 4** — clip history ("you clipped this page 3 days ago")

**One-time setup:** in Practice Studio, open **Contacts → settings → Contact inbox folder**,
choose `~/Downloads/ps-contact-inbox`, and save. "Import from inbox" then appears in the
same panel and reviews everything waiting there in one pass. Imported cards move to an
`_imported` folder inside the inbox rather than being deleted.

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
5. In Practice Studio: **Contacts → settings → Import from inbox**

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

Phone and email are never inferred from prose beyond that last conservative step. Platform
noise (`@wixpress.com`, `@squarespace.com`) is filtered out of email candidates.

## Headshots

When the page offers a portrait, the popup shows it with a **Don't include** link. Saving
writes the image into the inbox next to the card, and the card points at it by bare filename
— the same sibling-file convention Practice Studio uses for its own contact photos, so the
importer copies it into the contacts folder on the way in.

Three tiers, in order:

1. **JSON-LD** `image` on the `Person` node — never the organization's, which is usually the
   practice logo
2. **A scan of the page's images**, scoring each on whether its alt text or class names the
   person, whether it reads as a portrait (`headshot`, `bio`, `avatar`…), whether it's
   roughly square or a little taller than wide, and how early it appears. Anything named
   like a logo, badge, or banner is rejected outright, as is anything under 80px or wildly
   out of portrait proportion.
3. **`og:image`** last, because it's so often a logo or a social share card

The image is downloaded before the card is written, and the card references the filename the
download *actually* landed under — Chrome uniquifies a name that collides, so asking for
`jane.jpg` can produce `jane (1).jpg`, and a card naming the wrong one points at nothing. If
the image can't be saved, the contact still is; the status line says so.

A photo fills only where blank on import. Re-clipping never replaces a headshot you already
have.

## Tags and location

**Tags** come from a closed vocabulary of about fifty terms — modalities (EMDR, IFS, DBT,
Brainspotting), who someone sees (Couples, Adolescents, Perinatal), what they work with
(Trauma, ADHD, Grief), and how they work (Telehealth, Sliding Scale, Walk-and-Talk) — matched
literally against the page copy and capped at ten. No model is involved, so there is nothing
to hallucinate: if the words aren't on the page, the tag isn't applied.

Closed on purpose. Every tag becomes a **contact group** in Practice Studio, created on
import if it doesn't exist, and free-form phrases would breed a hundred one-off groups.
Terms whose mere mention is ambiguous are left out — "I don't accept insurance" reads the
same as the opposite to a plain match.

They travel as `CATEGORIES`, the standard vCard property for tags, so a card exported from
anywhere else brings its tags along too.

**Location** is tried in three tiers: a JSON-LD `PostalAddress`, an `<address>` block, then
the first "City, ST" or "City, State" in the copy. A Contact has no location field, so it
lands in `NOTE` — the one thing still written there.

Both are matched against the *whole* page, not the 5,000-character slice the model sees: a
phone number or a city in the footer is still a phone number or a city.

## The local model

Tick **Fill gaps with the local model** and anything the tiers left blank goes to LM Studio
on `localhost:1234`. The preference sticks between clips. Nothing leaves the machine.

Three rules make this safe to point at an arbitrary website:

1. **Only blank fields.** A value that came from JSON-LD or a `tel:` link is never
   reconsidered.
2. **Never asked for phone, email, website, or address.** Those are where a plausible
   invention does real damage — a wrong number in a referral directory gets dialled — and
   the deterministic tiers already cover them. The measured gap was organization and
   specialization, so that's what this closes.
3. **Names, credentials, and organizations must appear on the page**, compared with case,
   punctuation, and spacing ignored. If the model can't point at it, it's dropped and the
   status line says how many went.

Specialization is exempt from rule 3 by necessity — it's a summary of modalities scattered
across a page, not a quotable span — so it's length-capped instead. Every filled field is
labelled `from local model` in the popup, so it's obvious which values want a second look.

The page text is untrusted input: it's passed as data with an explicit instruction not to
follow it, the reply is constrained by a JSON schema so there's no free-form channel, and
every value is then verified or labelled. The worst an injected instruction achieves is a
wrong field you see before saving.

If the model wraps its answer in a markdown fence, narrates around it, or emits a `<think>`
block first, the object is salvaged rather than the clip being lost. When nothing parseable
comes back the status line quotes what it actually said, and the full reply goes to the
popup's console (right-click → Inspect).

Requirements: LM Studio running with a chat model loaded. The model is auto-selected from
`/v1/models` (embedding models skipped), so there's no id to keep in sync. If the server
isn't running, the clip still works — the status line says so and the deterministic fields
stand. A round trip takes about 5 seconds on a 9B model.

The endpoint is fixed at `http://localhost:1234` because it has to match `host_permissions`
in the manifest, which is what lets the popup reach it.

## Clip history

Opening the popup on a page you've clipped before shows a note saying when. It's
informational only — re-clipping is harmless, since the inbox uniquifies the filename and
Practice Studio matches on name and fills only blank fields, so a repeat import updates
rather than duplicates.

Two ways a repeat is recognized:

- **The page**, compared with scheme, `www.`, trailing slash, fragment, and campaign
  parameters (`utm_*`, `fbclid`, …) all ignored — the same profile reached from a newsletter
  and from search is one page, not two
- **The person**, which catches someone clipped from their own site and later from a
  directory profile, where the URLs share nothing. Correcting the name in the popup
  re-checks as you type.

History lives in `chrome.storage.local`, capped at 500 entries, newest first. Nothing leaves
the browser.

## Field mapping

| Popup field | vCard | Practice Studio |
|---|---|---|
| Full name + credentials | `FN`, `N` | `fullName` — its matcher strips post-nominals, so "Rowan Aldridge, LCSW" still matches an existing "Rowan Aldridge" |
| Practice | `ORG` | `organization` |
| Phone | `TEL;TYPE=WORK` | `phone` |
| Email | `EMAIL;TYPE=INTERNET` | `email` |
| Website | `URL` | `website` |
| Specialization | `X-SPECIALIZATION` | `specialization` |
| Tags | `CATEGORIES` | `tags` → contact groups, created on import if new |
| Location | `NOTE` | `notes` — a Contact has no location field, so the note is the only place it survives |
| Headshot | `PHOTO;VALUE=uri` — a bare sibling filename | `photoFileName`, copied into the contacts folder on import |
| — | `X-CONTACT-TYPE:therapist` | set by the import dialog's dropdown, which already defaults to therapist |

Specialization was duplicated into `NOTE` until step 2, because `parseVCardRows` hardcoded
`specialization: ""` — correct for an address-book export, which has no such concept, but it
dropped ours. The importer now reads the property directly, so the note copy is gone.

## Icons

The toolbar mark is the Practice Studio asterisk, taken from
`practice-studio-desktop/src-tauri/icons/practice-studio-mark.svg` and made full-bleed —
the app icon's inset padding is worth losing at 16px, where Chrome adds its own.

`icons/mark.svg` is the source. There's no SVG rasterizer on this machine, so the browser
draws and Node writes:

```bash
node scripts/render-icons.mjs
```

Then open the URL it prints. It writes `icon-{16,32,48,128}.png` and exits. Opening
`icons/render.html` off any static server works too — it previews every size against light
and dark toolbars and has a "Download all" button.

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

`test/fixtures/popup-harness.html` runs the **real popup** outside the extension — shipping
`popup.js`, `vcard.js`, and `llm.js`, with only the `chrome.*` APIs faked and the scrape
result canned. It does a live local-model round trip and logs the vCard it would have
written, which is the quickest way to see a change to the popup without reloading the
extension.

## Known rough edges

- `jobTitle` gets folded into specialization, so a card can read "…, Clinical Social Worker"
  alongside an LCSW credential. Harmless and editable.
- Rule 3 is stricter than it is clever. On a page reading "I'm a licensed mental health
  counselor," the model correctly answered `LMHC` and the guardrail dropped it, because the
  letters appear nowhere on the page. That's the trade-off working as designed — credentials
  ride in the contact's display name, so a wrong one is worse than a blank — but it does mean
  typing the odd credential in by hand.
- Tag matching can catch a practice's *name* rather than a described service — a page for
  "Northgate Family Therapy" picks up `Families` whether or not they see families. Visible
  and editable in the popup.
- Group-practice pages listing several therapists yield only the first one. One page, one
  card, for now. This is also where headshot picking is least reliable — a team page full of
  portraits gives the scorer little to separate them beyond alt text.
- Headshot scoring is heuristic and deliberately timid. A miss leaves the field blank and
  visible rather than attaching a stranger's face to a colleague's record, which is why the
  popup shows the picture rather than describing it.
- The inbox folder is fixed at `Downloads/ps-contact-inbox` (`INBOX_SUBFOLDER` in
  `src/popup.js`). Chrome's downloads API can't write outside Downloads; step 2 can switch
  to the File System Access API if writing straight into the Drive tree is worth the
  permission friction.
