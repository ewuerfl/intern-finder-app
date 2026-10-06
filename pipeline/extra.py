import re,json,html
def strip(s): return html.unescape(re.sub(r'<[^>]+>','',s)).replace('**','').strip()
def href(s):
    m=re.search(r'href="([^"]+)"',s) or re.search(r'\]\((https?://[^)\s]+)\)',s); return m.group(1) if m else ''
out=[]
# speedyapply: USA internships README
for line in open('r_speedyapply_2027-SWE-College-Jobs/README.md'):
    if not line.startswith('| <a') and not line.startswith('| **'): continue
    c=[x.strip() for x in line.strip().strip('|').split('|')]
    if len(c)<6: continue
    out.append(dict(co=strip(c[0]),title=strip(c[1]),loc=strip(c[2]),pay=strip(c[3]),url=href(c[4]),age=c[5],src='speedyapply'))
# vansh
last=''
for line in open('r_vanshb03_Summer2027-Internships/README.md'):
    if not line.startswith('| ') or line.startswith('| Company') or line.startswith('| ---'): continue
    c=[x.strip() for x in line.strip().strip('|').split('|')]
    if len(c)<5: continue
    co=strip(c[0]); co=last if co in('↳','') else co; last=co
    if '🔒' in c[3]: continue
    u=href(c[3])
    if not u: continue
    out.append(dict(co=co,title=strip(c[1]).replace('🛂','').replace('🇺🇸','').strip(),loc=strip(c[2].replace('</br>','; ')),pay='',url=u,age=c[4],src='vansh'))
# sndsh404
on=False
for line in open('r_sndsh404_summer-2027-internships/README.md'):
    if line.startswith('## the list'): on=True; continue
    if on and line.startswith('## '): break
    if not on or not line.startswith('| ') or line.startswith('| Company') or line.startswith('| ---'): continue
    c=[x.strip() for x in line.strip().strip('|').split('|')]
    if len(c)<5 or not href(c[3]): continue
    out.append(dict(co=strip(c[0]),title=strip(c[1]),loc=strip(c[2]),pay='',url=href(c[3]),age=c[4],src='sndsh404'))
print(len(out),{s:sum(1 for x in out if x['src']==s) for s in ('speedyapply','vansh','sndsh404')})
print(out[0],out[-1],sep='\n')
json.dump(out,open('extra.json','w'))
