import ats
for k,s,c in [('gem','groq','Groq'),('ashby','cerebras','Cerebras')]:
  r=list(ats.KINDS[k](s,c)); print(f'::notice title={c}::{len(r)} postings, e.g. {r[:2]}')
