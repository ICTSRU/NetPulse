"""Apps Script guard: flag '//' inside JavaScript template literals.

Apps Script's HtmlService strips '//' line comments from inline scripts but does not
understand template literals, so  `https://...`  inside backticks is cut at '//',
leaving an unclosed backtick and breaking the whole page script.
"""
import re, sys

def scan(js, base_line=1):
    hits = []
    # frames: 'code' (top level / inside ${...} with a brace depth), 'tpl' (inside backticks)
    stack = [['code', 0]]
    i, n, line = 0, len(js), base_line
    while i < n:
        c = js[i]; nx = js[i + 1] if i + 1 < n else ''
        if c == '\n':
            line += 1
        top = stack[-1]
        if top[0] == 'tpl':
            if c == '\\':
                i += 2; continue
            if c == '`':
                stack.pop()
            elif c == '$' and nx == '{':
                stack.append(['code', 0]); i += 2; continue
            elif c == '/' and nx == '/':
                hits.append(line)
            i += 1; continue
        # code context
        if c == '/' and nx == '/':                       # line comment
            j = js.find('\n', i); i = n if j < 0 else j; continue
        if c == '/' and nx == '*':                       # block comment
            j = js.find('*/', i + 2); line += js[i:j].count('\n'); i = n if j < 0 else j + 2; continue
        if c in '\'"':                                   # plain string
            j = i + 1
            while j < n and js[j] != c and js[j] != '\n':
                j += 2 if js[j] == '\\' else 1
            i = j + 1; continue
        if c == '`':
            stack.append(['tpl']); i += 1; continue
        if c == '{':
            top[1] += 1
        elif c == '}':
            if len(stack) > 1 and top[1] == 0:
                stack.pop()                              # end of ${...}, back in the template
            else:
                top[1] -= 1
        i += 1
    return hits

def check(html):
    found = []
    for m in re.finditer(r'<script>(.*?)</script>', html, re.S):
        base = html[:m.start(1)].count('\n') + 1
        found += scan(m.group(1), base)
    return found

if __name__ == '__main__':
    h = open(sys.argv[1], encoding='utf-8').read()
    r = check(h)
    print('// inside template literals at lines:', r or 'none')
    sys.exit(1 if r else 0)

def harden(js):
    """Remove // and /* */ comments (string/template aware), then write every remaining '//'
    (inside strings, templates or base64 data) as '\\/\\/' — same value in JavaScript, but nothing
    an Apps Script comment stripper could cut."""
    out = []; stack = [['code', 0]]; i = 0; n = len(js)
    while i < n:
        c = js[i]; nx = js[i + 1] if i + 1 < n else ''
        top = stack[-1]
        if top[0] == 'tpl':
            if c == '\\':
                out.append(js[i:i + 2]); i += 2; continue
            if c == '`':
                stack.pop()
            elif c == '$' and nx == '{':
                stack.append(['code', 0]); out.append('${'); i += 2; continue
            out.append(c); i += 1; continue
        if c == '/' and nx == '/':                       # line comment → drop (keep newline)
            j = js.find('\n', i); i = n if j < 0 else j; continue
        if c == '/' and nx == '*':                       # block comment → drop, keep line count
            j = js.find('*/', i + 2); j = n if j < 0 else j + 2
            out.append('\n' * js[i:j].count('\n')); i = j; continue
        if c in '\'"':
            j = i + 1
            while j < n and js[j] != c and js[j] != '\n':
                j += 2 if js[j] == '\\' else 1
            out.append(js[i:j + 1]); i = j + 1; continue
        if c == '`':
            stack.append(['tpl']); out.append(c); i += 1; continue
        if c == '{':
            top[1] += 1
        elif c == '}':
            if len(stack) > 1 and top[1] == 0:
                stack.pop()
            else:
                top[1] -= 1
        out.append(c); i += 1
    res = ''.join(out)
    assert '\\//' not in res, 'unexpected \\// sequence'
    return res.replace('//', '\\/\\/')
