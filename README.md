# Kalm language specification

This repository contains the versioned Kalm language specification. The
Markdown files in [documents/](documents/) are the source of truth. JavaScript packages and PDFs are generated from them.

## Versions and status

Every document uses an `X.Y.Z` version. `final` is the default release status and has no
suffix. Drafts and other statuses use `-<status>` in the filename, Git tag, and
package version. Status names are lowercase, such as `draft` or `candidate`.

Examples:

- [`v1.1.0.md`](documents/v1.1.0.md): final `1.1.0` specification.
- [`v1.1.0-draft.md`](documents/v1.1.0-draft.md): draft `1.1.0` specification.
- A candidate could be named `v1.2.0-candidate.md` with `status: 'candidate'`.

Each document starts with front matter validated against
[`schemas/frontmatter.schema.json`](schemas/frontmatter.schema.json). For
example:

```yaml
---
$schema: '../schemas/frontmatter.schema.json'
title: 'Kalm Language Specification'
version: '1.1.0'
status: 'final'
date: '2026-10-10'
lastmod: '2026-10-10'
javaversion: '25'
---
```

## Use the published package

The package is published to GitHub Packages. Configure npm with a token that
can read the `kalm-lang` package:

```ini
@kalm-lang:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Install one final or draft edition, or the historical bundle containing all
documents:

```sh
npm install @kalm-lang/specification@1.1.0
npm install @kalm-lang/specification@1.1.0-draft
npm install @kalm-lang/specification@1.1.0-full
```

The package root exports static data: `versions` contains final editions and
`drafts` contains non-final editions, keyed by their version and status.

```js
import { drafts, latestVersion, versions } from '@kalm-lang/specification';

const finalMarkdown = versions['1.1.0'].markdown;
const draftMarkdown = drafts['1.1.0-draft'].markdown;
console.log(latestVersion, finalMarkdown, draftMarkdown);
```

Each edition can also be imported directly as a Markdown string, with its
front matter exported as `metadata`:

```js
import specification, { metadata } from '@kalm-lang/specification/versions/1.1.0';
```

The schema is available from `@kalm-lang/specification/schema`.

## Build PDFs

Install the development dependencies and generate light, dark, and print PDFs
for the latest final edition:

```sh
npm install
npm run build:pdfs
```

Use `npm run build:pdfs -- --version 1.1.0-draft` to select another edition,
`--theme print` to build one theme, or `--all` to build every edition. PDFs are
written to [`output/pdf/`](output/pdf/).

## Release

Push `vX.Y.Z` for a final edition or `vX.Y.Z-<status>` for a non-final edition.
Alternatively, run the **Release specification** workflow and enter a version
and status. An empty status or `final` omits the suffix; an empty version
selects the latest final edition. The workflow validates the selected document,
builds its PDFs, publishes a focused package and a historical bundle, and
attaches the Markdown and PDFs to a GitHub release.

## Repository layout

- [`documents/`](documents/) — source Markdown editions.
- [`schemas/`](schemas/) — front matter JSON Schema.
- [`scripts/`](scripts/) — front matter, PDF, index, and release-package tooling.
- [`templates/`](templates/) — shared PDF layout and cover template.
- [`tests/`](tests/) — PDF layout and pagination checks.
- [`.github/workflows/`](.github/workflows/) — automated release workflow.
- [`output/`](output/) — locally generated PDFs; ignored by Git.

At the repository root, [`frontmatter.cjs`](frontmatter.cjs) parses and validates
document metadata. [`index.cjs`](index.cjs), [`index.mjs`](index.mjs), and
[`index.d.ts`](index.d.ts) are the generated package API and type declarations.
