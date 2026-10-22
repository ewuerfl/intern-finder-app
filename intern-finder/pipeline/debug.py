import ats, json
for host in ['apply.careers.microsoft.com','microsoft.eightfold.ai','careers.microsoft.com','jobs.careers.microsoft.com']:
  for p in ['/api/pcsx/search?domain=microsoft.com&query=intern&location=United%20States&start=0&sort_by=relevance','/api/apply/v2/jobs?domain=microsoft.com&query=intern&start=0&num=10']:
    try:
      j=ats.get('https://'+host+p); print('::notice title=OK::',host,p[:22],json.dumps(j)[:1500])
    except Exception as e: print('::notice title=ERR::',host,p[:22],e)
