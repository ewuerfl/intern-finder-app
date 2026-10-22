import urllib.request, http.cookiejar, json, re, time
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
def n(t,m): print(f'::notice title={t}::'+str(m)[:1500].replace('\n',' '))
cj=http.cookiejar.CookieJar(); op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
H='https://apply.careers.microsoft.com'
nav={'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9','Sec-Fetch-Dest':'document','Sec-Fetch-Mode':'navigate','Sec-Fetch-Site':'none','Sec-Fetch-User':'?1','Upgrade-Insecure-Requests':'1'}
try:
  r=op.open(urllib.request.Request(H+'/careers?domain=microsoft.com&query=intern',headers=nav),timeout=20); pg=r.read().decode('utf-8','replace')
  n('page',f'{r.status} len {len(pg)} cookies {[c.name for c in cj]} csrf {re.findall(r"csrf[^\"]{0,40}\"[^\"]{0,80}",pg)[:3]} api {sorted(set(re.findall(r"/api/[a-z0-9_/]+",pg)))[:30]}')
except Exception as e: n('pageERR',e)
tok=''
for c in cj:
  if 'csrf' in c.name.lower(): tok=c.value
xhr={'User-Agent':UA,'Accept':'application/json, text/plain, */*','Accept-Language':'en-US,en;q=0.9','Referer':H+'/careers?domain=microsoft.com&query=intern','Sec-Fetch-Dest':'empty','Sec-Fetch-Mode':'cors','Sec-Fetch-Site':'same-origin','X-Requested-With':'XMLHttpRequest'}
if tok: xhr['X-CSRF-Token']=tok
for p in ['/api/pcsx/search?domain=microsoft.com&query=intern&location=&start=0&sort_by=relevance','/api/pcsx/search?domain=microsoft.com&query=intern&start=0','/api/apply/v2/jobs?domain=microsoft.com&query=intern&start=0&num=10']:
  for k in range(2):
    try:
      r=op.open(urllib.request.Request(H+p,headers=xhr),timeout=20); b=r.read().decode(); n('OK '+p[:20],b); break
    except Exception as e:
      n('ERR '+p[:20],f'{e} {getattr(e,"headers",{}) and dict(e.headers)}'); time.sleep(5)
