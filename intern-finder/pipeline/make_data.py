"""Turn the build output (app/data.js) into ../public/data.json for the website:
ratings, AI summaries, clean company names and company web domains for logos."""
import json, os, re, collections, urllib.parse
from tiers import rate

d = open('app/data.js').read()
L = json.loads(d[len('window.LISTINGS='):d.index(';window.LISTINGS_ASOF')])
asof = int(re.search(r'LISTINGS_ASOF=(\d+)', d).group(1))
S = json.load(open('summaries.json')) if os.path.exists('summaries.json') else {}

# Clean names + known domains (companies.tsv: raw name, display name, domain)
NAME, DOM = {}, {}
for line in open('companies.tsv'):
    if line.startswith('#') or not line.strip():
        continue
    raw, disp, dom = (line.rstrip('\n').split('\t') + ['', ''])[:3]
    NAME[raw] = disp or raw
    if dom:
        DOM[disp or raw] = dom

ATS = re.compile(r'greenhouse|ashbyhq|lever\.co|workable|rippling|smartrecruiters|myworkday|oraclecloud|icims|teamworkonline|'
                 r'successfactors|taleo|eightfold|jobvite|applytojob|bamboohr|pinpointhq|breezy|recruitee|paylocity|ultipro|'
                 r'adp\.com|dayforce|avature|brassring|wellfound|linkedin|indeed|joinhandshake|usajobs')

def guess_domain(co, urls):
    """Use the posting's own site when its domain clearly matches the company name."""
    toks = [t for t in re.split(r'[^a-z0-9]+', co.lower()) if len(t) >= 3]
    for u in urls:
        h = urllib.parse.urlparse(u).hostname or ''
        if ATS.search(h) or re.search(r'careers|jobs|lifeat|inside|early', h):
            continue
        parts = h.split('.')
        if len(parts) < 2:
            continue
        base = '.'.join(parts[-3:]) if len(parts) >= 3 and parts[-2] in ('co', 'com', 'ac', 'gov') and parts[-1] != 'com' else '.'.join(parts[-2:])
        sld = base.split('.')[0]
        if toks and (any(t in sld for t in toks) or sld == ''.join(toks)):
            return base
    return ''

# Same job listed by two sources under slightly different names (e.g. "Disney" vs "The Walt Disney Company"): keep one
def _norm_co(c):
    c = re.sub(r'^the\s+|[,.]|\s+(company|corporation|corp|inc|llc|ltd|group|co)$', '', c.lower().strip())
    return c.replace('walt disney', 'disney').strip()
_seen, _keep = set(), []
for r in L:
    r[0] = NAME.get(r[0], r[0])
    k = (_norm_co(r[0]), re.sub(r'[^a-z0-9]+', '', r[1].lower()), (r[4][0] if r[4] else '').lower()[:12])
    if k in _seen: continue
    _seen.add(k); _keep.append(r)
L[:] = _keep

# Same job posting reached through different links (e.g. amazon.jobs/en/jobs/123/title vs amazon.jobs/jobs/123/apply):
# merge into one entry, keeping pay, locations and the earliest date from all copies.
def _job_key(u):
    p = urllib.parse.urlparse(u.strip()); h = (p.hostname or '').lower().replace('www.', '')
    q = urllib.parse.parse_qs(p.query)
    for k in ('gh_jid', 'jobId', 'jobid', 'job_id', 'token', 'id', 'jid'):
        if k in q and re.search(r'\d{4,}', q[k][0]):
            return (h.split('.')[-2] if '.' in h else h, re.sub(r'\D', '', q[k][0]))
    ids = re.findall(r'(\d{5,})', p.path.lower())
    if ids: return (h, ids[-1])
    return (h, p.path.rstrip('/').lower())
_groups = collections.OrderedDict()
for r in L:
    _groups.setdefault(_job_key(r[8]), []).append(r)
_merged = []
for rows in _groups.values():
    if len(rows) == 1:
        _merged.append(rows[0]); continue
    best = max(rows, key=lambda r: (r[8] in S, bool(r[9]), '/apply' not in r[8], len(r[1])))
    for r in rows:
        if r is best: continue
        if not best[9] and r[9]: best[9] = r[9]
        for loc in r[4]:
            if loc not in best[4]: best[4].append(loc)
        for term in r[3]:
            if term not in best[3]: best[3].append(term)
        for dg in r[5]:
            if dg not in best[5]: best[5].append(dg)
        if r[7] and (not best[7] or r[7] < best[7]): best[7] = r[7]
        if r[8] in S and best[8] not in S: S[best[8]] = S[r[8]]
    _merged.append(best)
print(f'merged {len(L) - len(_merged)} duplicate postings that share a job link')
L[:] = _merged

urls = collections.defaultdict(list)
for r in L:
    r[0] = NAME.get(r[0], r[0])
    urls[r[0]].append(r[8])
    p = r[9] or (S.get(r[8]) or {}).get('p', '')
    r[12:] = list(rate(r[0], p))

