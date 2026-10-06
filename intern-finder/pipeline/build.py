import json,re,glob,collections,urllib.parse as u,time,datetime
RULES=[
 ('Mechanical',r'guidance, navigation|\bgnc\b'),
 ('Software',r'computer science'),
 ('Music',r'\bmusic|record label|\ba&r\b|audio engineer|sound design|recording studio'),
 ('Marine',r'marine|ocean|meteorolog|atmospheric|geolog|coastal|fisheries|aquarium|hydrolog'),
 ('Arts',r'museum|curator|curatorial|gallery|theatre|theater|fine art|exhibition|art history|architectural design|architecture intern|architect intern'),
 ('Education',r'\bteach|tutor|\beducation|curriculum|instructional design|classroom'),
 ('Quant',r'\bquant|trading|trader|market mak'),
 ('AI/ML/Data',r'machine learning|\bml\b|\bai\b|artificial intelligence|data scien|decision scien|data analy|data engineer|analytics|deep learning|computer vision|\bnlp\b|\bllm|research scientist|applied scientist|business intelligence|\bdata\b|perception'),
 ('Hardware',r'hardware|electrical|asic|fpga|rtl|vlsi|silicon|semiconductor|\bchip|gpu|cpu|verification|firmware|embedded|circuit|analog|digital design|pcb|signal integrity|power electronics|\brf\b|photonic|\bdft\b|physical design|validation engineer|electronics'),
 ('Software',r'software|developer|\bswe\b|full[- ]?stack|front[- ]?end|back[- ]?end|\bweb\b|mobile|\bios\b|android|programm|platform engineer|site reliability|\bsre\b|compiler|algorithm|c\+\+|python|java\b'),
 ('IT',r'cyber|security|\bit\b|information technology|help desk|network|systems admin|devops|cloud|tech support|technical support'),
 ('Mechanical',r'mechanical|aerospace|aeronaut|propulsion|thermal|robotics|mechatronic|avionics|spacecraft|satellite|automotive'),
 ('Hospitality',r'hospitality|hotel|resort|guest|restaurant|culinary|food (&|and) beverage|tourism|cruise|airline|catering|front desk|banquet|events?\b'),
 ('Healthcare',r'hospital|clinical|health|patient|nurs|medical|pharmacy|public health|care coordinat'),
 ('Environment',r'environmental|sustainab|climate|renewable|solar|\bwind\b|energy|conservation'),
 ('Science',r'biolog|chemis|chemical eng|laborator|\blab\b|pharma|biotech|physics|optic|materials (science|engineer)|geolog|\bscience'),
 ('Consulting',r'consult'),
 ('Finance',r'financ|accounting|accountant|\btax\b|audit|treasury|investment|banking|fp&a|actuar|credit|wealth|private equity|equity research|underwrit|risk analyst|controller|capital market|asset management|fund\b|insurance|claims'),
 ('Media',r'journalis|editorial|reporter|news|film|video|music|broadcast|producer|writer|photograph|podcast|entertainment|animation'),
 ('Sports',r'\bsports?\b|athletic|league|\bteam operations'),
 ('Marketing',r'marketing|communications|\bpr\b|public relations|social media|content|brand|creative|copywrit|media|advertis'),
 ('Sales',r'\bsales|business development|account (executive|manage)|customer success|partnerships'),
 ('HR',r'human resources|\bhr\b|recruit|talent acquisition|people (ops|operations|team)|total rewards'),
 ('Legal',r'\blegal|\blaw\b|paralegal|policy|government|public affairs|compliance|regulatory|congress'),
 ('Nonprofit',r'nonprofit|non-profit|education|teach|tutor|community (engagement|outreach|health)|social work|youth|volunteer'),
 ('Retail',r'retail|merchandis|\bbuyer|buying|fashion|apparel|store|e-?commerce|consumer goods'),
 ('RealEstate',r'real estate|construction|property|leasing|architect|development associate|land'),
 ('Product',r'product manag|product owner|product design|\bproduct\b|\bux\b|\bui\b|user experience|designer|design intern|graphic|visual design|industrial design|program manag'),
 ('Engineering',r'civil|industrial|manufactur|process engineer|quality|structural|reliability|production|facilities|nuclear|mining|petroleum|systems engineer|field engineer|test engineer|structures|engineer'),
 ('Business',r'business|operations|strategy|supply chain|logistic|procurement|sourcing|project manag|management|analyst|planning|administrat|executive|office|corporate|purchasing|commercial|leadership|coo\b'),
]
FB={'Software':'Software','AI/ML/Data':'AI/ML/Data','Hardware':'Hardware','Product':'Product','Quant':'Quant'}
def classify(title,fallback):
  t=title.lower()
  for k,r in RULES:
    if re.search(r,t):
      # tech list: business words shouldn't override clear tech category for generic roles
      return k
  return fallback
