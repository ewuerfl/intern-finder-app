"""AI Rating, 1.0-10.0: how good an internship looks, from four things.

  company  50%  how well known / established the company is (brand list, Fortune 500 rank, or estimated)
  pay      30%  posted hourly pay; when it isn't posted, estimated from the company and the role
  role     20%  the kind of work: field and title (research/engineering roles over clerical/sales ones)
  + small nudges: posted recently (+), sitting for months (-), unpaid (capped near the bottom)
"""
import math, re, time

NOW = time.time()

# Signals for companies the brand list doesn't know
BIG_ATS = re.compile(r'myworkdayjobs|myworkdaysite|oraclecloud|successfactors|taleo|icims|eightfold|avature|brassring|phenompeople|dayforce|ultipro|adp\.com')
STARTUP_ATS = re.compile(r'greenhouse|ashbyhq|lever\.co|rippling')
SMALL_ATS = re.compile(r'applytojob|bamboohr|breezy|workable|recruitee|pinpointhq|paylocity|jobvite|teamworkonline')
INSTITUTION = re.compile(r'universit|college|national lab|laborator|institute|nasa|\bnih\b|hospital|health system|medical center|museum|federal reserve|department of|city of|county|state of', re.I)

def estimate_brand(co, urls, n_jobs, has_domain):
    b = 2.2
    b += min(2.0, 0.6 * math.log2(1 + n_jobs))                   # more open internships = bigger company
    if has_domain: b += 0.5                                        # we know its website
    u = ' '.join(urls)
    if BIG_ATS.search(u): b += 1.0                                 # enterprise hiring systems
    elif STARTUP_ATS.search(u): b += 0.6                           # funded startups / mid-size tech
    elif SMALL_ATS.search(u): b += 0.1
    if INSTITUTION.search(co): b += 1.0
    return round(min(6.2, b), 1)                                   # stays below the companies we know

FIELD = {'Quant': 3, 'AI/ML/Data': 2, 'Software': 2, 'Hardware': 2, 'Product': 1.5, 'Finance': 1, 'Consulting': 1,
         'Mechanical': 1, 'Engineering': 1, 'Science': 0.8, 'IT': 0.5, 'Healthcare': 0.3, 'Legal': 0.3,
         'Business': 0, 'Marketing': 0, 'Design': 0.3, 'Media': -0.3, 'Environment': 0, 'RealEstate': 0,
         'Nonprofit': -0.5, 'Education': -0.5, 'Arts': -0.5, 'Sports': -0.3, 'Music': -0.5,
         'Sales': -1, 'Retail': -1.5, 'Hospitality': -1}
GOOD_TITLE = re.compile(r'research|engineer|developer|scientist|quant|analyst|machine learning|\bml\b|\bai\b|design verification|architect|trader|trading|investment banking|actuar|product manag', re.I)
WEAK_TITLE = re.compile(r'assistant|clerk|receptionist|customer service|cashier|crew|front desk|data entry|call center|administrative|admin\b|office|warehouse|driver|seasonal|lifeguard|camp counselor|ambassador|canvass|telemarket|sales associate|store|personal trainer|coach\b|tutor|nanny|babysit|social media ambassador', re.I)

def role_score(title, cats):
    s = 5 + max([FIELD.get(c, 0) for c in cats] or [0])
    if GOOD_TITLE.search(title): s += 1.2
    if WEAK_TITLE.search(title): s -= 2.0
    if re.search(r'part[- ]time', title, re.I): s -= 0.7
    if re.search(r'\bphd\b|doctoral|graduate research', title, re.I): s += 0.4
    return max(1.0, min(10.0, s))

def payscore(h):
    pts = [(12, 1), (15, 2), (20, 3.5), (25, 4.8), (30, 5.8), (40, 7.2), (50, 8.2), (65, 9.2), (90, 10)]
    if h <= 12: return 1.0
    for (a, sa), (b, sb) in zip(pts, pts[1:]):
        if h <= b: return sa + (sb - sa) * (h - a) / (b - a)
    return 10.0

def rating(brand, hourly, title, cats, posted, unpaid, program):
    role = role_score(title, cats)
    pay = payscore(hourly) if hourly else 0.55 * brand + 0.45 * role - 0.6   # unknown pay: a cautious guess
    r = 0.5 * brand + 0.3 * pay + 0.2 * role
    r = 5.6 + (r - 5.6) * 1.3                                     # spread the scores out over the full 1-10 scale
    if not program and posted:
        age = (NOW - posted) / 86400
        r += 0.25 if age <= 7 else 0.1 if age <= 21 else -0.3 if age > 90 else -0.15 if age > 45 else 0
    if r > 8.6: r = 8.6 + (r - 8.6) * 0.55                        # a 10 should be rare: only the very best
    if unpaid:
        r = min(r, 1.0 + 0.12 * brand)                            # unpaid: 1.0-2.2 whoever it is
    return round(max(1.0, min(10.0, r)), 1)
