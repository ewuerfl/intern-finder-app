#!/bin/bash
# Rebuild the listings from fresh public sources. Writes public/data.json.
set -e
cd "$(dirname "$0")"
rm -rf s27dev mehek-builds_Summer2027-Internships r_*
export GIT_TERMINAL_PROMPT=0
git clone -q --depth 1 -b dev https://github.com/SimplifyJobs/Summer2027-Internships.git s27dev
git clone -q --depth 1 https://github.com/mehek-builds/Summer2027-Internships.git mehek-builds_Summer2027-Internships
for r in speedyapply/2027-SWE-College-Jobs vanshb03/Summer2027-Internships sndsh404/summer-2027-internships zshah101/Automated-List-Of-Summer-2027-and-Fall-2026-Tech-Internships drewdavis0302/finance-summer-2027; do
  git clone -q --depth 1 https://github.com/$r.git r_$(echo $r|tr / _) || echo "WARN: could not clone $r"
done
mkdir -p app
python3 extra.py
python3 extra2.py
python3 boards.py
timeout 600 python3 ats.py || echo "WARN: job-board sweep failed; using last results"
python3 build.py
python3 make_data.py
rm -rf s27dev mehek-builds_Summer2027-Internships r_* extra.json extra2.json
echo "BUILT: public/data.json"
