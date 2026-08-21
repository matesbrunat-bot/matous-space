# Upload service for matous.space

Cloudflare Worker for append-only public photo uploads. Images are stored in R2, while a single Durable Object keeps atomic daily and total quota counters. No public update or delete route exists.

## Resources

- R2 buckets: `matous-space-photos` and `matous-space-photos-preview`
- SQLite-backed Durable Object: `UploadQuota`
- Worker secrets: `TURNSTILE_SECRET`, `IP_HASH_SALT`, `ADMIN_TOKEN`

## Local setup

```powershell
Copy-Item .dev.vars.example .dev.vars
npm install
npm test
npm run dev
```

`TURNSTILE_BYPASS=1` is intended only for local development. Do not set it in production.

## Deploy

```powershell
npx wrangler login
npx wrangler r2 bucket create matous-space-photos
npx wrangler r2 bucket create matous-space-photos-preview
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put IP_HASH_SALT
npx wrangler secret put ADMIN_TOKEN
npm run deploy
```

After deployment, build the public atlas with these environment variables:

```powershell
$env:ATLAS_UPLOAD_API_URL = "https://matous-space-uploads.<account>.workers.dev"
$env:ATLAS_TURNSTILE_SITE_KEY = "<public-site-key>"
python ..\publish_web.py
```

New uploads default to `pending`. The public list returns only `approved` objects. Review operations require the server-side `ADMIN_TOKEN`; there is no public administration UI.
