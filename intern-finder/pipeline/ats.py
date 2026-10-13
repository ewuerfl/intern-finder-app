"""Sweep company job boards through their public job feeds and keep the internships.

Reads boards.json  [[kind, id, company], ...]  kinds: gh (Greenhouse), lever, ashby, wd (Workday "host|tenant|site"), sr (SmartRecruiters)
Writes ats.json    [[company, title, location, [terms], url, posted_unix], ...]

Runs inside the GitHub Action (which has normal internet access). Boards that fail or 404 are skipped quietly.
"""
import json, re, time, sys, datetime, collections, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

UA = {'User-Agent': 'Mozilla/5.0 (InternFinder; +https://intern-finder-xi.vercel.app)', 'Accept': 'application/json'}
INTERN = re.compile(r'\b(intern|interns|internship|internships|co-?op|coop|summer analyst|summer associate|apprentice(ship)?|student (worker|assistant|trainee)|externship|fellowship program)\b', re.I)
NOT_INTERN = re.compile(r'\b(internal|international|internist)\b(?!.*\bintern(ship)?\b)', re.I)
SENIOR = re.compile(r'\b(senior|sr\.|staff|principal|director|head of|vice president|vp)\b|\b(manager|coordinator|recruiter|specialist|lead|partner)\b.*\b(internship|intern|early careers?|campus|university) (program|recruit)|\b(internship|intern|campus|university|early careers?) (program|recruiting) (manager|coordinator|lead|specialist|partner)', re.I)
NOW = time.time()
YEAR = datetime.date.today().year

