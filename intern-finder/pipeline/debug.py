import ats, json, re, urllib.request
def n(t,m): print(f'::notice title={t}::'+str(m)[:1800].replace('\n',' '))
pg=urllib.request.urlopen(urllib.request.Request('https://groq.com/careers',headers={'User-Agent':'Mozilla/5.0'}),timeout=20).read().decode('utf-8','replace')
n('gemlinks',sorted(set(re.findall(r'https?://[a-z.]*gem\.com/[^"\'\s<>]*',pg)))[:10])
for u in ['https://api.gem.com/job_board/v0/groq/job_posts/','https://api.gem.com/job_board/v0/groq/job_posts','https://jobs.gem.com/api/public/job_board/groq/jobs']:
  try:
    j=ats.get(u); js=j if isinstance(j,list) else (j.get('jobs') or j.get('job_posts') or j.get('data') or [])
    n('OK '+u, f"{len(js)} jobs; keys {list(js[0].keys()) if js else ''}; intern {[ (x.get('title'), x.get('location')) for x in js if re.search(r'intern|co-?op',x.get('title',''),re.I)]}; sample {json.dumps(js[0])[:600] if js else ''}")
  except Exception as e: n('ERR '+u,e)
