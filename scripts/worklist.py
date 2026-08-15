#!/usr/bin/env python3
"""Regenerates the contact photo worklist from Practice Studio's _contacts folder.

Throwaway-but-rerunnable: contacts that gain a photo drop off the list, so it
can be regenerated mid-job to see what is left. Reads only; writes one HTML
file. Client-linked and emergency contacts are excluded by construction —
looking up a client's family member online is not what this is for.

The one criterion is a missing photo. Contacts with a website on file link
straight to it; the rest get a search link, which is slower but is the same
move by hand. Organisations are listed alongside people — a practice logo is
a real answer for a card that has nothing.

    python3 scripts/worklist.py [output.html]
    python3 scripts/worklist.py --clinicians [output.html]

--clinicians narrows to people who see clients, read from the card's own
X-CONTACT-TYPE rather than guessed from the name. Progress is shared between
the two lists — both key on the contact name — so a row ticked in one is
ticked in the other.
"""
import sys, os, glob, re, html
from urllib.parse import quote_plus

CONTACTS = os.path.expanduser(
    "~/Library/CloudStorage/GoogleDrive-me@carlwilliamson.com/My Drive/"
    "01_CLINICAL RECORDS/00_ACTIVE/_contacts"
)
# The card says what it is. An institute is a body, not a clinician, and gets
# left out of the narrowed list rather than guessed at from its name.
CLINICIAN_TYPES = {"therapist", "medical_professional", "psychiatrist", "supervisor", "physician"}

args = [a for a in sys.argv[1:] if not a.startswith("--")]
CLINICIANS_ONLY = "--clinicians" in sys.argv
OUT = args[0] if args else os.path.expanduser(
    "~/Downloads/" + ("clinician-photo-worklist.html" if CLINICIANS_ONLY else "contact-photo-worklist.html"))

def unfold(text):
    """RFC 6350: a line beginning with space/tab continues the previous one.
    Missing this truncates every URL longer than 75 characters."""
    return re.sub(r"\r?\n[ \t]", "", text.replace("\r\n", "\n"))

def prop(text, name):
    """Value only — skips any parameters, e.g. URL;TYPE=WORK:https://..."""
    m = re.search(rf"^{name}(?:;[^:\r\n]*)?:(.*)$", text, re.M)
    return m.group(1).strip() if m else ""

rows, skipped = [], {}
for path in sorted(glob.glob(os.path.join(CONTACTS, "**", "*.vcf"), recursive=True)):
    t = unfold(open(path, encoding="utf-8", errors="replace").read())
    if "PHOTO" in t:
        continue
    if re.search(r"^X-(OWNER-CLIENT-FOLDER|LINKED-CLIENT)", t, re.M):
        continue
    kind = prop(t, "X-CONTACT-TYPE").lower() or "unset"
    if CLINICIANS_ONLY and kind not in CLINICIAN_TYPES:
        skipped[kind] = skipped.get(kind, 0) + 1
        continue
    name = prop(t, "FN") or os.path.basename(path)[:-4]
    org = prop(t, "ORG").replace("\\,", ",").rstrip(";")
    u = prop(t, "URL").replace("\\:", ":").replace("\\,", ",")
    if u and not u.startswith("fb://"):
        if not re.match(r"^https?://", u, re.I):
            u = "https://" + u.lstrip("/")
        dom = re.sub(r"^https?://(www\.)?", "", u, flags=re.I).split("/")[0].lower()
    else:
        # No site on file: hand over the search you would have typed anyway.
        u = "https://www.google.com/search?q=" + quote_plus(f"{name} {org}".strip())
        dom = ""
    missing = [f for f, pat in (("email", r"^EMAIL"), ("phone", r"^TEL"), ("org", r"^ORG"))
               if not re.search(pat, t, re.M)]
    rows.append((name, u, dom, org, missing))

# Same-layout sites together, so the clipping rhythm settles; the ones with no
# site on file go last, since each is a search rather than a click.
rows.sort(key=lambda r: (not r[2], r[2] != "psychologytoday.com", r[2], r[0].lower()))
linked = sum(1 for r in rows if r[2])

title = "Clinician photo worklist" if CLINICIANS_ONLY else "Contact photo worklist"
noun = "clinicians" if CLINICIANS_ONLY else "contacts"
scope = (f"Only cards typed as someone who sees clients; "
         + ", ".join(f"{n} {k.replace('_', ' ')}{'s' if n != 1 else ''}"
                     for k, n in sorted(skipped.items(), key=lambda x: -x[1]))
         + " left out." if CLINICIANS_ONLY and skipped
         else "Nothing else is filtered out." if not CLINICIANS_ONLY
         else "Only cards typed as someone who sees clients.")