OK=re.compile(r'^(Fall 2026|(Winter|Spring|Summer|Fall) 20(2[7-9]))$')
def clean(url):
  p=u.urlparse(url); q=[(k,v) for k,v in u.parse_qsl(p.query,keep_blank_values=True) if not k.lower().startswith('utm') and k.lower()!='ref']
  return u.urlunparse(p._replace(query=u.urlencode(q)))
out=[];seen=set()
d=json.load(open('s27dev/.github/scripts/listings.json'))
catmap={'Software Engineering':'Software','Data Science, AI & Machine Learning':'AI/ML/Data','Hardware Engineering':'Hardware','Product Management':'Product'}
for x in d:
  if not x.get('active') or not x.get('is_visible',True): continue
  t=[s for s in x.get('terms',[]) if OK.match(s)]
  if not t: continue
  co,ti=x['company_name'].strip(),x['title'].strip()
  k=(co.lower(),ti.lower())
  if k in seen: continue
  seen.add(k)
  src=catmap.get(x.get('category'),x.get('category'))
  cat=classify(ti,src)
  # keep tech-source roles in their tech bucket unless the title clearly says otherwise
  if src in FB and cat=='Business': cat=src
  sp={'Other':'','Does Not Offer Sponsorship':'no','U.S. Citizenship is Required':'cit','Offers Sponsorship':'yes'}.get(x.get('sponsorship','Other'),'')
  out.append([co,ti,cat,t,x.get('locations') or [],x.get('degrees') or [],sp,x.get('date_posted') or 0,clean(x['url'])])
