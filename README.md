# Practice Studio Clipper

A Chrome/Vivaldi extension that reads the page you're on and writes a file into an inbox
folder for Practice Studio to import. Two things it can read:

- **Contact** — a therapist's website becomes a vCard, filed as a **mental health provider**
  (`X-CONTACT-TYPE:therapist`). This is most of what the extension does.
- **Book** — a book page becomes a `.book.json` for the lending library.

The popup opens on whichever the page looks like: a page that declares itself a book
(schema.org `Book`, `og:type=book`, or one of the shops in `scrape-book.js`) starts on
**Book**, everything else on **Contact**. The switch at the top is always there, and the
guess is never binding.

## Status

Contacts, in four steps, all done:

- [x] **Step 1** — extension skeleton, deterministic scrape, `.vcf` download
- [x] **Step 2** — `contactInboxPath` setting + "Import from inbox" in Practice Studio
- [x] **Step 3** — LM Studio normalizer for what the deterministic tiers miss
- [x] **Step 4** — clip history ("you clipped this page 3 days ago")

Books, added August 2026: the book pane, `scrape-book.js`, and the matching importer in
Practice Studio's Library. No local-model step — there is nothing on a book page worth
guessing at.

**One-time setup:** in Practice Studio, open **Contacts → settings → Contact inbox folder**,
choose `~/Downloads/ps-contact-inbox`, and save; then **Library → settings → Choose folder**
for `~/Downloads/ps-library-inbox`. "Import from inbox" appears in each panel once its
folder is set, and reviews everything waiting there in one pass. Imported files move to an
`_imported` folder inside the inbox rather than being deleted.

## Books

Open a book's page, switch to **Book** if it didn't open there, check the three fields, and
**Save to library inbox** → `~/Downloads/ps-library-inbox/anchors-and-sails.book.json`. In
Practice Studio: **Library → the settings button → Import from inbox**.

The cover downloads beside the record and the record names the file it *actually* landed
under, the same uniquify dance the headshot path does.

### What's read

Tiers, most trustworthy first, and the popup names the one each field came from:

1. **JSON-LD** — `Book` first, then a `Product` wrapper; `workExample` is consulted for an
   edition's ISBN. Nested nodes are searched, so a `Book` hanging off a `Product` is found.
2. **The page**, for the three shops actually used (Amazon, Goodreads, Bookshop.org) — a
   short table of selectors in `scrape-book.js`, plus an ISBN pattern read out of the page
   text where those sites bury it in a detail list.
3. **Meta tags** — `og:title`, `books:author`, `books:isbn`, `og:image`.

Anywhere else, the title comes from the page's `<h1>` and the author is left blank on
purpose: a wrong author is worse than a missing one, and every field is editable before
saving.

### What's cleaned up, and what isn't

`book.js` holds the cleanup, and it's conservative:

- **Subtitles are kept.** They're part of the title and often the only thing separating two
  similar books. Only clauses that are unambiguously about a *listing* go — a trailing
  format ("— Paperback, January 3 2021", "(Hardcover)") and a trailing site name
  ("| Bookshop.org").
- **One author.** The app stores a single author line, so a multi-author byline keeps the
  first. `by`, `(Author)`, and "Visit …'s Page" furniture is stripped. A comma is *not* a
  separator — "Vantree, R." is one person written surname-first.
- **ISBNs are validated, not just cleaned.** 10 or 13 digits (a trailing `X` is a real check
  digit); anything else is dropped rather than stored. It's the dedupe key on import, and a
  mangled number matches nothing while looking authoritative.

### What the record contains

```json
{
  "kind": "practice-studio/library-book",
  "version": 1,
  "title": "Anchors and Sails: A Field Guide",
  "author": "R. Vantree",
  "isbn": "9781402894626",
  "cover_file": "anchors-and-sails.jpg",
  "source_url": "https://…",
  "clipped_at": "2026-08-19T12:00:00.000Z"
}
```

A title, who wrote it, a number, and a picture. **Nothing about who a book is for.** The
loan is recorded in the app, where the roster already lives — the extension never learns a
client exists. That's why this goes through a file drop rather than an endpoint into the
app: a port open on a machine holding clinical records, reachable by every page in the
browser, would be a real surface; a folder of book titles is not.

### On import

Practice Studio matches a clipped book against the shelf by **ISBN** first, then by title
and author. Two ISBNs that disagree are two editions, and a title match doesn't override
that. Import only ever **fills blanks** — an author already recorded was typed or corrected
by a person, and a retailer's byline isn't better information. Consumed files move to
`_imported/` inside the inbox rather than being deleted, and anything in the folder that
isn't a clipped book is left alone.

## The side panel

The clipper opens as a **side panel**, docked beside the page, not as a popup.

That is not cosmetic. A popup closes the instant it loses focus — browser
behaviour, not a setting — so clicking into the page to copy a sentence threw
away everything already typed into the form. The panel stays put, so the site
and the form are usable at the same time.

Two consequences worth knowing:

