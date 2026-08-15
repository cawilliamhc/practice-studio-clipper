#!/usr/bin/env python3
"""Regenerates the contact photo worklist from Practice Studio's _contacts folder.

Throwaway-but-rerunnable: contacts that gain a photo drop off the list, so it
can be regenerated mid-job to see what is left. Reads only; writes one HTML
file. Client-linked and emergency contacts are excluded by construction —
looking up a client's family member online is not what this is for.

    python3 scripts/worklist.py [output.html]
"""
import sys, os, glob, re, html

CONTACTS = os.path.expanduser(
    "~/Library/CloudStorage/GoogleDrive-me@carlwilliamson.com/My Drive/"
    "01_CLINICAL RECORDS/00_ACTIVE/_contacts"
)
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Downloads/contact-photo-worklist.html")

def unfold(text):
    """RFC 6350: a line beginning with space/tab continues the previous one.
    Missing this truncates every URL longer than 75 characters."""
    return re.sub(r"\r?\n[ \t]", "", text.replace("\r\n", "\n"))

def prop(text, name):
    """Value only — skips any parameters, e.g. URL;TYPE=WORK:https://..."""
    m = re.search(rf"^{name}(?:;[^:\r\n]*)?:(.*)$", text, re.M)
    return m.group(1).strip() if m else ""

rows = []
for path in sorted(glob.glob(os.path.join(CONTACTS, "**", "*.vcf"), recursive=True)):
    t = unfold(open(path, encoding="utf-8", errors="replace").read())
    if "PHOTO" in t:
        continue
    if re.search(r"^X-(OWNER-CLIENT-FOLDER|LINKED-CLIENT)", t, re.M):
        continue
    u = prop(t, "URL").replace("\\:", ":").replace("\\,", ",")
    if not u or u.startswith("fb://"):
        continue
    if not re.match(r"^https?://", u, re.I):
        u = "https://" + u.lstrip("/")
    name = prop(t, "FN") or os.path.basename(path)[:-4]
    org = prop(t, "ORG").replace("\\,", ",").rstrip(";")
    missing = [f for f, pat in (("email", r"^EMAIL"), ("phone", r"^TEL"), ("org", r"^ORG"))
               if not re.search(pat, t, re.M)]
    dom = re.sub(r"^https?://(www\.)?", "", u, flags=re.I).split("/")[0].lower()
    rows.append((name, u, dom, org, missing))

# Same-layout sites together, so the clipping rhythm settles.
rows.sort(key=lambda r: (r[2] != "psychologytoday.com", r[2], r[0].lower()))

parts = [f"""<title>Contact photo worklist</title>
<style>
 body{{font:14px -apple-system,system-ui,sans-serif;margin:2rem auto;max-width:62rem;color:#222}}
 h1{{font-size:1.3rem;margin-bottom:.2rem}} .sub{{color:#666;margin-bottom:1.2rem}}
 li{{margin:.3rem 0;padding:.4rem .6rem;border-radius:6px;display:flex;gap:.7rem;align-items:baseline}}
 li:nth-child(odd){{background:#f6f6f4}}
 li.seen{{background:#fdf6e6;box-shadow:inset 3px 0 #d9a441}}
 li.done{{opacity:.4;text-decoration:line-through;background:none;box-shadow:none}}
 a{{font-weight:600;color:#186}} .dom{{color:#888;font-size:12px}} .miss{{color:#a60;font-size:12px}}
 .flag{{display:none;color:#96702a;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}}
 li.seen:not(.done) .flag{{display:inline}}
 input{{transform:scale(1.2)}} #bar{{position:sticky;top:0;background:#fff;padding:.6rem 0;border-bottom:1px solid #ddd}}
 #o{{color:#96702a;font-weight:600}}
</style>
<h1>Contact photo worklist</h1>
<div class=sub>{len(rows)} contacts with a website and no photo. Client-linked and emergency contacts excluded.
Open a link — the row marks itself <b>opened</b> so you can see where you stopped — clip it, then tick it off.
Progress saves in this browser. Rerun <code>scripts/worklist.py</code> to drop the ones already done.</div>
<div id=bar><b><span id=n>0</span> / {len(rows)}</b> <span id=o></span> &nbsp;
<button onclick="localStorage.removeItem('psWorklist');localStorage.removeItem('psWorklistOpened');location.reload()">reset</button></div>
<ol>"""]
for name, u, dom, org, missing in rows:
    extra = f' <span class=miss>also missing: {", ".join(missing)}</span>' if missing else ""
    o = f' <span class=dom>· {html.escape(org)}</span>' if org else ""
    parts.append(f'<li data-k="{html.escape(name)}"><input type=checkbox>'
                 f'<span><a href="{html.escape(u)}" target=_blank rel=noopener>{html.escape(name)}</a>'
                 f'{o} <span class=dom>{html.escape(dom)}</span>{extra}'
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
print(f"{len(rows)} contacts -> {OUT}")
