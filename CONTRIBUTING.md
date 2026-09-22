# Contributing to ElicitJS

This file covers working on the library from a checkout. If you only want to *use*
ElicitJS, the [README](README.md) and the [documentation site](https://elicitjs.github.io/)
are the place to start.

## Repository layout

ElicitJS is three sibling repositories that expect to sit in one parent directory:

```
elicitJS/
├── elicitjs/              this repo — the library
├── elicitjs-docs/         the documentation SOURCE (Next.js), and the regression surface
└── elicitjs.github.io/    the BUILT documentation, published to GitHub Pages
```

The siblings are not optional. The docs site imports the library through a
`@elicit` → `../elicitjs/src` alias, so it reads your working tree directly — an
edit here shows up in the docs on save, with no build step and no `npm link`. That
is also why the two browser gates below need `../elicitjs-docs` checked out and
installed.

```bash
git clone https://github.com/elicitjs/elicitjs.git
git clone https://github.com/elicitjs/elicitjs-docs.git
cd elicitjs && npm install
cd ../elicitjs-docs && npm install
```

## Everyday commands

```bash
npm run dev            # the docs site, live (wraps ../elicitjs-docs) → http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run dev` | Serve the docs site from the sibling repo (live examples) |
| `npm run build:lib` | Build the publishable ESM bundle → `dist/elicit.js` |
| `npm run build:docs` | Build the docs site → `../elicitjs-docs/.next/` |
| `npm run start:docs` | Serve the docs production build |
| `npm run typecheck` | `tsc --noEmit` against `src/types.d.ts` |
| `npm test` | Unit tests (vitest): dispatch, option validation, the vocabulary gates, a jsdom smoke round-trip |
| `npm run check:exports` | Gate: the runtime surface, `src/index.d.ts` and `src/vocabulary.js` agree in both directions |
| `npm run check:bundle` | Gate: the built bundle still carries its `[elicit]` diagnostics and ships in the tarball |
| `npm run gen:types` | Regenerate `src/authoring/index.d.ts` from the JSDoc |
| `npm run verify:browser` | Regression gate: real Chromium driving gestures over the docs |
| `npm run check:warnings` | Regression gate: zero `[elicit]` warnings on every docs route |

`npm run dev`, `build:docs`, `verify:browser` and `check:warnings` all require the
sibling `../elicitjs-docs`.

## The gates

There is no separate hand-written integration suite: **the documentation is the
regression surface.** Every example on every docs page is a real spec, so an
example that stops behaving is a library bug, and both browser gates read the docs
rather than fixtures.

Run all six before any structural change:

```bash
npm run typecheck && npm run check:exports && npm test && \
npm run build:lib && npm run check:bundle && \
npm run check:warnings && npm run verify:browser
```

`verify:browser` boots a throwaway Next dev server and drives real pointer events,
so it is the only thing that proves out the driver and session state machines.
It is also mildly flaky through no fault of the library — Next compiles routes on
demand, and a prefetch that races a compile can 404 or time out. **A single red run
on a route that passed earlier in the same run is dev-server noise; re-run before
investigating.**

`CLAUDE.md` holds the design invariants this codebase is expected to preserve. Read
it, `ARCHITECTURE.md` and `MARK_CONTRACTS.md` before changing anything structural.

## Publishing the library

```bash
npm version prerelease --preid alpha     # 0.1.0-alpha.N → alpha.N+1
npm publish                              # publishConfig pins --tag alpha
git push && git push --tags
```

`prepublishOnly` runs `build:lib`, so `dist/` is always rebuilt from the committed
source. Check the publish output says **`with tag alpha`** — if it says `latest`,
you are in the wrong directory.

Two things that shipped as real mistakes and are worth guarding against:

- **Run `npm publish` from the repository root.** Publishing from a scratch
  directory publishes *that* directory. Use a subshell (`(cd /tmp/x && npm i …)`)
  or `npm --prefix`, so your shell never leaves the repo.
- **npm only refreshes the package page on publish.** A README fix does not reach
  npmjs.com until the next version goes out.

## Publishing the documentation

The docs site is deployed from the **docs** repo, not this one:

```bash
cd ../elicitjs-docs
npm run deploy:pages                 # build → sync → commit → push
npm run deploy:pages -- --dry-run    # stop before committing, and preview locally
```

`elicitjs.github.io` is generated output. Never edit it by hand — the next deploy
overwrites it. `DEPLOY.json` there records which docs commit produced the live
build, and the script refuses to deploy from an uncommitted tree so that stamp
stays honest (`--allow-dirty` overrides and records the fact).
