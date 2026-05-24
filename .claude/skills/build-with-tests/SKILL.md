---
name: build-with-tests
description: >-
  Conventions for building a change and proving it works in this repository.
  Use whenever you implement or verify a feature here (the backend-builder,
  frontend-builder, and test-verifier agents all follow this skill). Covers how
  to install dependencies, build the site, run the verification checks, and add
  new checks so every change is proven before it is reported as done.
---

# build-with-tests

This is a Jekyll site (the `github-pages` gem). It has no unit-test framework
such as RSpec or Jest. Verification here means: the site builds cleanly and the
generated HTML passes `html-proofer`. Treat that build-and-proof step as the
test suite, and follow the same red/green discipline you would with unit tests.

## Commands

- Install dependencies: `script/setup` (runs `bundle install`).
- Run locally: `script/server` (serves the site for manual checking).
- Verify (the test command): `script/cibuild`. This runs:
  - `bundle exec jekyll build --baseurl "."`
  - `htmlproofer _site/index.html --empty-alt-ignore`

`script/cibuild` is the single source of truth for "does this pass." When an
agent definition says "run the tests," run `script/cibuild`.

## Workflow for any change

1. Read CLAUDE.md and the technical brief before editing.
2. Make the smallest change that satisfies one acceptance criterion.
3. Run `script/cibuild`. It must exit 0 with no proofer errors.
4. Repeat per criterion until the brief is fully covered.
5. Report what changed and paste the relevant `script/cibuild` result.

## Red/green discipline

- Before you trust a check, make sure it can fail. If you add a check (for
  example a new page that must contain a link, or an image that must have alt
  text), confirm `script/cibuild` flags the missing/broken case first, then make
  it pass.
- Never report a change as done without a clean `script/cibuild` run.

## Conventions

- Content lives in `_posts/`, `_layouts/`, `_includes/`, and `index.html`.
- Site config is `_config.yml`. Respect existing front matter and layout names.
- Match `.editorconfig` for indentation and whitespace.
- Every `<img>` must have meaningful `alt` text (proofer enforces this; only
  genuinely decorative images may be empty, which `--empty-alt-ignore` permits).
- Internal links must resolve in the built `_site`; do not introduce broken
  links or references to files that do not exist.

## Scope rules for builder agents

- backend-builder edits site generation / data / config concerns and never
  touches presentation-only frontend files outside its brief scope.
- frontend-builder edits layouts, includes, styles, and pages and never touches
  backend/config concerns outside its brief scope.
- If the brief did not anticipate a file you need to touch, flag it rather than
  silently expanding scope.