def get(url, data=None, timeout=20, extra=None):
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None,
                                 headers={**UA, **({'Content-Type': 'application/json'} if data is not None else {}), **(extra or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8', 'replace'))

def ts(v):
    if not v: return NOW - 3 * 86400
    if isinstance(v, (int, float)): return v / 1000 if v > 1e11 else v
    try: return datetime.datetime.fromisoformat(str(v).replace('Z', '+00:00')).timestamp()
    except Exception: return NOW - 3 * 86400

def workday_posted(s):
    # "Posted Today", "Posted Yesterday", "Posted 3 Days Ago", "Posted 30+ Days Ago"
    s = (s or '').lower()
    if 'today' in s: return NOW
    if 'yesterday' in s: return NOW - 86400
    m = re.search(r'(\d+)', s)
    return NOW - int(m.group(1)) * 86400 if m else NOW - 3 * 86400

def terms_of(title):
    t = title.lower()
    out = []
    for season in ('spring', 'summer', 'fall', 'winter'):
        for m in re.finditer(season + r"\W{0,3}(?:'|20)?(\d{2})\b", t):
            out.append(f'{season.title()} 20{m.group(1)}')
        if season in t and not any(o.startswith(season.title()) for o in out):
            yrs = re.findall(r'\b(20\d\d)\b', t)
            out.append(f'{season.title()} {yrs[0] if yrs else (YEAR + 1 if season in ("spring", "summer") else YEAR)}')
    if not out:
        yrs = re.findall(r'\b(20\d\d)\b', t)
        y = int(yrs[0]) if yrs else YEAR + 1
        out = [f'Summer {y}']
    return sorted(set(out))

def keep(title, terms):
    if not INTERN.search(title) or NOT_INTERN.search(title) or SENIOR.search(title):
        return False
    # drop terms that have already passed (e.g. Summer 2026 once it's fall 2026)
    def future(term):
        s, y = term.split(); y = int(y)
        end = {'Spring': 5, 'Summer': 8, 'Fall': 12, 'Winter': 2}[s]
        return (y, end) >= (datetime.date.today().year, datetime.date.today().month)
    return any(future(t) for t in terms)

def gh(token, co):
    j = get(f'https://boards-api.greenhouse.io/v1/boards/{token}/jobs')
    for x in j.get('jobs', []):
        yield co, x.get('title', ''), (x.get('location') or {}).get('name', ''), x.get('absolute_url', ''), ts(x.get('first_published') or x.get('updated_at'))

def lever(slug, co):
    j = get(f'https://api.lever.co/v0/postings/{slug}?mode=json')
    for x in j if isinstance(j, list) else []:
        c = x.get('categories') or {}
        yield co, x.get('text', ''), c.get('location', '') or ', '.join(c.get('allLocations') or []), x.get('hostedUrl', ''), ts(x.get('createdAt'))

def ashby(org, co):
    j = get(f'https://api.ashbyhq.com/posting-api/job-board/{org}')
    for x in j.get('jobs', []):
        yield co, x.get('title', ''), x.get('location', ''), x.get('jobUrl', ''), ts(x.get('publishedAt'))

def wd(spec, co):
    host, tenant, site = spec.split('|')
    seen = set()
    for q in ('intern', 'co-op', 'internship'):
        for offset in range(0, 400, 20):          # big companies can have hundreds of intern postings
            j = get(f'https://{host}/wday/cxs/{tenant}/{site}/jobs', {'appliedFacets': {}, 'limit': 20, 'offset': offset, 'searchText': q},
                    extra={'Origin': f'https://{host}', 'Referer': f'https://{host}/{site}'})
            posts = j.get('jobPostings', [])
            fresh = 0
            for x in posts:
                path = x.get('externalPath', '')
                if path in seen: continue
                seen.add(path); fresh += 1
                yield co, x.get('title', ''), x.get('locationsText', ''), f"https://{host}/en-US/{site}{path}", workday_posted(x.get('postedOn'))
            if len(posts) < 20 or not any(INTERN.search(x.get('title', '')) for x in posts): break
            if not fresh: break
        if q == 'intern' and len(seen) < 20: break   # small board: one search found everything

def sr(company, co):
  for off in (0, 100, 200):
    j = get(f'https://api.smartrecruiters.com/v1/companies/{company}/postings?q=intern&limit=100&offset={off}')
    rows = j.get('content', [])
    for x in rows:
        l = x.get('location') or {}
        loc = ', '.join(v for v in (l.get('city'), l.get('region'), l.get('country', '').upper()) if v)
        yield co, x.get('name', ''), loc, f"https://jobs.smartrecruiters.com/{company}/{x.get('id')}", ts(x.get('releasedDate'))
    if len(rows) < 100: break

def bamboo(slug, co):
    j = get(f'https://{slug}.bamboohr.com/careers/list')
    for x in j.get('result', []) if isinstance(j, dict) else []:
        l = x.get('location') or {}
        loc = ', '.join(v for v in (l.get('city'), l.get('state')) if v) if isinstance(l, dict) else str(l or '')
        yield co, x.get('jobOpeningName', ''), loc, f"https://{slug}.bamboohr.com/careers/{x.get('id')}", NOW - 3 * 86400

def workable(acct, co):
    j = get(f'https://apply.workable.com/api/v1/widget/accounts/{acct}')
    name = (j.get('name') if isinstance(j, dict) else None) or co
    for x in (j.get('jobs') or []) if isinstance(j, dict) else []:
        loc = ', '.join(v for v in (x.get('city'), x.get('state'), x.get('country')) if v)
        yield name, x.get('title', ''), loc, x.get('url') or x.get('application_url') or '', ts(x.get('published_on') or x.get('created_at'))

def recruitee(slug, co):
    j = get(f'https://{slug}.recruitee.com/api/offers/')
    for x in (j.get('offers') or []) if isinstance(j, dict) else []:
        loc = ', '.join(v for v in (x.get('city'), x.get('country')) if v) or x.get('location') or ''
        yield x.get('company_name') or co, x.get('title', ''), loc, x.get('careers_url') or x.get('url') or '', ts(x.get('published_at'))

def breezy(slug, co):
    j = get(f'https://{slug}.breezy.hr/json')
    for x in j if isinstance(j, list) else []:
        loc = (x.get('location') or {}).get('name', '') if isinstance(x.get('location'), dict) else ''
        yield co, x.get('name', ''), loc, x.get('url', ''), ts(x.get('published_date'))

def rippling(slug, co):
    try:
        j = get(f'https://api.rippling.com/platform/api/ats/v1/board/{slug}/jobs')
        rows = j if isinstance(j, list) else []
    except urllib.error.HTTPError:
        j = get(f'https://ats.rippling.com/api/v2/board/{slug}/jobs?page=0&pageSize=100')
        rows = (j.get('items') or []) if isinstance(j, dict) else []
    for x in rows:
        loc = (x.get('workLocation') or {}).get('label', '') if isinstance(x.get('workLocation'), dict) else \
              ', '.join(l.get('name', '') for l in (x.get('locations') or []) if isinstance(l, dict))
        url = x.get('url') or f"https://ats.rippling.com/{slug}/jobs/{x.get('uuid') or x.get('id')}"
        yield co, x.get('name', ''), loc, url, NOW - 3 * 86400

def oracle(spec, co):
    host, site = spec.split('|')
    q = (f'https://{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true'
         f'&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber={site},limit=100,keyword=intern,sortBy=POSTING_DATES_DESC')
    j = get(q)
    for blk in (j.get('items') or []) if isinstance(j, dict) else []:
        for x in blk.get('requisitionList') or []:
            yield co, x.get('Title', ''), x.get('PrimaryLocation', ''), \
                  f"https://{host}/hcmUI/CandidateExperience/en/sites/{site}/job/{x.get('Id')}", ts(x.get('PostedDate'))

# ---- Company career sites that aren't on the common job boards ----
def jibe(host, co):
    # iCIMS "Jibe" career sites, e.g. careers.amd.com
    seen = set()
    for q in ('intern', 'co-op'):
        for page in range(1, 11):
            j = get(f'https://{host}/api/jobs?keywords={q}&page={page}&limit=100&sortBy=relevance')
            rows = j.get('jobs') or []
            for w in rows:
                x = w.get('data') or w
                rid = str(x.get('req_id') or x.get('slug') or '')
                if not rid or rid in seen: continue
                seen.add(rid)
                loc = x.get('full_location') or x.get('location_name') or ', '.join(v for v in (x.get('city'), x.get('state'), x.get('country')) if v)
                yield co, x.get('title', ''), loc, f"https://{host}/careers-home/jobs/{x.get('slug') or rid}?lang=en-us", ts(x.get('posted_date') or x.get('create_date'))
            if len(rows) < 100: break

def eightfold(spec, co):
    # Eightfold career sites, e.g. qualcomm.eightfold.ai (spec "host|domain")
    host, dom = spec.split('|')
    seen = set()
    for q in ('intern', 'co-op'):
        for start in range(0, 500, 10):
            j = get(f'https://{host}/api/apply/v2/jobs?domain={dom}&query={q}&start={start}&num=10&sort_by=relevance')
            rows = j.get('positions') or []
            for x in rows:
                if x.get('id') in seen: continue
                seen.add(x.get('id'))
                url = x.get('canonicalPositionUrl') or f"https://{host}/careers?pid={x.get('id')}&domain={dom}"
                yield co, x.get('name', ''), x.get('location') or ', '.join(x.get('locations') or []), url, ts(x.get('t_create'))
            if len(rows) < 10 or not any(INTERN.search(x.get('name', '')) for x in rows): break

def phenom(host, co):
    # Phenom People career sites (many large companies): the page's own search widget
    seen = set()
    for q in ('intern', 'co-op'):
        for frm in range(0, 500, 50):
            body = {'lang': 'en_us', 'deviceType': 'desktop', 'country': 'us', 'pageName': 'search-results', 'ddoKey': 'refineSearch',
                    'sortBy': '', 'subsearch': '', 'from': frm, 'jobs': True, 'counts': False, 'all_fields': [], 'size': 50,
                    'clearAll': False, 'jdsource': 'facets', 'isSliderEnable': False, 'keywords': q, 'global': True,
                    'selected_fields': {}, 'locationData': {}}
            j = get(f'https://{host}/widgets', body, extra={'Origin': f'https://{host}', 'Referer': f'https://{host}/'})
            rows = (((j.get('refineSearch') or {}).get('data') or {}).get('jobs')) or []
            for x in rows:
                jid = x.get('jobId') or x.get('jobSeqNo')
                if not jid or jid in seen: continue
                seen.add(jid)
                loc = x.get('location') or ', '.join(v for v in (x.get('city'), x.get('state'), x.get('country')) if v)
                url = x.get('applyUrl') if False else f"https://{host}/job/{jid}"
                yield co, x.get('title', ''), loc, url, ts(x.get('postedDate') or x.get('dateCreated'))
            if len(rows) < 50: break

def _amzdate(v):
    try: return datetime.datetime.strptime(v, '%B %d, %Y').timestamp()
    except Exception: return NOW - 3 * 86400

def amazon(_, co):
    seen = set()
    for q in ('intern', 'internship', 'co-op'):
        for off in range(0, 1000, 100):
            j = get(f'https://www.amazon.jobs/en/search.json?base_query={q}&result_limit=100&offset={off}&sort=recent')
            rows = j.get('jobs') or []
            for x in rows:
                jid = x.get('id_icims') or x.get('id')
                if jid in seen: continue
                seen.add(jid)
                yield 'Amazon', x.get('title', ''), x.get('normalized_location') or x.get('location', ''), \
                      'https://www.amazon.jobs' + (x.get('job_path') or f'/en/jobs/{jid}'), _amzdate(x.get('posted_date'))
            if len(rows) < 100: break

def icims(host, co):
    # iCIMS classic career portals (careers-<company>.icims.com): read the search results page
    import html as _h
    seen = set()
    for pr in range(0, 10):
        req = urllib.request.Request(f'https://{host}/jobs/search?ss=1&searchKeyword=intern&pr={pr}&in_iframe=1', headers={'User-Agent': UA['User-Agent']})
        with urllib.request.urlopen(req, timeout=20) as r:
            page = r.read().decode('utf-8', 'replace')
        rows = re.findall(r'<a[^>]+href="(https://[^"]+/jobs/(\d+)/[^"]+/job[^"]*)"[^>]*>\s*(?:<span[^>]*>[^<]*</span>\s*)?<h[23][^>]*>\s*([^<]+?)\s*</h', page)
        if not rows:
            rows = re.findall(r'href="(https://[^"]+/jobs/(\d+)/[^"/]+/job)[^"]*"[^>]*title="([^"]+)"', page)
        new = 0
        for url, jid, title in rows:
            if jid in seen: continue
            seen.add(jid); new += 1
            blk = page[page.find(url):page.find(url) + 3000]
            m = re.search(r'(?:Location|header left)[^>]*>\s*(?:<[^>]+>\s*)*([A-Z][^<]{2,80})<', blk)
            yield co, _h.unescape(title), _h.unescape(m.group(1).strip()) if m else '', url.split('?')[0], NOW - 3 * 86400
        if not new: break

KINDS = {'gh': gh, 'lever': lever, 'ashby': ashby, 'wd': wd, 'sr': sr, 'bamboo': bamboo,
         'workable': workable, 'recruitee': recruitee, 'breezy': breezy, 'rippling': rippling, 'oracle': oracle,
         'jibe': jibe, 'eightfold': eightfold, 'phenom': phenom, 'amazon': amazon, 'icims': icims}

import threading
WD_SLOTS = threading.Semaphore(10)   # Workday rate-limits hard; read at most 6 Workday boards at a time

def _transient(e):
    # Worth retrying / keeping last results: timeouts, rate limits, server errors, dropped connections.
    if isinstance(e, urllib.error.HTTPError):
        return e.code in (408, 425, 429) or e.code >= 500
    return True

def _sweep_once(board):
    kind, ident, co = board
    out = []
    for co_, title, loc, url, posted in KINDS[kind](ident, co):
        if not title or not url: continue
        terms = terms_of(title)
        if keep(title, terms):
            out.append([co_, title.strip(), (loc or '').strip() or 'See posting', terms, url, int(posted)])
    return out

def sweep(board):
    """Returns (rows, error_text, transient). Retries once after a short pause on temporary failures."""
    kind = board[0]
    for attempt in (1, 2):
        try:
            if kind == 'wd':
                with WD_SLOTS:
                    return _sweep_once(board), None, False
            return _sweep_once(board), None, False
        except Exception as e:
            if attempt == 1 and _transient(e):
                time.sleep(3)
                continue
            return [], f'{board[0]}:{board[1]} {type(e).__name__}', _transient(e)

def previous_rows():
    """Board -> its internships from the last published data, so a board that times out keeps its jobs."""
    from boards import board_of
    out = {}
    try:
        for r in json.load(open('../public/data.json'))['listings']:
            b = board_of(r[8])
            if b: out.setdefault(b, []).append([r[0], r[1], (r[4] or ['See posting'])[0], r[3], r[8], int(r[7])])
    except Exception:
        pass
    return out

def main():
    boards = json.load(open('boards.json'))
    # Full sweep every 3 hours (or when run by hand); other hours reuse the last sweep to save GitHub minutes.
    import os
    hour = datetime.datetime.utcnow().hour
    if os.environ.get('GITHUB_EVENT_NAME') == 'schedule' and hour % 3 != 0 and os.path.exists('../public/data.json'):
        prev = previous_rows(); rows = [r for v in prev.values() for r in v]
        json.dump(rows, open('ats.json', 'w'))
        print(f'ATS sweep skipped this hour (runs every 3h); reused {len(rows)} listings from last sweep')
        return
    t0 = time.time()
    found, errors, kept = [], [], 0
    prev = previous_rows()
    stats = collections.defaultdict(lambda: [0, 0, 0])      # kind -> boards, internships, failures
    late = 0
    def run(b):
        if time.time() - t0 > 780: return [], 'late', True   # out of time: keep this board's jobs from last run
        return sweep(b)
    # slow, many-page boards first so they don't run into the time limit
    order = {'amazon': 0, 'jibe': 1, 'phenom': 1, 'eightfold': 1, 'wd': 2, 'oracle': 2, 'icims': 3}
    boards.sort(key=lambda b: order.get(b[0], 5))
    with ThreadPoolExecutor(max_workers=32) as ex:
        for board, (rows, err, transient) in zip(boards, ex.map(run, boards)):
            st = stats[board[0]]; st[0] += 1; st[1] += len(rows)
            if err == 'late': late += 1
            elif err: st[2] += 1
            if err:
                errors.append(err)
                if transient:                       # temporary failure: keep what this board had last time
                    old = prev.get((board[0], board[1]), [])
                    found += old; kept += len(old)
                continue
            found += rows
    seen, uniq = set(), []
    for r in found:
        if r[4] in seen: continue
        seen.add(r[4]); uniq.append(r)
    json.dump(uniq, open('ats.json', 'w'))
    print(f'ATS sweep: {len(boards)} boards, {len(uniq)} internships, {len(errors)} boards failed '
          f'({kept} listings kept from last run), {late} not reached in time, {time.time() - t0:.0f}s')
    print('::notice title=Job-board sweep::' + f'{len(uniq)} internships, {late} boards not reached; ' +
          '; '.join(f'{k}: {v[1]} jobs from {v[0]} boards ({v[2]} failed)' for k, v in sorted(stats.items())))

if __name__ == '__main__':
    main()
