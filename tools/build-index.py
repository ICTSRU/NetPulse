"""Build backend/Index.html (Apps Script copy of index.html) — paste-safe version.

- No line longer than ~200 chars (logos split into chunks), so copy/paste into the
  Apps Script editor cannot silently cut a line.
- Each logo is stored once and injected by a separate <script> placed AFTER the main
  script, so a logo problem can never stop sign-in.
- Ends with an integrity marker checked by doGet():  <!-- NP-END-OF-FILE vX.Y -->
"""
import re, base64, io, sys
from PIL import Image

root = sys.argv[1]
h = open(f'{root}/index.html', encoding='utf-8').read()

# APPS-SCRIPT GUARD: HtmlService strips '//' comments but does not understand template literals,
# so `https://...` inside backticks gets cut at '//' and breaks the whole page script.
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jsguard import check as _js_guard
import subprocess
_NODE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'node')
def _harden(js):
    return subprocess.run(['node', os.path.join(_NODE_DIR, 'harden.js')], input=js, capture_output=True, text=True, check=True).stdout
_bad = _js_guard(h)
if _bad:
    sys.exit("Apps Script guard failed — '//' inside a template literal (use '...' strings) at index.html lines: " + str(_bad))
version = re.search(r"VERSION: '([\d.]+)'", h).group(1)

def data(path):
    b = open(f'{root}/{path}', 'rb').read()
    if path.endswith('.png'):
        im = Image.open(io.BytesIO(b)).convert('RGBA')
        if im.width > 360:
            im = im.resize((360, round(im.height * 360 / im.width)), Image.LANCZOS)
        im = im.quantize(colors=128, method=Image.FASTOCTREE)   # smaller palette PNG
        o = io.BytesIO(); im.save(o, 'PNG', optimize=True); b = o.getvalue()
        mt = 'image/png'
    else:
        mt = 'image/svg+xml'
    return f'data:{mt};base64,' + base64.b64encode(b).decode()

used = sorted(set(re.findall(r'src="(assets/[^"]+)"', h)))
keys = {u: re.sub(r'\W+', '_', u.split('/')[-1].rsplit('.', 1)[0]) for u in used}
BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='
for u, k in keys.items():
    h = h.replace(f'src="{u}"', f'src="{BLANK}" data-logo="{k}"')

# icons/manifest links point to files Apps Script cannot serve
h = re.sub(r'<link rel="(icon|apple-touch-icon|manifest)"[^>]*>\n?', '', h)

# logo script: chunked strings, one entry per logo
lines = ['<script>', '/* Logos (embedded once). Separate script: a problem here never blocks sign-in. */', 'var NP_LOGOS = {};']
for u, k in keys.items():
    d = data(u)
    chunks = [d[i:i + 160] for i in range(0, len(d), 160)]
    lines.append(f"NP_LOGOS['{k}'] = [")
    lines += [f"'{c}'," for c in chunks]
    lines.append("].join('');")
lines += [
    "(function(){",
    "  try {",
    "    document.querySelectorAll('img[data-logo]').forEach(function(img){",
    "      var d = NP_LOGOS[img.getAttribute('data-logo')]; if (d) img.src = d;",
    "    });",
    "  } catch (e) { console.warn('logo load failed', e); }",
    "})();",
    f"window.NP_END = '{version}';   // end-of-file marker checked by doGet()",
    '</script>',
]
logo_js = '\n'.join(lines)

# put logo script after the last </script> (i.e., after the main script), before </body>
idx = h.rfind('</body>')
h = h[:idx] + logo_js + '\n' + h[idx:]
h = h.replace('<!doctype html>', '<!doctype html>\n<!-- Apps Script copy of index.html (logos embedded). Generated — do not edit by hand. -->', 1)
h = h.rstrip() + '\n'
# Harden every inline script: no comments and no literal '//' left for Apps Script to strip
h = re.sub(r'(<script>)(.*?)(</script>)', lambda m: m.group(1) + _harden(m.group(2)) + m.group(3), h, flags=re.S)
leftover = sum(s.count('//') for s in re.findall(r'<script>(.*?)</script>', h, re.S))
assert leftover == 0, f'{leftover} // sequences left in scripts'
open(f'{root}/backend/Index.html', 'w', encoding='utf-8').write(h)

longest = max(len(l) for l in h.split('\n'))
print(f'Index.html v{version}: {round(len(h.encode())/1024)} KB, longest line {longest} chars, logos {list(keys.values())}')
