import re, json
from playwright.sync_api import sync_playwright
def n(t,m): print(f'::notice title={t}::'+str(m)[:1500].replace('\n',' '))
with sync_playwright() as p:
  b=p.chromium.launch(); pg=b.new_page(user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36')
  pg.goto('https://careers.ibm.com/en_US/careers/SearchJobs/intern?listFilterMode=1&jobRecordsPerPage=50',timeout=60000)
  pg.wait_for_timeout(8000)
  h=pg.content()
  ids=sorted(set(re.findall(r'JobDetail[^"]*?jobId=(\d+)',h)))
  n('ibm',f'len {len(h)} ids {len(ids)} title {pg.title()} url {pg.url}')
  links=pg.eval_on_selector_all('a[href*="JobDetail"]','els=>els.map(e=>[e.innerText.trim(),e.href])')
  n('links',links[:12])
  n('html',re.sub(r'\s+',' ',h[h.find('JobDetail')-1500:h.find('JobDetail')+800]))
  b.close()
