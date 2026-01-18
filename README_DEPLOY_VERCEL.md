# Deploy to Vercel (ZIP upload, no GitHub)

1) Go to Vercel Dashboard → **New Project** → **Import** → **Upload**.
2) Upload this ZIP.
3) Vercel will run:
   - Install: `npm ci`
   - Build: `npm run build`
4) Done. Frontend serves at `/` and API routes are under `/api/*`.

## Environment variables (if your app uses them)
Set these in Vercel → Project → Settings → Environment Variables, then redeploy.

## Local dev
```bash
npm install
npm run dev
```
