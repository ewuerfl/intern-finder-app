"""Find company career sites that aren't on the common job boards, so their internships get swept too.

For every company we know a web domain for (companies.tsv, the site's logo domains, the Fortune 500) and every
job link host that no sweep covers yet, try the public job-search APIs of the big career-site platforms:
  jibe       iCIMS "Jibe" sites            https://careers.amd.com/api/jobs
  phenom     Phenom People sites           https://<host>/widgets
  eightfold  Eightfold sites               https://<slug>.eightfold.ai/api/apply/v2/jobs
  wd         Workday (guessed tenant/site) https://<slug>.wdN.myworkdayjobs.com/wday/cxs/<slug>/<site>/jobs
Writes probed.json: [[kind, id, company, last_seen_unix], ...]. boards.py adds these to every sweep.
A site stays on the list for 60 days after it last answered.
"""
import json, os, re, sys, time, collections, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
import ats
from boards import board_of

UA = ats.UA

def _get(url, data=None, timeout=12, extra=None):
    return ats.get(url, data, timeout=timeout, extra=extra)

def try_jibe(host):
    try:
        j = _get(f'https://{host}/api/jobs?keywords=intern&page=1&limit=5')
        return isinstance(j, dict) and 'jobs' in j and ('totalCount' in j or 'count' in j)
    except Exception:
        return False

def try_phenom(host):
    try:
        body = {'lang': 'en_us', 'deviceType': 'desktop', 'country': 'us', 'pageName': 'search-results', 'ddoKey': 'refineSearch',
                'from': 0, 'jobs': True, 'counts': False, 'all_fields': [], 'size': 5, 'keywords': 'intern', 'global': True,
                'selected_fields': {}, 'locationData': {}, 'sortBy': '', 'subsearch': ''}
        j = _get(f'https://{host}/widgets', body, extra={'Origin': f'https://{host}', 'Referer': f'https://{host}/'})
        return isinstance(j, dict) and 'refineSearch' in j
    except Exception:
        return False

def try_rmk(host):
    try:
        req = urllib.request.Request(f'https://{host}/search/?q=intern', headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=12) as r:
            return 'jobTitle-link' in r.read(300000).decode('utf-8', 'replace')
    except Exception:
        return False

def try_radancy(host):
    try:
        req = urllib.request.Request(f'https://{host}/search-jobs/intern', headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=12) as r:
            pg = r.read(400000).decode('utf-8', 'replace')
        return bool(re.search(r'href="/job/[^"]+/\d+/\d+"', pg)) or 'talentbrew' in pg.lower()
    except Exception:
        return False

def try_eightfold(slug, dom):
    try:
        j = _get(f'https://{slug}.eightfold.ai/api/apply/v2/jobs?domain={dom}&query=intern&start=0&num=5')
        return isinstance(j, dict) and 'positions' in j and (j.get('count') or j.get('positions'))
    except Exception:
        return False

WD_DC = ('wd1', 'wd5', 'wd3', 'wd12', 'wd10', 'wd501', 'wd103', 'wd108')
def wd_sites(stem):
    S = stem.capitalize(); U = stem.upper()
    return ['External', 'Careers', f'{S}Careers', f'{S}_Careers', f'{U}', 'External_Careers', f'{S}_External', 'ExternalCareerSite']
def try_workday(stem):
    for dc in WD_DC:
        host = f'{stem}.{dc}.myworkdayjobs.com'
        try:
            urllib.request.urlopen(urllib.request.Request(f'https://{host}/', headers={'User-Agent': UA['User-Agent']}), timeout=8).close()
        except urllib.error.HTTPError:
            pass                      # host exists (Workday answers even with an error page)
        except Exception:
            continue                  # no such host in this data center
        for site in wd_sites(stem):
            try:
                j = _get(f'https://{host}/wday/cxs/{stem}/{site}/jobs', {'appliedFacets': {}, 'limit': 1, 'offset': 0, 'searchText': ''},
                         timeout=10, extra={'Origin': f'https://{host}', 'Referer': f'https://{host}/{site}'})
                if isinstance(j, dict) and 'jobPostings' in j:
                    return f'{host}|{stem}|{site}'
            except Exception:
                pass
    return None

