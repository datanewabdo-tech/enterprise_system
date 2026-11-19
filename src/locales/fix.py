import re, sys

def fix_text(s: str) -> str:
    out = bytearray()
    for ch in s:
        try:
            out += ch.encode('cp1252')        # normal case
        except UnicodeEncodeError:
            if ord(ch) < 256:
                out.append(ord(ch))           # cp1252-undefined bytes: 0x81, 0x8D, 0x8F, 0x90, 0x9D
            else:
                out += ch.encode('utf-8')     # already-correct char (e.g. real Arabic), keep it
    return out.decode('utf-8', errors='replace')

# Only touch lines that actually look corrupted (contain Ã, Ø, Ù, Ú, etc. followed by a symbol)
moji = re.compile(r'[ÃØÙÚÛ][\u0080-\u00BF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013-\u203A\u20AC\u2122]')

src, dst = sys.argv[1], sys.argv[2]
with open(src, encoding='utf-8') as f, open(dst, 'w', encoding='utf-8') as g:
    for line in f:
        g.write(fix_text(line) if moji.search(line) else line)