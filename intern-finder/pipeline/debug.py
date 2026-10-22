import ats, json, re
def n(t,m): print(f'::notice title={t}::'+str(m)[:1800].replace('\n',' '))
for b in ['cerebrassystems','cerebras','groq','groqinc']:
  for name,u in [('gh',f'https://boards-api.greenhouse.io/v1/boards/{b}/jobs'),('ashby',f'https://api.ashbyhq.com/posting-api/job-board/{b}'),('lever',f'https://api.lever.co/v0/postings/{b}?mode=json')]:
    try:
      j=ats.get(u); js=j.get('jobs',[]) if isinstance(j,dict) else j
      n(f'{name} {b}',f"{len(js)} jobs; intern: {[(x.get('title') or x.get('text'), (x.get('location') or {}).get('name') if isinstance(x.get('location'),dict) else x.get('location') or (x.get('categories') or {}).get('location')) for x in js if re.search(r'intern|co-?op',(x.get('title') or x.get('text') or ''),re.I)]}")
    except Exception as e: pass
for u in ['https://www.cerebras.ai/careers','https://groq.com/careers']:
  try:
    import urllib.request
    pg=urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=20).read().decode('utf-8','replace')
    n('page '+u, sorted(set(re.findall(r'(greenhouse|ashbyhq|lever\.co|workday|gem\.com|rippling|jobvite|bamboohr|workable)[a-z./]*[a-z0-9_-]*',pg)))[:20])
  except Exception as e: n('pageERR '+u,e)