# Litos lists
now=time.time()
row=re.compile(r'^\| \*\*(.+?)\*\* \| <a [^>]*>(.*?)</a> \| (.*?) \| (.*?) \| <a href="([^"]+)">Apply</a>.*?\| (.*?) \|$')
lcat={'quant-and-trading':'Quant','software-engineering':'Software','data-science-ai-and-machine-learning':'AI/ML/Data','hardware-and-other-engineering':'Engineering','product-and-design':'Product','business-finance-and-marketing':'Business'}
termre=re.compile(r'(Spring|Summer|Fall|Winter)\s*(20\d\d)',re.I)
n=0
for f in glob.glob('mehek-builds_Summer2027-Internships/lists/*.md'):
  base=f.split('/')[-1][:-3]
  for line in open(f):
    m=row.match(line.strip())
    if not m: continue
    co,ti,loc,pay,url,posted=[s.strip() for s in m.groups()]
    import html; co=html.unescape(co); ti=html.unescape(ti); loc=html.unescape(loc)
    k=(co.lower(),ti.lower())
    if k in seen: continue
    seen.add(k)
    tm=[f'{a.title()} {b}' for a,b in termre.findall(ti)]
    tm=[s for s in tm if OK.match(s)] or (['Summer 2027'] if not termre.search(ti) else [])
    if not tm: continue
    days=0 if posted=='today' else int(re.sub(r'\D','',posted) or 0)*(30 if 'mo' in posted else 7 if 'w' in posted else 1)
    ts=int((now-days*86400)//86400*86400)
    cat=classify(ti,lcat[base])
    if lcat[base]=='Engineering' and cat=='Business': cat='Engineering'
    locs=[loc] if loc else []
    out.append([co,ti,cat,tm,locs,[],'',ts,clean(url),pay]); n+=1

# ---- extra GitHub lists ----
ex=json.load(open('extra.json'))
urls={r[8].split('?')[0].rstrip('/') for r in out}
n2=0
for x in ex:
  co,ti=x['co'].strip(),re.sub(r'[⏳🔒🛂🇺🇸]','',x['title']).strip()
  k=(co.lower(),ti.lower()); u0=x['url'].split('?')[0].rstrip('/')
  if k in seen or u0 in urls or not x['url'].startswith('http'): continue
  seen.add(k); urls.add(u0)
  tm=[f'{a.title()} {b}' for a,b in termre.findall(ti)]
  tm=[t for t in tm if OK.match(t)] or (['Summer 2027'] if not termre.search(ti) else [])
  if not tm: continue
  age=x['age']; m=re.match(r'(\d+)\s*([dwm]|mo)',age or '')
  days=int(m.group(1))*(30 if m and m.group(2) in('m','mo') else 7 if m and m.group(2)=='w' else 1) if m else 30
  if re.match(r'\d{4}-\d\d-\d\d',age or ''): ts=int(datetime.datetime.strptime(age,'%Y-%m-%d').timestamp())
  elif re.match(r'[A-Z][a-z]{2} \d+',age or ''):
    try: ts=int(datetime.datetime.strptime(age+' 2026','%b %d %Y').timestamp())
    except: ts=int(now-30*86400)
  else: ts=int(now-days*86400)
  out.append([co,ti,classify(ti,'Software'),tm,[x['loc']] if x['loc'] else [],[],'',ts,clean(x['url']),x.get('pay','')]); n2+=1
print('extra added',n2)

# ---- extra2: automated ATS list + finance list ----
try: ex2=json.load(open('extra2.json'))
except FileNotFoundError: ex2=[]
n3=0
for x in ex2:
  co,ti=x['co'].strip(),x['title'].strip()
  k=(co.lower(),ti.lower()); u0=x['url'].split('?')[0].rstrip('/')
  if k in seen or u0 in urls or not x['url'].startswith('http'): continue
  tm=[t for t in x.get('terms',[]) if OK.match(t)]
  if not tm:
    tm=[f'{a.title()} {b}' for a,b in termre.findall(ti)]
    tm=[t for t in tm if OK.match(t)]
  if not tm: continue
  seen.add(k); urls.add(u0)
  try: ts=int(datetime.datetime.strptime(x['date'][:10],'%Y-%m-%d').timestamp())
  except Exception: ts=int(now-14*86400)
  fb='Finance' if x['src']=='finance' else 'Software'
  cat=classify(ti,fb)
  if x['src']=='finance' and cat in ('Business','Software','IT'): cat='Finance'
  out.append([co,ti,cat,tm,[x['loc']] if x['loc'] else [],[],'',ts,clean(x['url']),x.get('pay','')]); n3+=1
print('extra2 added',n3)
# ---- curated program pages ----
FILEMAP={'consulting':'Consulting','marketing':'Marketing','finance':'Finance','government':'Legal','media':'Media','sports':'Sports','hospitality':'Hospitality','nonprofit':'Nonprofit','sustain':'Environment','engineering':'Engineering','design':'Product','retail':'Retail','realestate':'RealEstate','biotech':'Science','health':'Healthcare','airline':'Hospitality','logistics':'Business','insurance':'Finance','journalism':'Media','music':'Music','arts':'Arts','marine':'Marine','nursing':'Healthcare','education':'Education'}
OVR={'NIH':['Science','Healthcare'],'CDC':['Healthcare','Legal'],'NASA':['Mechanical','Engineering'],'U.S. Department of Energy':['Science','Environment'],'EPA':['Environment','Legal'],'Smithsonian Institution':['Nonprofit','Science'],
 'Environmental Defense Fund':['Environment','Nonprofit'],'World Resources Institute':['Environment','Nonprofit'],'Earthjustice':['Environment','Legal'],'NRDC':['Environment','Nonprofit'],'Sierra Club':['Environment','Nonprofit'],'Patagonia':['Environment','Retail'],
 'SpaceX':['Mechanical','Engineering'],'Boeing':['Mechanical','Engineering'],'Lockheed Martin':['Mechanical','Engineering'],'Northrop Grumman':['Mechanical','Engineering'],'RTX':['Mechanical','Engineering'],'NASA JPL':['Mechanical','Science'],'GE Aerospace':['Mechanical','Engineering'],
 'Texas Instruments':['Hardware'],'Qualcomm':['Hardware'],'Intel':['Hardware'],'Medtronic':['Engineering','Healthcare'],'Pfizer':['Science','Healthcare'],'Dow':['Engineering','Science'],'BASF':['Engineering','Science'],
 'United Airlines':['Hospitality','Business'],'Delta Air Lines':['Hospitality','Business'],'American Airlines':['Hospitality','Business'],'ECG Management Consultants':['Healthcare','Consulting'],'Teach For America':['Nonprofit'],
 'Disney':['Media','Hospitality'],'Gensler':['Arts','RealEstate'],'Live Nation':['Music','Media','Hospitality'],'Sony Music':['Music','Media'],'Universal Music Group':['Music','Media'],'Warner Music Group':['Music','Media'],'SiriusXM':['Music','Media'],'Spotify':['Music','Marketing','Product'],'Smithsonian Institution':['Arts','Nonprofit','Science'],'NOAA':['Marine','Environment','Science'],'U.S. Department of Energy':['Science','Environment'],'National Science Foundation':['Science','Marine','Education'],'American Psychological Association':['Science','Healthcare','Education'],'Princeton Neuroscience Institute':['Science','Healthcare'],'Breakthrough Collaborative':['Education','Nonprofit'],'Teach For America':['Education','Nonprofit'],'Phillip and Patricia Frost Museum of Science':['Arts','Science','Education'],'EPA':['Environment','Legal','Marine'],'Environmental Defense Fund':['Environment','Nonprofit','Marine']}
MULTI={'Hospitality':['Business','Marketing','Finance'],'Retail':['Business','Marketing'],'Consulting':['Business'],'Finance':['Business'],'Sports':['Marketing','Media'],'Marketing':['Business'],'RealEstate':['Finance','Business'],'Healthcare':['Business']}
FLEX=['Fall 2026','Spring 2027','Summer 2027','Fall 2027']
np_=0
for f in sorted(glob.glob('prog/*.jsonl')):
  base=f.split('/')[-1][:-6]
  for line in open(f):
    line=line.strip()
    if not line: continue
    x=json.loads(line); u=x['url']
    if not u.startswith('http') or 'extern.com' in u: continue
    prim=OVR.get(x['company'])
    cats=prim or [FILEMAP[base]]+MULTI.get(FILEMAP[base],[])
    if base=='design' and x['company'] in('Epic Games','Ubisoft'): cats=['Product','Media']
    t=x['term']; terms=[t] if OK.match(t) else FLEX
    key=(x['company'].lower(),x['program'].lower())
    if key in seen: continue
    seen.add(key)
    locs=[l.strip() for l in re.split(r';',x['location']) if l.strip()] or ['Multiple locations']
    out.append([x['company'],x['program'],cats,terms,locs,[],'',int(now-1*86400),u,'','p',x.get('about','')]); np_+=1
print('programs added',np_)

# ---- specific postings scanned from company career sites ----
DROP={('universal orlando resort','event management internship'),('universal orlando resort','security technology projects internship'),('universal orlando resort','internships (all areas)'),('marriott international','hotel internship program'),('disney','professional internships')}
out=[r for r in out if not (len(r)>10 and r[10]=='p' and (r[0].lower(),r[1].lower()) in DROP)]
nh=0
import os
for fn in ['hosp_postings.tsv','more_postings.tsv','raw_postings.tsv']:
 if not os.path.exists(fn): continue
 for line in open(fn):
  p=line.rstrip('\n').split('\t')
  if len(p)<6: continue
  co,ti,loc,term,url,cats=p
  key=(co.lower(),ti.lower()+'|'+loc.lower()); u0=url.split('?')[0].rstrip('/')
  if key in seen or u0 in urls: continue
  seen.add(key); urls.add(u0)
  if cats.startswith('AUTO:'):
    d=cats[5:]; c=classify(ti,d); cl=[c] if c==d else [c,d]
  else: cl=cats.split(',')
  out.append([co,ti,cl,[t for t in term.split('|') if t],[loc],[],'',int(now-3*86400),url,'','','']); nh+=1
print('company-site postings added',nh)
# ---- internships pulled live from company job boards (ats.py) ----
na=0
if os.path.exists('ats.json'):
  for co,ti,loc,terms,url,posted in json.load(open('ats.json')):
    key=(co.lower(),ti.lower()+'|'+loc.lower()); u0=url.split('?')[0].rstrip('/')
    if key in seen or u0 in urls: continue
    seen.add(key); urls.add(u0)
    c=classify(re.sub(r'^[A-Z][A-Za-z .]+ - ','',ti),'Business')   # drop a leading 'City - ' so place names don't decide the field
    if re.search(r'\b(tax|audit|assurance|accounting|cpa|actuarial)\b',ti,re.I): c='Finance'
    out.append([co,ti,[c],terms,[loc],[],'',int(posted),url,'','','']); na+=1
print('job-board postings added',na)
for r in out:
  while len(r)<12: r.append('')
  if isinstance(r[2],str): r[2]=[r[2]]
print('litos added',n,'total',len(out))
print(collections.Counter(r[2][0] for r in out).most_common())
out.sort(key=lambda r:-r[7])
json.dump(out,open('all.json','w'))
s=json.dumps(out,separators=(',',':'),ensure_ascii=False)
open('app/data.js','w').write('window.LISTINGS='+s+';window.LISTINGS_ASOF='+str(int(now))+';')
