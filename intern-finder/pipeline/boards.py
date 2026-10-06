"""Build boards.json: every company job board seen in the current listings, plus boards_extra.tsv."""
import json, re, os, collections, urllib.parse

def board_of(url):
    p = urllib.parse.urlparse(url); h = p.hostname or ''; q = urllib.parse.parse_qs(p.query)
    parts = [x for x in p.path.split('/') if x]
    if 'greenhouse.io' in h:
        if 'for' in q: return ('gh', q['for'][0])
        if len(parts) >= 2 and parts[1] == 'jobs' and parts[0] != 'embed': return ('gh', parts[0])
    if h == 'jobs.lever.co' and parts: return ('lever', parts[0])
    if h == 'jobs.ashbyhq.com' and parts: return ('ashby', parts[0])
    if h.endswith('myworkdayjobs.com'):
        if parts and re.match(r'^[a-z]{2}-[A-Z]{2}$', parts[0]): parts = parts[1:]
        if parts and parts[0] not in ('job', 'details', 'wday', 'jobs'): return ('wd', f"{h}|{h.split('.')[0]}|{parts[0]}")
    if h == 'jobs.smartrecruiters.com' and parts: return ('sr', parts[0])
    return None

def main():
    names = collections.defaultdict(collections.Counter)
    if os.path.exists('../public/data.json'):
        for r in json.load(open('../public/data.json'))['listings']:
            b = board_of(r[8])
            if b: names[b][r[0]] += 1
    for line in open('boards_extra.tsv'):
        if line.startswith('#') or not line.strip(): continue
        kind, ident, co = line.rstrip('\n').split('\t')
        names[(kind, ident)][co] += 1000   # curated name wins
    # companies found by the daily discovery sweep (discover.py)
    if os.path.exists('discovered.json'):
        for kind, ident, co, seen in json.load(open('discovered.json')):
            names[(kind, ident)][co] += 1
    boards = sorted([k[0], k[1], v.most_common(1)[0][0]] for k, v in names.items())
    json.dump(boards, open('boards.json', 'w'), indent=0)
    print('boards:', len(boards), dict(collections.Counter(b[0] for b in boards)))

if __name__ == '__main__':
    main()
