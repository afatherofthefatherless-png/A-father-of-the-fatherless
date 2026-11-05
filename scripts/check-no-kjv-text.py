#!/usr/bin/env python3
"""Fail if Bible text, audio/video or hidden media turn up anywhere in the site except the allowed data files.

Release 11 allowlist (everything else is blocked):
  data/kjv-crosswire.json             the CrossWire KJV text; its sha256 must equal PINNED_KJV_SHA256 (and the manifest)
  data/openbible-cross-references.txt OpenBible.info cross-references (CC-BY), sha256 must equal PINNED_REFS_SHA256
  data/manifest.json                  names, sizes, sha256 and counts of the two files above
  data/README.md                      notes
Any other file under data/ fails. Any other file in the site is scanned for KJV text (8-word shingles of
read_aloud_text, one continuous stream so short verses and verse boundaries are covered), audio/video files,
embedded audio/video data URIs and long base64 runs (>= 2000 chars) that could hide audio.

The shingle reference is the local CrossWire export if present, otherwise the pinned data/kjv-crosswire.json itself.

Usage:
  python3 scripts/check-no-kjv-text.py [--kjv PATH] [--root SITE_DIR]
  python3 scripts/check-no-kjv-text.py --self-test     # passes on a copy of this tree, fails on each tampered copy
Exit code 0 = clean, 1 = problems found, 2 = setup error.
"""
import argparse, hashlib, json, os, re, shutil, sys, tempfile

N = 8
WORD = re.compile(r"[a-z]+(?:'[a-z]+)*")
B64 = re.compile(r"[A-Za-z0-9+/]{2000,}={0,2}")
MEDIA_EXT = {'.wav', '.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.flac', '.webm', '.mp4', '.mov', '.aif', '.aiff', '.caf', '.wma', '.mkv', '.avi', '.m4v'}
SKIP_DIRS = {'.git', 'node_modules'}
DEFAULT_KJV = '/workspace/kjv-crosswire/kjv-crosswire-verses.json'
KJV_FILE, REFS_FILE, MANIFEST_FILE, README_FILE = 'kjv-crosswire.json', 'openbible-cross-references.txt', 'manifest.json', 'README.md'
# Pinned: change only together with js/kjv/text-source.js TEXT_SHA256 and data/manifest.json.
PINNED_KJV_SHA256 = '0641311bd4407628c34ce43e769c75c8a1e67b29490df207dde87a050d31c592'
PINNED_REFS_SHA256 = '203e2bc2ae11de5c9745c86504fe3e32c841ac8a59a6453dc68d34614f69769a'
PINNED = {KJV_FILE: PINNED_KJV_SHA256, REFS_FILE: PINNED_REFS_SHA256}
ALLOWED_DATA = {KJV_FILE, REFS_FILE, MANIFEST_FILE, README_FILE}

def words(text):
    return WORD.findall(text.lower().replace('\u2019', "'"))

def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''): h.update(b)
    return h.hexdigest()

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

def check_data(root):
    """The allowlist for data/: only the four files, pinned checksums, manifest agrees."""
    problems, d = [], os.path.join(root, 'data')
    if not os.path.isdir(d): return ['data/: folder missing']
    for dp, dns, fns in os.walk(d):
        for x in dns: problems.append(f'{os.path.relpath(os.path.join(dp, x), root)}/: folder not allowed under data/')
        for fn in fns:
            if dp != d or fn not in ALLOWED_DATA: problems.append(f'{os.path.relpath(os.path.join(dp, fn), root)}: file not allowed under data/ (allowed: {", ".join(sorted(ALLOWED_DATA))})')
    for fn in sorted(ALLOWED_DATA):
        if not os.path.isfile(os.path.join(d, fn)): problems.append(f'data/{fn}: missing')
    for fn, want in PINNED.items():
        p = os.path.join(d, fn)
        if os.path.isfile(p):
            got = sha256_file(p)
            if got != want: problems.append(f'data/{fn}: sha256 {got[:12]}… does not match the pinned {want[:12]}… (file modified)')
    mp = os.path.join(d, MANIFEST_FILE)
    if os.path.isfile(mp):
        try:
            files = json.load(open(mp, encoding='utf-8'))['files']
            if set(files) != set(PINNED): problems.append(f'data/manifest.json: lists {sorted(files)}, expected {sorted(PINNED)}')
            for fn, want in PINNED.items():
                e = files.get(fn) or {}
                if e.get('sha256') != want: problems.append(f'data/manifest.json: sha256 for {fn} is not the pinned value')
                p = os.path.join(d, fn)
                if os.path.isfile(p) and e.get('bytes') != os.path.getsize(p): problems.append(f'data/manifest.json: byte size for {fn} is wrong')
        except Exception as ex: problems.append(f'data/manifest.json: unreadable ({ex})')
    return problems

def scan(root, shingles):
    problems = check_data(root); files = 0
    for dp, dns, fns in os.walk(root):
        dns[:] = [x for x in dns if x not in SKIP_DIRS]
        for fn in fns:
            p = os.path.join(dp, fn); rel = os.path.relpath(p, root).replace(os.sep, '/'); files += 1
            ext = os.path.splitext(fn)[1].lower()
            if ext in MEDIA_EXT: problems.append(f'{rel}: audio/video file ({ext})'); continue
            if rel == 'data/' + KJV_FILE: continue  # the one place Bible text is allowed; locked by its pinned sha256 above
            raw = open(p, 'rb').read()
            if raw[:4] == b'RIFF' or raw[4:8] == b'ftyp' or raw[:3] == b'ID3' or raw[:4] in (b'OggS', b'fLaC', b'\x1aE\xdf\xa3'):
                problems.append(f'{rel}: looks like an audio/video file (magic bytes)'); continue
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