domains = {}
for co, us in urls.items():
    dm = DOM.get(co) or guess_domain(co, us)
    if dm:
        domains[co] = dm

# Keep the first-seen date for postings we already had, so dates don't drift between runs
OUT = '../public/data.json'
prev = {}
try:
    prev = json.load(open(OUT))
    seen = {r[8]: r[7] for r in prev.get('listings', [])}
    for r in L:
        if r[8] in seen:
            r[7] = seen[r[8]]
except Exception:
    pass

# ---------- Quality filters ----------
import datetime, time as _time, urllib.request
from concurrent.futures import ThreadPoolExecutor
_now = _time.time()
FEED = re.compile(r'greenhouse|lever\.co|ashbyhq|myworkdayjobs|smartrecruiters|workable|rippling|oraclecloud|recruitee|breezy|bamboohr')
JUNK = re.compile(r'high school|commission[- ]only|brand ambassador|campus ambassador|independent contractor|\bmlm\b|door[- ]to[- ]door|unpaid volunteer', re.I)
UNPAID = re.compile(r'\bunpaid\b|\bvolunteer\b|for (academic )?credit( only)?\b|no (compensation|pay)\b|not paid', re.I)
def _past(terms):
    end = {'Spring': 5, 'Summer': 8, 'Fall': 12, 'Winter': 2}; today = datetime.date.today()
    ts = [x.split() for x in terms if len(x.split()) == 2 and x.split()[1].isdigit()]
    return bool(ts) and all((int(y), end.get(s, 12)) < (today.year, today.month) for s, y in ts)

# Dead links: company-site links (not live job feeds) are checked every few hours; a 404/410 removes the job for 14 days.
dead = {u: ts for u, ts in (prev.get('dead') or {}).items() if _now - ts < 14 * 86400} if prev else {}
FULL = os.environ.get('GITHUB_EVENT_NAME') != 'schedule' or datetime.datetime.utcnow().hour % 3 == 0
if FULL and os.environ.get('GITHUB_ACTIONS'):
    def _check(u):
        try:
            req = urllib.request.Request(u, method='GET', headers={'User-Agent': 'Mozilla/5.0 (compatible; InternFinder link check)'})
            with urllib.request.urlopen(req, timeout=12) as r: return u, r.status
        except urllib.error.HTTPError as e: return u, e.code
        except Exception: return u, 0
    todo = [r[8] for r in L if r[10] != 'p' and not FEED.search(r[8]) and r[8] not in dead]
    with ThreadPoolExecutor(max_workers=24) as ex:
        for u, code in ex.map(_check, todo):
            if code in (404, 410): dead[u] = int(_now)
    print(f'link check: {len(todo)} company-site links checked, {len(dead)} known dead')

before = len(L); counts = collections.Counter()
keep = []
for r in L:
    while len(r) < 16: r.append('')
    text = r[1] + ' ' + (r[9] or '') + ' ' + json.dumps(S.get(r[8], ''))
    if JUNK.search(r[1]): counts['junk'] += 1; continue
    if _past(r[3]): counts['season over'] += 1; continue
    if r[8] in dead: counts['dead link'] += 1; continue
    if r[10] != 'p' and not FEED.search(r[8]) and r[7] and _now - r[7] > 120 * 86400: counts['stale list entry'] += 1; continue
    r[15] = 'u' if UNPAID.search(text) else ''
    keep.append(r)
L[:] = keep
print(f'quality filters removed {before - len(L)}: {dict(counts)}; {sum(1 for r in L if r[15]=="u")} marked unpaid')

prev_urls = {r[8] for r in prev.get('listings', [])} if prev else set()
added = [r[8] for r in L if prev_urls and r[8] not in prev_urls]
used = {r[8] for r in L}
summ = {u: v for u, v in S.items() if u in used}
if prev and prev.get('listings') == json.loads(json.dumps(L, ensure_ascii=False)) and prev.get('summaries') == summ and prev.get('domains') == domains and (prev.get('dead') or {}) == dead:
    print('No listing changes; data.json left as is')
    raise SystemExit(0)

# One listing per line keeps hourly git diffs small
dumps = lambda o: json.dumps(o, separators=(',', ':'), ensure_ascii=False)
os.makedirs('../public', exist_ok=True)
with open(OUT, 'w') as f:
    f.write('{"asof":%d,\n"added":%s,\n"dead":%s,\n"domains":%s,\n"summaries":%s,\n"listings":[\n' % (asof, dumps(added), dumps(dead), dumps(domains), dumps(summ)))
    f.write(',\n'.join(dumps(r) for r in L))
    f.write('\n]}\n')
print(f'{len(added)} new since last update; {len(L)} listings, {len(urls)} companies, {len(domains)} with a known domain, '
      f'{os.path.getsize("../public/data.json")//1024} KB')
