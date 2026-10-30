import ats, json, urllib.request
def n(t,m): print(f'::notice title={t}::'+str(m)[:1800].replace('\n',' '))
body={"appId":"careers","scopes":["careers2"],"query":{"bool":{"must":[{"simple_query_string":{"query":"intern","fields":["keywords^1","body^1","url^2","description^2","h1s_content^2","title^3","field_text_01"]}}]}},"size":30,"from":0,"sort":[{"_score":"desc"}],"lang":"zxx","localeSelector":{},"p":1,"sm":{"query":"intern","lang":"zxx"},"_source":["_id","title","url","description","language","entitled","field_keyword_17","field_keyword_08","field_keyword_18","field_keyword_19"]}
try:
  j=ats.get('https://www-api.ibm.com/search/api/v2',body,extra={'Origin':'https://www.ibm.com','Referer':'https://www.ibm.com/careers/search'})
  h=j.get('hits',{}); n('ibm', f"total {h.get('total')} sample {json.dumps(h.get('hits',[])[:3])}")
except Exception as e: n('ibmERR',f'{e} {getattr(e,"read",lambda:b"")()[:300]}')
for u in ['https://careers.ibm.com/api/jobs?keywords=intern','https://ibmglobal.avature.net/en_US/careers/SearchJobs/intern']:
  try:
    r=urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=20); b=r.read().decode('utf-8','replace'); n('page '+u,f'{r.status} {r.geturl()} {len(b)} jobIds {b.count("JobDetail")}')
  except Exception as e: n('pageERR '+u,e)
