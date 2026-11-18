# Godavari Flood Monitoring and Management System

The repository is a single Next.js project.

- **Frontend/application:** Next.js, React, TypeScript, and Tailwind CSS.
- **Database:** MySQL 8, accessed only by server-side Next.js API routes and scripts.
- **ML:** Offline Python/scikit-learn/TensorFlow training pipeline and artifacts
  are under `ml/`; the model is not integrated into the web application.

## Run locally

```powershell
npm install
npm run dev
```

Open <http://localhost:3000>. API routes live under `src/app/api/`. Database
credentials and JWT settings are loaded server-side from `.env.local`. Do not
commit that file. Use `.env.example` as the list of expected settings.

For local UI preview only, set `NEXT_PUBLIC_DEV_BYPASS_LOGIN=true` in
`.env.local`; the bypass is restricted to development and does not authorize
alert writes.

## Database scripts

```powershell
npm run setup-db
npm run seed-admin
npm run import-data -- --dry-run
```

`setup-db` creates missing tables without dropping data. Set your own
`ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env.local` before seeding; the password
is hashed before storage. The dry-run validates the workbook without inserting
records. Only run `npm run import-data` without `--dry-run` when you intend to
import the dataset.

## Project directories

- `src/app/`, `src/components/`, `src/lib/`, `src/services/`, and `src/types/`:
  app routes, UI, server/client helpers, and shared types.
- `scripts/`: MySQL setup, import, and admin seed scripts.
- `data/raw/`: original Godavari Excel workbook.
- `ml/`: prepared next-day dataset, chronological baseline/MLP training,
  evaluation code, and generated artifacts; see `ml/README.md`.
- `tests/`: automated tests.
- `public/`: static assets.

Flood risk remains the existing configurable academic rule-based estimate; it
is not an official warning and has not been replaced by an ML model.
