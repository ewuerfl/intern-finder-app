"""Daily discovery: check ~40,000 company job boards and remember which ones currently post internships.

Company lists: ext/*_companies.json (from github.com/Feashliaa/job-board-aggregator, MIT).
Writes discovered.json: [[kind, id, company, last_seen_unix], ...] — boards.py adds these to every 3-hour sweep.
A board stays on the list for 30 days after it last had an internship.
"""
import json, os, re, time, threading, urllib.request
from concurrent.futures import ThreadPoolExecutor
import ats

def pretty(slug):
    s = re.sub(r'[-_]+', ' ', slug).strip()
    s = re.sub(r'\b(careers?|jobs|inc|llc|us|usa|hq)\b$', '', s, flags=re.I).strip() or slug
    return ' '.join(w if w.isupper() else w.capitalize() for w in s.split())

def load_lists():
    boards = []
    L = lambda f: json.load(open(f'ext/{f}_companies.json')) if os.path.exists(f'ext/{f}_companies.json') else []
    boards += [('gh', x, pretty(x)) for x in L('greenhouse')]
    boards += [('lever', x, pretty(x)) for x in L('lever')]
    boards += [('ashby', x, pretty(x)) for x in L('ashby')]
    boards += [('bamboo', x, pretty(x)) for x in L('bamboohr')]
    for x in L('workday'):
        p = x.split('|')
        if len(p) == 3:
            co, wd, site = p
            wd = wd if wd.startswith('wd') else 'wd' + wd
            boards.append(('wd', f'{co}.{wd}.myworkdayjobs.com|{co}|{site}', pretty(co)))
    return boards

def gh_name(token):
    try:
        with urllib.request.urlopen(urllib.request.Request(f'https://boards-api.greenhouse.io/v1/boards/{token}', headers=ats.UA), timeout=15) as r:
            return json.loads(r.read()).get('name') or None
    except Exception:
        return None

def main():
    t0 = time.time()
    known = {(b[0], b[1]) for b in json.load(open('boards.json'))} if os.path.exists('boards.json') else set()
    prev = {(d[0], d[1]): d for d in (json.load(open('discovered.json')) if os.path.exists('discovered.json') else [])}
    todo = [b for b in load_lists() if (b[0], b[1]) not in known]
    ats.WD_SLOTS = threading.Semaphore(12)
    hits, done = {}, 0
    def work(b):
        rows, err, _ = ats.sweep(b)
        return b, rows
    with ThreadPoolExecutor(max_workers=48) as ex:
        for b, rows in ex.map(work, todo):
            done += 1
            if rows: hits[(b[0], b[1])] = b
            if done % 2000 == 0: print(f'  checked {done}/{len(todo)} boards, {len(hits)} with internships, {time.time()-t0:.0f}s', flush=True)
    now = int(time.time())
    out = {}
    for k, d in prev.items():
        if now - d[3] < 30 * 86400: out[k] = d
    for k, b in hits.items():
        name = (prev.get(k) or [None, None, None])[2] or (gh_name(b[1]) if b[0] == 'gh' else None) or b[2]
        out[k] = [b[0], b[1], name, now]
    json.dump(sorted(out.values()), open('discovered.json', 'w'), indent=0)
    print(f'Discovery: checked {len(todo)} boards in {time.time()-t0:.0f}s; {len(hits)} posting internships now; {len(out)} on the list')

if __name__ == '__main__':
    main()