def main():
    t0 = time.time(); now = int(t0)
    d = json.load(open('../public/data.json'))
    covered = {(b[0], b[1]) for b in json.load(open('boards.json'))} if os.path.exists('boards.json') else set()
    have_wd = {b[1].split('|')[1] for b in covered if b[0] == 'wd'}
    # company <- domain
    dom2co = {}
    for line in open('companies.tsv'):
        if line.startswith('#') or not line.strip(): continue
        raw, disp, dom = (line.rstrip('\n').split('\t') + ['', ''])[:3]
        if dom: dom2co.setdefault(dom.lower(), disp or raw)
    for co, dom in (d.get('domains') or {}).items(): dom2co.setdefault(dom.lower(), co)
    f500 = set((d.get('f500') or {}).keys())
    # job link hosts that no sweep reads yet
    hostco = collections.defaultdict(collections.Counter)
    for r in d['listings']:
        if board_of(r[8]): continue
        h = (r[8].split('/')[2] if '//' in r[8] else '').lower()
        if h and not re.search(r'linkedin|indeed|glassdoor|handshake|google\.com|usajobs|ziprecruiter|simplify', h):
            hostco[h][r[0]] += 1
    hosts = {}
    for h, c in hostco.items(): hosts[h] = c.most_common(1)[0][0]
    for dom, co in dom2co.items():
        for pre in ('careers.', 'jobs.'):
            hosts.setdefault(pre + dom, co)
    # every Fortune 500 company, even ones with no listings yet: guess its career-site hosts from its name
    import f500 as F
    for line in open('fortune500.txt', encoding='utf-8'):
        if line.startswith('#') or not line.strip(): continue
        names = [x.strip() for x in re.split(r'[=|]', line)]
        disp = names[1] if len(names) > 1 else names[0]
        for n in names[:2]:
            stem = re.sub(r'[^a-z0-9]', '', F.norm(n).replace(' and ', ''))
            if len(stem) < 2: continue
            for h in (f'careers.{stem}.com', f'jobs.{stem}.com', f'{stem}.jobs', f'www.{stem}.jobs', f'careers.{stem}.jobs'):
                hosts.setdefault(h, disp)
            dom2co.setdefault(f'{stem}.com', disp)
            f500.add(disp)
    print(f'probing {len(hosts)} career-site hosts, {len(dom2co)} company domains', flush=True)

    found = {}
    def site(hc):
        h, co = hc
        if try_jibe(h): return ('jibe', h, co)
        if try_phenom(h): return ('phenom', h, co)
        if try_rmk(h): return ('rmk', h, co)
        if try_radancy(h): return ('radancy', h, co)
        return None
    with ThreadPoolExecutor(max_workers=48) as ex:
        for res in ex.map(site, hosts.items()):
            if res: found[(res[0], res[1])] = res[2]
    print(f'  career sites: {collections.Counter(k[0] for k in found)} ({time.time()-t0:.0f}s)', flush=True)

    def ef(dc):
        dom, co = dc
        stem = dom.split('.')[0]
        return ('eightfold', f'{stem}.eightfold.ai|{dom}', co) if try_eightfold(stem, dom) else None
    with ThreadPoolExecutor(max_workers=48) as ex:
        for res in ex.map(ef, dom2co.items()):
            if res: found[(res[0], res[1])] = res[2]
    print(f'  + eightfold: {sum(1 for k in found if k[0]=="eightfold")} ({time.time()-t0:.0f}s)', flush=True)

    # Workday guesses for well-known companies we don't sweep on Workday yet
    big = [(dom, co) for dom, co in dom2co.items() if co in f500 and dom.split('.')[0] not in have_wd]
    def wdg(dc):
        dom, co = dc
        spec = try_workday(re.sub(r'[^a-z0-9]', '', dom.split('.')[0]))
        return ('wd', spec, co) if spec else None
    with ThreadPoolExecutor(max_workers=32) as ex:
        for res in ex.map(wdg, big):
            if res: found[(res[0], res[1])] = res[2]
    print(f'  + workday: {sum(1 for k in found if k[0]=="wd")} ({time.time()-t0:.0f}s)', flush=True)

    prev = {(x[0], x[1]): x for x in (json.load(open('probed.json')) if os.path.exists('probed.json') else [])}
    out = {k: v for k, v in prev.items() if now - v[3] < 60 * 86400}
    for k, co in found.items():
        if k not in covered or k in prev: out[k] = [k[0], k[1], co, now]
    json.dump(sorted(out.values()), open('probed.json', 'w'), indent=0)
    msg = f'{len(found)} career sites answered ({dict(collections.Counter(k[0] for k in found))}); {len(out)} on the list; {time.time()-t0:.0f}s'
    print('Probe: ' + msg)
    print('::notice title=Career-site probe::' + msg + ' e.g. ' + ', '.join(f'{k[0]}:{k[1]}' for k in list(found)[:12]))

if __name__ == '__main__':
    main()