def self_test(kjv, root):
    """Copies this site tree (minus .git/node_modules) to a temp folder: the copy must PASS; each tampered copy must FAIL."""
    sh, _ = build_shingles(kjv)
    vs = json.load(open(kjv, encoding='utf-8'))['verses']
    sample = next(v['read_aloud_text'] for v in vs if len(words(v['read_aloud_text'])) >= 12)
    tmp = tempfile.mkdtemp(prefix='kjv-check-selftest-')
    ign = shutil.ignore_patterns(*SKIP_DIRS)
    def fresh(name):
        d = os.path.join(tmp, name); shutil.copytree(root, d, ignore=ign); return d
    def one_char(d):
        p = os.path.join(d, 'data', KJV_FILE); b = bytearray(open(p, 'rb').read())
        i = b.index(b'In the beginning') + 3; b[i] = ord('T') if b[i] != ord('T') else ord('t'); open(p, 'wb').write(bytes(b))
    cases = [
        ('one character changed in data/kjv-crosswire.json', one_char, 'does not match the pinned'),
        ('Bible text copied into another file (js/extra.js)', lambda d: open(os.path.join(d, 'js', 'extra.js'), 'w').write('const t = ' + json.dumps(sample) + ';\n'), 'KJV matches'),
        ('Bible text copied into data/README.md', lambda d: open(os.path.join(d, 'data', README_FILE), 'a').write('\n' + sample + '\n'), 'KJV matches'),
        ('extra file in data/ (data/notes.txt)', lambda d: open(os.path.join(d, 'data', 'notes.txt'), 'w').write('hello\n'), 'not allowed under data/'),
        ('copy of the kjv json under another name in data/', lambda d: shutil.copy(os.path.join(d, 'data', KJV_FILE), os.path.join(d, 'data', 'kjv-copy.json')), 'not allowed under data/'),
        ('audio file (assets/take.wav)', lambda d: open(os.path.join(d, 'assets', 'take.wav'), 'wb').write(b'RIFF\0\0\0\0WAVE'), 'audio/video file'),
        ('video file (assets/clip.mp4)', lambda d: open(os.path.join(d, 'assets', 'clip.mp4'), 'wb').write(b'\0\0\0\x18ftypmp42'), 'audio/video file'),
        ('audio renamed (assets/x.bin, RIFF bytes)', lambda d: open(os.path.join(d, 'assets', 'x.bin'), 'wb').write(b'RIFF\0\0\0\0WAVE'), 'magic bytes'),
        ('audio as data URI + base64 in index.html', lambda d: open(os.path.join(d, 'index.html'), 'a').write('<audio src="data:' + 'audio/wav;base64,' + 'QUJD' * 600 + '">'), 'base64'),
        ('refs file modified', lambda d: open(os.path.join(d, 'data', REFS_FILE), 'a').write('Gen.1.1\tGen.1.2\t1\n'), 'does not match the pinned'),
    ]
    ok_all = True
    try:
        p0, n0 = scan(fresh('clean'), sh)
        good = not p0; ok_all &= good
        print(f"  {'ok  ' if good else 'BAD '} correct tree passes ({n0} files)" + ('' if good else ': ' + '; '.join(p0)))
        for i, (name, mutate, expect) in enumerate(cases):
            d = fresh(f'case{i}'); mutate(d); p, _ = scan(d, sh); shutil.rmtree(d)
            hit = any(expect in x for x in p); ok_all &= hit
            print(f"  {'ok  ' if hit else 'BAD '} fails on: {name} -> {p[0] if p else 'no problem reported'}")
        print('self-test:', 'PASS' if ok_all else 'FAIL')
        return 0 if ok_all else 1
    finally:
        shutil.rmtree(tmp)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--kjv', default=os.environ.get('KJV_JSON'))
    ap.add_argument('--root', default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ap.add_argument('--self-test', action='store_true')
    a = ap.parse_args()
    kjv = a.kjv or (DEFAULT_KJV if os.path.exists(DEFAULT_KJV) else os.path.join(a.root, 'data', KJV_FILE))
    if not os.path.exists(kjv): print(f'KJV reference file not found: {kjv} (set --kjv or KJV_JSON)'); return 2
    if kjv.endswith(os.path.join('data', KJV_FILE)) and sha256_file(kjv) != PINNED_KJV_SHA256:
        print(f'{kjv} does not match its pinned sha256, so it cannot be the reference; FAIL'); return 1
    if a.self_test: return self_test(kjv, a.root)
    sh, nv = build_shingles(kjv)
    problems, files = scan(a.root, sh)
    print(f'Built {len(sh)} 8-word shingles from {nv} verses ({kjv}); scanned {files} files under {a.root}')
    if problems:
        print('FAIL'); [print('  ' + p) for p in problems]; return 1
    print('PASS: data/ holds only the 4 allowed files with pinned checksums; no KJV text elsewhere, no audio/video, no large base64'); return 0

if __name__ == '__main__':
    sys.exit(main())
