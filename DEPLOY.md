# Floodguard AI — 100% FREE Hosting Guide

Everything below has a free tier. Total cost: **$0/month**.

```
┌────────────────────┐        ┌──────────────────────────┐
│ Vercel (frontend)  │  HTTPS │ Render FREE (FastAPI)    │
│ floodguard.vercel  │ ─────► │ floodguard-api.onrender  │
│       .app         │        │          .com            │
└────────────────────┘        └───────────┬──────────────┘
                                          │
                              ┌───────────▼────────────┐
                              │ Neon FREE (PostgreSQL  │
                              │      + PostGIS)        │
                              └───────────┬────────────┘
                                          ▲
                              ┌───────────┴────────────┐
                              │ GitHub Actions (cron)  │
                              │ ingests weather /30min │
                              └────────────────────────┘
```

## Step 1 — Database: Neon (free) — https://neon.tech

1. Sign up (GitHub login works) → **Create project** (pick a region close to users, e.g. Singapore).
2. Copy the connection string (looks like
   `postgresql://user:pass@ep-xxx.aws.neon.tech/neondb`) and add `?sslmode=require`.
3. Open the **SQL Editor** and paste the full contents of `db/init.sql` → Run.
   If the PostGIS extension line errors, first run `CREATE EXTENSION postgis;`
   (Neon supports PostGIS out of the box).
4. Seed the risk zones locally:
   ```bash
   cd flood-ews
   set DATABASE_URL=postgresql://user:pass@ep-xxx.aws.neon.tech/neondb?sslmode=require
   pip install psycopg2
   python scripts/seed_cities.py
   ```

## Step 2 — API: Render (free web service) — https://render.com

1. Push this repo to **GitHub**.
2. Render → **New → Web Service** → connect the repo:
   - **Root directory:** `api`
   - **Runtime:** Docker (auto-detects `api/Dockerfile`)
   - **Instance type:** Free
   - **Environment variables:**
     - `DATABASE_URL` = `postgresql+asyncpg://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`
       *(note the `+asyncpg` — the API uses an async driver)*
     - `CORS_ORIGINS` = `https://<your-app>.vercel.app` (add after step 3, or leave unset for `*`)
3. Deploy → note your URL: `https://floodguard-api.onrender.com`

> ⚠️ **Free-tier note:** Render free services spin down after ~15 min idle; the first
> request after sleeping takes ~30–60 s to wake. (Remedy: cron-job.org can ping
> `/health` every 10 min for free to keep it warm — see Step 4.)

## Step 3 — Frontend: Vercel (free) — https://vercel.com

1. Vercel → **Add New → Project** → import the GitHub repo.
2. Configure:
   - **Root directory:** `web`
   - **Framework preset:** Vite (auto-detected via `web/vercel.json`)
   - **Environment variables:**
     - `VITE_API_BASE` = `https://floodguard-api.onrender.com`
     - `VITE_OWM_KEY` *(optional)* — OpenWeatherMap free key for wind/temp/humidity/pressure tiles
       (rainfall, cyclones, western disturbances work without it)
3. Deploy → live at `https://floodguard.vercel.app` 🎉

## Step 4 — Background data (free) — GitHub Actions cron

The map's live data (rainfall radar, cyclones, western disturbances, forecasts)
already works with **zero workers** — the API calls Open-Meteo on request.

To also record **observations history** for the charts, the included workflow
`.github/workflows/ingest.yml` runs the ingestor every 30 minutes for free:

1. The workflow file is already in the repo (`.github/workflows/ingest.yml`).
2. On GitHub → repo **Settings → Secrets and variables → Actions → New secret:**
   - `DATABASE_URL` = your Neon connection string (plain `postgresql://`, no `+asyncpg`)
3. Done — Actions runs it every 30 min (also has a manual "Run workflow" button).

**Optional free keep-warm:** create a free monitor at https://cron-job.org that
HTTP-GETs `https://floodguard-api.onrender.com/health` every 10 minutes so the
Render free instance never sleeps.

## What you get for $0

| Piece       | Provider       | Free tier limit                    |
|-------------|----------------|------------------------------------|
| Frontend    | Vercel         | Unlimited static requests          |
| API         | Render         | 750 h/mo (sleeps when idle)        |
| Database    | Neon           | 0.5 GB storage, generous compute   |
| Data ingest | GitHub Actions | 2,000 min/mo (30-min cron uses ~50)|

## Quick checklist

- [ ] Neon project + `db/init.sql` applied + cities seeded
- [ ] Repo pushed to GitHub
- [ ] Render API deployed (`DATABASE_URL`, `CORS_ORIGINS`)
- [ ] Vercel frontend deployed (`VITE_API_BASE`)
- [ ] GitHub secret `DATABASE_URL` added (enables the 30-min ingest cron)
- [ ] (Optional) cron-job.org pinging `/health` to keep API warm

## Local (dev) mode

Unchanged: `docker compose up --build` runs the full original stack on
`http://localhost:3000` — postgres, api, web, ingestor, and alerts together.