"""Career sites that only open in a real browser (bot challenge), read with headless Chromium.
Writes browser_jobs.json: [[company, title, location, url, posted_unix], ...]; ats.py adds them to every sweep.
  IBM  careers.ibm.com (Avature behind an AWS WAF challenge)
"""
import json, re, time
from playwright.sync_api import sync_playwright

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'

def ibm(pg):
    out = {}
    for q in ('intern', 'co-op'):
        url = f'https://careers.ibm.com/en_US/careers/SearchJobs/{q}?listFilterMode=1&jobRecordsPerPage=50'
        for page in range(60):
            pg.goto(url, timeout=60000); pg.wait_for_timeout(2500 if page else 7000)
            cards = pg.eval_on_selector_all('article.article--card', '''els => els.map(e => {
                const a = e.querySelector('h3 a'); const sub = [...e.querySelectorAll('a')].map(x => x.innerText.trim());
                return [a ? a.innerText.trim() : '', a ? a.href : '', sub.find(t => /\\n/.test(t)) || ''] })''')
            new = 0
            for title, href, sub in cards:
                m = re.search(r'jobId=(\d+)', href or '')
                if not m or m.group(1) in out: continue
                lines = [l.strip() for l in sub.split('\n') if l.strip()]
                loc = lines[-1] if len(lines) > 1 else ''
                loc = re.sub(r', United States$', '', loc)
                loc = re.sub(r'^([A-Z][A-Z .\'-]+),', lambda k: k.group(1).title() + ',', loc)
                out[m.group(1)] = ['IBM', title, loc, f'https://careers.ibm.com/en_US/careers/JobDetail?jobId={m.group(1)}', int(time.time()) - 3 * 86400]
                new += 1
            nxt = pg.eval_on_selector_all('a', 'els => (els.find(e => /Next/.test(e.innerText) && e.href) || {}).href || ""')
            if not new or not nxt or nxt == url: break
            url = nxt
    return list(out.values())

def main():
    rows = []
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(user_agent=UA)
        for name, fn in (('IBM', ibm),):
            try:
                r = fn(pg); rows += r; print(f'{name}: {len(r)} postings')
            except Exception as e:
                print(f'::warning title={name} browser sweep failed::{e}')
        b.close()
    if rows:
        json.dump(rows, open('browser_jobs.json', 'w'), indent=0)
    print('::notice title=Browser sweep::' + f'{len(rows)} postings, e.g. ' + '; '.join(f'{r[1]} ({r[2]})' for r in rows[:6]))

if __name__ == '__main__':
    main()
