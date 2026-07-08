# Deploying AskVault

AskVault is a fully static, zero-backend SPA. Any static host works; configs for
two are included.

`npm run build` → everything ships from `dist/` (app shell, workers, WASM, the
generated service worker `sw.js`, and `manifest.webmanifest`).

## Vercel

`vercel.json` is pre-configured (build command, `dist` output, SPA rewrite, and
immutable caching for hashed `/assets/*`). Just import the repo, or:

```bash
npm i -g vercel && vercel        # preview
vercel --prod                    # production
```