rerun = "scripts/worklist.py --clinicians" if CLINICIANS_ONLY else "scripts/worklist.py"

parts = [f"""<title>{title}</title>
<style>
 body{{font:14px -apple-system,system-ui,sans-serif;margin:2rem auto;max-width:62rem;color:#222}}
 h1{{font-size:1.3rem;margin-bottom:.2rem}} .sub{{color:#666;margin-bottom:1.2rem}}
 li{{margin:.3rem 0;padding:.4rem .6rem;border-radius:6px;display:flex;gap:.7rem;align-items:baseline}}
 li:nth-child(odd){{background:#f6f6f4}}
 li.seen{{background:#fdf6e6;box-shadow:inset 3px 0 #d9a441}}
 li.done{{opacity:.4;text-decoration:line-through;background:none;box-shadow:none}}
 a{{font-weight:600;color:#186}} .dom{{color:#888;font-size:12px}} .miss{{color:#a60;font-size:12px}}
 .nosite{{color:#7a7a86;font-style:italic}}
 .flag{{display:none;color:#96702a;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}}
 li.seen:not(.done) .flag{{display:inline}}
 input{{transform:scale(1.2)}} #bar{{position:sticky;top:0;background:#fff;padding:.6rem 0;border-bottom:1px solid #ddd}}
 #o{{color:#96702a;font-weight:600}}
</style>
<h1>{title}</h1>
<div class=sub>{len(rows)} {noun} with no photo — {linked} with a website on file, {len(rows) - linked} to search for.
Client-linked and emergency contacts excluded. {scope}
Open a link — the row marks itself <b>opened</b> so you can see where you stopped — clip it, then tick it off.
Progress saves in this browser, and is shared with the other list. Rerun <code>{rerun}</code> to drop the ones already done.</div>
<div id=bar><b><span id=n>0</span> / {len(rows)}</b> <span id=o></span> &nbsp;
<button onclick="localStorage.removeItem('psWorklist');localStorage.removeItem('psWorklistOpened');location.reload()">reset</button></div>
<ol>"""]
for name, u, dom, org, missing in rows:
    extra = f' <span class=miss>also missing: {", ".join(missing)}</span>' if missing else ""
    o = f' <span class=dom>· {html.escape(org)}</span>' if org else ""
    d = (f'<span class=dom>{html.escape(dom)}</span>' if dom
         else '<span class="dom nosite">no site on file — search</span>')
    parts.append(f'<li data-k="{html.escape(name)}"><input type=checkbox>'
                 f'<span><a href="{html.escape(u)}" target=_blank rel=noopener>{html.escape(name)}</a>'
                 f'{o} {d}{extra}'
                 f' <span class=flag>opened</span></span></li>')
parts.append("""</ol>
<script>
// Two states, deliberately separate: opening a link says you looked, ticking
// says you clipped it. Only the tick counts as done — a page with no usable
// headshot still gets opened, and should stay visibly unfinished.
const done=new Set(JSON.parse(localStorage.getItem('psWorklist')||'[]'));
const seen=new Set(JSON.parse(localStorage.getItem('psWorklistOpened')||'[]'));
const sync=()=>{
  document.getElementById('n').textContent=done.size;
  const open=[...seen].filter(k=>!done.has(k)).length;
  document.getElementById('o').textContent=open?`· ${open} opened, not ticked`:'';
  localStorage.setItem('psWorklist',JSON.stringify([...done]));
  localStorage.setItem('psWorklistOpened',JSON.stringify([...seen]));
};
document.querySelectorAll('li').forEach(li=>{const k=li.dataset.k,cb=li.querySelector('input');
  if(seen.has(k))li.classList.add('seen');
  if(done.has(k)){cb.checked=true;li.classList.add('done')}
  li.querySelector('a').addEventListener('click',()=>{seen.add(k);li.classList.add('seen');sync()});
  cb.onchange=()=>{cb.checked?(done.add(k),li.classList.add('done')):(done.delete(k),li.classList.remove('done'));sync()}});
sync();
</script>""")
open(OUT, "w", encoding="utf-8").write("\n".join(parts))
print(f"{len(rows)} {noun} -> {OUT}")
