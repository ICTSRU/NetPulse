/* Apps Script hardening (uses the acorn JS tokenizer).
 * Apps Script strips "//" line comments from inline scripts and can mis-detect them inside
 * strings, cutting the line. This pass leaves it nothing to strip:
 *   1. every comment is removed (block comments keep their line breaks so line numbers stay put);
 *   2. inside string / template / regex tokens, any "/" that is escaped ("\/") or part of "//"
 *      is written as "\x2F" — the same character, valid in all three token kinds.
 * The result must still parse and must not contain "//" anywhere.
 */
const acorn = require('acorn');
const fs = require('fs');

const src = fs.readFileSync(0, 'utf8');
const edits = [];
const opts = {
  ecmaVersion: 2022,
  onComment: (block, text, start, end) =>
    edits.push({ start, end, rep: block ? '\n'.repeat((text.match(/\n/g) || []).length) : '' }),
};

function fixSlashes(body) {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\') {                                   // escape sequence
      const nx = body[i + 1];
      out += nx === '/' ? '\\x2F' : c + (nx === undefined ? '' : nx);
      i++;
      continue;
    }
    if (c === '/' && (body[i + 1] === '/' || body[i - 1] === '/')) { out += '\\x2F'; continue; }
    out += c;
  }
  return out;
}

for (const t of acorn.tokenizer(src, opts)) {
  const kind = t.type.label;
  if (kind !== 'string' && kind !== 'template' && kind !== 'regexp') continue;
  const raw = src.slice(t.start, t.end);
  if (!raw.includes('/')) continue;
  let rep;
  if (kind === 'regexp') {
    const last = raw.lastIndexOf('/');                 // keep the two delimiters and the flags
    rep = '/' + fixSlashes(raw.slice(1, last)) + raw.slice(last);
  } else {
    rep = fixSlashes(raw);
  }
  if (rep !== raw) edits.push({ start: t.start, end: t.end, rep });
}

edits.sort((a, b) => b.start - a.start);
let out = src;
for (const e of edits) out = out.slice(0, e.start) + e.rep + out.slice(e.end);

acorn.parse(out, { ecmaVersion: 2022 });               // must still be valid JavaScript
if (out.includes('//')) throw new Error('"//" still present after hardening');
process.stdout.write(out);
