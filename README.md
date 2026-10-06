# Intern Finder

A web app for finding internships across every major, with a built-in application tracker. It installs on phones and laptops like a native app (PWA).

## What it does

- **Search thousands of open internships** with company logos, ratings and AI-written summaries of each posting
- **Resume matching:** upload a resume and an AI model ranks postings by fit
- **Application tracker** that works signed out (saved in the browser) or signed in (synced across devices)
- **Gmail inbox tab** that reads application emails, read-only and entirely in the browser (see the note below on access)
- **Installable and offline-friendly** with a service worker and web app manifest

### Note on Gmail access

The Gmail inbox feature is not open to everyone. Google requires an app that reads Gmail to pass a restricted-scope verification review, and this project has not gone through it. The Google app is in Testing mode, so only people I add as approved test users (up to 100) can connect their Gmail. Everyone else can still use search, resume matching and the application tracker; only the Gmail tab is unavailable. If you want to try the Gmail tab, send me the Google account email you'd like added.

## How it's built

| Layer | Tech |
|---|---|
| Front end | HTML, CSS and vanilla JavaScript, shipped as a PWA |
| Data pipeline | Python scripts that pull from public internship lists, company career sites and program pages, then rebuild `data.json` |
| Automation | GitHub Actions runs the pipeline every hour and commits new listings; Vercel redeploys automatically |
| Backend | Vercel serverless function (Node.js) for resume matching, calling Gemini or Claude. API keys stay on the server, with per-IP rate limiting |
| Accounts | Supabase (Postgres + email/Google sign-in) with row-level security so people only see their own data |
| Gmail | Google OAuth with the read-only Gmail scope, run client-side |
| Logos | Logo.dev |

## Design decisions

- **Privacy first.** Gmail access is read-only and runs client-side, so nothing from a user's inbox reaches the server. Resumes are sent only to the matching function and API keys never reach the browser.
- **No server to maintain for listings.** The pipeline writes a static `data.json`, so the site is fast and cheap to host.
- **Model fallback.** The matching function tries several models in order and falls through on overload, quota or retirement errors, so a single model outage doesn't break the feature.

## Repo layout

```
public/      the website (index.html, app.js, data.json, PWA files)
api/         serverless resume-matching function
pipeline/    scripts that rebuild the listings
supabase/    database schema for accounts
.github/     hourly refresh workflow
```

## License

This repository is view only. All rights reserved; see [LICENSE](LICENSE). Please do not copy, deploy or reuse the code without permission.

## Author

Ethan, Computer Engineering at the University of Miami.
