"""Fortune 500 matching: which company names on the site belong to a 2026 Fortune 500 company."""
import re
SUFFIX = re.compile(r'\b(the|inc|incorporated|corporation|corp|company|companies|co|llc|ltd|plc|holdings?|group|lp|na|usa|us|america)\b')
def norm(n):
    n = n.lower().replace('&', ' and ').replace('é', 'e').replace('ē', 'e')
    n = re.sub(r'\(.*?\)', ' ', n)
    n = re.sub(r"[^a-z0-9 ]+", ' ', n.replace("'", ''))
    return re.sub(r'( and)+$', '', ' '.join(SUFFIX.sub(' ', n).split()))
# Bare names that are also common words or other companies' names: only match the longer forms
AMBIG = {'insight', 'reliance', 'williams', 'southern', 'block', 'bell', 'ball', 'dana', 'marsh', 'mercer', 'citizens', 'chase',
         'ice', 'intuitive', 'mosaic', 'dover', 'seaboard', 'westlake', 'fox', 'progressive', 'eastman', 'equitable',
         'principal', 'lumen', 'target', 'visa', 'lear', 'loews', 'masco', 'travelers', 'nvr', 'eqt', 'apa', 'nov', 'aes', 'ppl', 'vf', 'wm', 'gm', 'abm', 'cmc', 'bd', 'hii', 'rga', 'fpl', 'iff', 'adm', 'oxy', 'fis', 'cvs', 'ups', 'jll', 'bny', 'hpe', 'adp', 'itw', 'aep', 'pseg', 'unfi', 'kkr', 'pnc', 'bms', 'ibm', 'amd', 'hp', 'pandg', 'jandj', 'att', 'dow', 'kla', 'csx', 'lkq', 'xpo', 'kbr', 'cdw', 'aig', 'nrg', 'gxo', 'dxc', 'bmo'}
SAFE_SHORT = {'ibm', 'amd', 'hp', 'pandg', 'jandj', 'att', 'dow', 'kla', 'csx', 'lkq', 'xpo', 'kbr', 'cdw', 'aig', 'nrg', 'gxo', 'dxc', 'cvs', 'ups', 'jll', 'bny', 'hpe', 'adp', 'pnc', 'kkr', 'adm', 'target', 'visa', 'lear', 'travelers', 'nvr', 'masco', 'loews', 'cmc', 'aep', 'pseg', 'fis', 'iff', 'unfi', 'progressive', 'abm', 'eqt', 'apa', 'aes', 'ppl', 'wm', 'gm'}
RANK = {}
def load(path='fortune500.txt'):
    out = {}
    for line in open(path, encoding='utf-8'):
        if line.startswith('#') or not line.strip(): continue
        names = [s.strip() for s in re.split(r'[=|]', line)]
        RANK[names[0]] = len(RANK) + 1
        for n in names:
            k = norm(n)
            if k and (k not in AMBIG or k in SAFE_SHORT): out[k] = names[0]
    return out
F500 = load()
def which(company):
    return F500.get(norm(company))

def brand_floor(company):
    """Minimum brand score for a Fortune 500 company, by rank: everyone has heard of the top of the list."""
    w = which(company)
    if not w: return None
    r = RANK[w]
    return 9.0 if r <= 50 else 8.6 if r <= 100 else 8.0 if r <= 250 else 7.5