- **`default_popup` is gone from the manifest.** With it set, the toolbar click
  opens a popup and the panel never gets a look in. `background.js` handles
  `action.onClicked` and opens the panel itself. It deliberately does not use
  `setPanelBehavior({ openPanelOnActionClick: true })`, which makes the
  *browser* handle the click so no event reaches the extension at all.
- **"Read this page"** sits under the page URL. The panel outlives the page it
  was opened on, so it needs a way to be pointed at whatever tab you are on
  now. It is a button and not automatic on tab change on purpose: a re-read
  overwrites every field, and doing that to someone mid-edit because they
  glanced at another tab would undo the reason the panel exists.

### Why this needs host permissions

The extension used to run on `activeTab` — permission to read a page granted
by clicking the toolbar button on it, and only for that tab. That is a nicely
narrow model and it is **structurally incompatible with a panel that stays
open**: the whole point is browsing to other tabs while the form sits there,
and a per-invocation grant never covers them. Every attempt to keep it failed
the same way, with the panel opening fine and every read refused.

So the extension now declares `host_permissions` for `http://*/*` and
`https://*/*`. What that changed, stated plainly: it *could* read any ordinary
web page at any time, where before it could only read one you had invoked it
on. It doesn't — the only injection sites are `scrape.js` and
`scrape-book.js`, both run from `runInActiveTab` on an explicit click — but
the capability is now standing rather than granted per use.

That was judged the right trade for this extension specifically: it is
unlisted, runs on one machine, is used by the person who wrote it, and reading
arbitrary therapist websites is its entire job. It would be the wrong trade for
anything published.

One thing it improved: the guard against browser pages finally works. `tab.url`
was itself permission-gated under `activeTab`, so on exactly the pages worth
rejecting the guard saw `undefined` and waved them through — Chrome then
refused the injection with its own wording, which read like a crash.

The side panel API is Chrome 114+. Vivaldi is Chromium-based but does not
reliably expose it to extensions, so treat Chrome as the supported browser for
now.

## Installing

It's an unpacked MV3 extension — no build step.

- **Chrome** — `chrome://extensions` → enable Developer mode → *Load unpacked* → pick this folder
- **Vivaldi** — `vivaldi://extensions` → same steps

Reload the extension from that page after editing any file.

## Using it — contacts

1. Open a therapist's site or directory profile
2. Click the toolbar button
3. Check the fields — each shows where it came from (`from json-ld`, `from tel: link`,
   `not found`), and every one is editable
4. **Save to inbox** → `~/Downloads/ps-contact-inbox/rowan-aldridge-lcsw.vcf`
5. In Practice Studio: **Contacts → settings → Import from inbox**

Same-name files get a numeric suffix rather than overwriting. Practice Studio's importer
matches on name and only fills blank fields, so re-clipping someone updates rather than
duplicates them.

## Phone numbers

Whatever the page gives is normalised to one house format, `(555) 010-2288`,
before it reaches the form — so the number you read, the number you edit, and
the number written into the `.vcf` are the same string. A `tel:` href gives
bare digits; page text gives whatever the designer typed, including
non-breaking spaces, en dashes, a `Call:` prefix, or an office and a mobile
run together with nothing between them.

**It never invents one.** A phone number in a referral directory gets dialled,
so anything that can't be read confidently as a 10-digit North American number
comes through with its whitespace collapsed and nothing else touched — visibly
odd, which beats confidently wrong. International numbers pass through as
written. An extension is kept and normalised to `ext.`

The rule that this splits two jammed numbers only when **both halves** look
like real numbers is load-bearing, and a test earned it: taking the first ten
digits of any long run turned `+44 20 7946 0018` into `(442) 079-4600` — a
number that dials someone, invented out of a number that didn't.

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

### Thinking models

Qwen3.5 and its relatives think by **default**, and LM Studio puts that block in a separate
`reasoning_content` field rather than in `content`. Asked for a small JSON object, the model
would spend the whole reply thinking, leave `content` empty, and the clip that had actually
worked came back as *"The model returned an empty reply"* — with the finished object sitting
in the other field.

The request now ends with an assistant turn containing an already-closed empty `<think>`
block, so the next thing the model writes is the object. Measured against `qwen3.5-9b-mlx`
on the same page:

| | time | reasoning tokens | result |
|---|---|---|---|
| without the prefill | 27.7s | 57 | `content` empty, answer stranded |
| with the prefill | 4.7s | 0 | answer in `content` |

Things that do **not** fix it, all tried: the JSON schema (a constrained reply may still
think first), a bigger `max_tokens` (the model doesn't stop — 1599 tokens and 91 seconds
still produced nothing), `/no_think` (that's the Qwen3 switch; Qwen3.5 ignores it), and
`chat_template_kwargs: {enable_thinking: false}` (the documented parameter, which LM Studio
drops — vLLM and SGLang do honour it).

`replyText` reads `reasoning_content` as a fallback in case a model thinks anyway, and if
nothing usable comes back at all the status line now names the setting: **Inference →
Reasoning → Enable Thinking**, which is a per-model toggle in LM Studio and defaults to on.

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
