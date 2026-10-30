import ats, json, urllib.request, http.cookiejar, re, time
def n(t,m): print(f'::notice title={t}::'+str(m)[:1500].replace('\n',' '))
for scope in (["careers2"],["careers"],["careers3"],["ibmcareers"]):
  for q in ({"match_all":{}},{"bool":{"must":[{"simple_query_string":{"query":"intern","fields":["title^3","description^2","body"]}}]}}):
    body={"appId":"careers","scopes":scope,"query":q,"size":5,"from":0,"lang":"zxx","localeSelector":{},"p":1,"sm":{"query":"intern","lang":"zxx"}}
    try:
      j=ats.get('https://www-api.ibm.com/search/api/v2',body,extra={'Origin':'https://www.ibm.com','Referer':'https://www.ibm.com/careers/search'})
      h=j.get('hits',{}); n(f'ibm {scope} {list(q)[0]}', f"total {h.get('total')} keys {list(j)} sample {json.dumps(h.get('hits',[])[:2])}")
    except Exception as e: n('ibmERR',e)
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
cj=http.cookiejar.CookieJar(); op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
nav={'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9','Sec-Fetch-Dest':'document','Sec-Fetch-Mode':'navigate','Sec-Fetch-Site':'none','Sec-Fetch-User':'?1','Upgrade-Insecure-Requests':'1'}
for u in ['https://careers.ibm.com/en_US/careers/SearchJobs/intern?listFilterMode=1&jobRecordsPerPage=50','https://careers.ibm.com/en_US/careers/SearchJobs/intern?listFilterMode=1&jobRecordsPerPage=50','https://careers.ibm.com/en_US/careers/JobDetail?jobId=129102']:
  try:
    r=op.open(urllib.request.Request(u,headers=nav),timeout=25); b=r.read().decode('utf-8','replace')
    n('av',f'{r.status} {len(b)} cookies {[c.name for c in cj]} jobs {len(set(re.findall(r"JobDetail[^\"]*jobId=(\d+)",b)))} titles {re.findall(r"<h3[^>]*>\s*<a[^>]*>([^<]+)",b)[:5]} head {b[:300]}')
  except Exception as e: n('avERR',e)
  time.sleep(3)
