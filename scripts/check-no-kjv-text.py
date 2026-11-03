#!/usr/bin/env python3
"""Fail if any file under the site contains KJV verse text or embedded audio.

At check time it builds 8-word shingles from read_aloud_text in a LOCAL CrossWire export
(never stored in this repo) as one continuous stream, so short verses and verse boundaries are covered.
It then scans every file under the site. It also flags audio/video files, embedded audio/video data URIs, and
long base64 runs (>= 2000 chars) that could hide audio.

Usage:
  python3 scripts/check-no-kjv-text.py [--kjv PATH] [--root SITE_DIR] [--skip-data]
  python3 scripts/check-no-kjv-text.py --self-test
Every file is scanned by default, data/ included. If you keep your own text file in data/ (gitignored,
never pushed), pass --skip-data to leave that folder out. Exit code 0 = clean, 1 = problems found, 2 = setup error.
"""
import argparse, json, os, re, shutil, sys, tempfile

N = 8
WORD = re.compile(r"[a-z]+(?:'[a-z]+)*")
B64 = re.compile(r"[A-Za-z0-9+/]{2000,}={0,2}")
MEDIA_EXT = {'.wav', '.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.flac', '.webm', '.mp4', '.mov', '.aif', '.aiff', '.caf', '.wma'}
SKIP_DIRS = {'.git', 'node_modules'}
DEFAULT_KJV = '/workspace/kjv-crosswire/kjv-crosswire-verses.json'

def words(text):
    return WORD.findall(text.lower().replace('\u2019', "'"))

def build_shingles(kjv_path):
    d = json.load(open(kjv_path, encoding='utf-8'))
    verses = d['verses'] if isinstance(d, dict) else d
    stream, owner = [], []
    for v in verses:
        w = words(v.get('read_aloud_text') or '')
        stream += w; owner += [v.get('id')] * len(w)
    sh = {}
    for i in range(len(stream) - N + 1):
        sh.setdefault(hash(tuple(stream[i:i + N])), owner[i])
    return sh, len(verses)

def scan(root, shingles, include_data=True):
    problems = []; files = 0
    for dp, dns, fns in os.walk(root):
        rel_dir = os.path.relpath(dp, root)
        dns[:] = [d for d in dns if d not in SKIP_DIRS and (include_data or not (rel_dir == '.' and d == 'data'))]
        for fn in fns:
            p = os.path.join(dp, fn); rel = os.path.relpath(p, root); files += 1
            ext = os.path.splitext(fn)[1].lower()
            if ext in MEDIA_EXT: problems.append(f'{rel}: audio/video file ({ext})'); continue
            raw = open(p, 'rb').read()
            text = raw.decode('utf-8', errors='replace')
            if re.search(r'data:(audio|video)/', text, re.I): problems.append(f'{rel}: embedded media data URI')
            m = B64.search(text)
            if m: problems.append(f'{rel}: base64 run of {len(m.group(0))} chars at offset {m.start()} (possible embedded audio)')
            w = words(text); hits = []
            for i in range(len(w) - N + 1):
                vid = shingles.get(hash(tuple(w[i:i + N])))
                if vid: hits.append((i, vid))
            if hits:
                ids = sorted({v for _, v in hits})
                problems.append(f'{rel}: {len(hits)} 8-word KJV matches (verses e.g. {", ".join(ids[:5])})')
    return problems, files

def self_test(kjv):
    sh, _ = build_shingles(kjv)
    d = json.load(open(kjv, encoding='utf-8')); vs = d['verses'] if isinstance(d, dict) else d
    sample = next(v['read_aloud_text'] for v in vs if len(words(v['read_aloud_text'])) >= 12)
    tmp = tempfile.mkdtemp(prefix='kjv-check-selftest-')  # outside the site; deleted afterwards
    try:
        clean = os.path.join(tmp, 'clean'); os.makedirs(clean)
        open(os.path.join(clean, 'a.js'), 'w').write("const t = 'Sample verse one. Sample verse two.';\n")
        p1, _ = scan(clean, sh)
        dirty = os.path.join(tmp, 'dirty'); os.makedirs(dirty)
        open(os.path.join(dirty, 'b.js'), 'w').write('const t = ' + json.dumps(sample.upper()) + ';\n')
        open(os.path.join(dirty, 'c.html'), 'w').write('<audio src="data:' + 'audio/wav;base64,' + 'QUJD' * 600 + '">')
        open(os.path.join(dirty, 'x.wav'), 'wb').write(b'RIFF')
        p2, _ = scan(dirty, sh)
        ok = (not p1) and any('KJV matches' in p for p in p2) and any('base64' in p for p in p2) and any('media data URI' in p for p in p2) and any('x.wav' in p for p in p2)
        print('self-test:', 'PASS' if ok else 'FAIL'); [print('  ', p) for p in p1 + p2]
        return 0 if ok else 1
    finally:
        shutil.rmtree(tmp)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--kjv', default=os.environ.get('KJV_JSON', DEFAULT_KJV))
    ap.add_argument('--root', default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ap.add_argument('--skip-data', action='store_true')
    ap.add_argument('--self-test', action='store_true')
    a = ap.parse_args()
    if not os.path.exists(a.kjv): print(f'KJV reference file not found: {a.kjv} (set --kjv or KJV_JSON)'); return 2
    if a.self_test: return self_test(a.kjv)
    sh, nv = build_shingles(a.kjv)
    problems, files = scan(a.root, sh, not a.skip_data)
    print(f'Built {len(sh)} 8-word shingles from {nv} verses; scanned {files} files under {a.root}' + (' (data/ skipped)' if a.skip_data else ''))
    if problems:
        print('FAIL'); [print('  ' + p) for p in problems]; return 1
    print('PASS: no KJV text, no audio, no large base64 found'); return 0

if __name__ == '__main__':
    sys.exit(main())
