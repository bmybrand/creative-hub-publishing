# Creative Hub Publishing

Publishing website with responsive layouts, branded assets, scroll animations, and publishing-process tabs.

## Run locally

```bash
npm install
npm run preview -- ./output/bookwhisk
```

Open http://localhost:3456.

## Project files

- `output/bookwhisk/`: complete website and local assets.
- `scripts/creative-hub/`: shared styles, banner, counters, and browser checks.
- `scripts/rebrand-creative-hub.mjs`: applies the shared branding and runtime changes.
- `src/`: website cloning and preview CLI.

After editing the shared branding files, run:

```bash
node scripts/rebrand-creative-hub.mjs
```

## Checks

```bash
npm run typecheck
npm run build
```

With the preview server running:

```bash
node scripts/creative-hub/check-scroll.mjs
node scripts/creative-hub/check-process-tabs.mjs
```

Contact details are placeholders. Sign Up is currently hidden in navigation.

## Deploy to Vercel

Import this repository with the Root Directory set to the repository root. The checked-in `vercel.json` serves `output/bookwhisk` directly, with no install or build step. The website is already generated; `npm run build` builds the cloning CLI, not the website.

If an earlier deployment failed looking for `public`, deploy the latest commit. Keep the Framework Preset as Other.
