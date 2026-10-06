import csv,json,re,datetime
out=[]
# zshah101 automated list (official ATS links, open roles)
try:
    for r in csv.DictReader(open('r_zshah101_Automated-List-Of-Summer-2027-and-Fall-2026-Tech-Internships/data/internships.csv')):
        seas=[s.strip() for s in (r.get('seasons') or r.get('season') or '').split(';') if s.strip()] or [r.get('season','')]
        out.append(dict(co=r['company'],title=r['title'],loc=r.get('location',''),pay=r.get('salary','') or '',url=r['url'],
                        date=(r.get('posted_at') or r.get('first_seen_at') or '')[:10],terms=seas,src='zshah'))
except FileNotFoundError: print('WARN no zshah list')
# drewdavis finance list
try:
    for line in open('r_drewdavis0302_finance-summer-2027/README.md'):
        if not line.startswith('| ') or line.startswith('| Company') or line.startswith('| ---'): continue
        c=[x.strip() for x in line.strip().strip('|').split('|')]
        if len(c)<5: continue
        m=re.search(r'\((https?://[^)]+)\)',c[3])
        if not m: continue
        out.append(dict(co=c[0],title=c[1]+' Intern' if 'intern' not in c[1].lower() and 'analyst' not in c[1].lower() else c[1],loc=c[2],pay='',url=m.group(1),date=c[4],terms=['Summer 2027'],src='finance'))
except FileNotFoundError: print('WARN no finance list')
json.dump(out,open('extra2.json','w'));print('extra2',len(out))
