# Kalm language specification

This repository contains the versioned Kalm language specification. The
Markdown files in [documents/](documents/) are the source of truth. JavaScript packages and PDFs are generated from
them.

## Folder overview

- [`documents/`](documents/): source Markdown editions.
- [`changes/`](changes/): edition comparisons, breaking changes, and migration guidance.
- [`schemas/`](schemas/): JSON schemas.
- [`scripts/`](scripts/): PDF generation and release tooling.
- [`templates/`](templates/): shared PDF layout templates.
- [`generated/`](generated/): generated package API, edition modules, PDFs, and release bundles.

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
//npm.pkg.github.com/:_authToken=${KALM_PACKAGES_READ_TOKEN}
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
import {drafts, latestVersion, versions} from '@kalm-lang/specification';

const finalMarkdown = versions['1.1.0'].markdown;
const draftMarkdown = drafts['1.1.0-draft'].markdown;
console.log(latestVersion, finalMarkdown, draftMarkdown);
```

Each edition can also be imported directly as a Markdown string, with its
front matter exported as `metadata`:

```js
import specification, {metadata} from '@kalm-lang/specification/versions/1.1.0';
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
written to [`generated/pdf/`](generated/pdf/).

## Release

Push `vX.Y.Z` for a final edition or `vX.Y.Z-<status>` for a non-final edition.
Alternatively, run the **Release specification** workflow and enter a version
and status. Leave status empty or enter `final`/`-final` for a final release;
enter `draft` or `-draft` for a draft. The hyphen is optional. An empty version
selects the latest final edition. The workflow validates the selected document,
builds its PDFs, publishes a focused package and a historical bundle, and
attaches the Markdown and PDFs to a GitHub release.

At the repository root, [`frontmatter.cjs`](frontmatter.cjs) parses and validates
document metadata. The generated package API and type declarations are written to
[`generated/package-api/`](generated/package-api/). Release package bundles are
written to [`generated/release-packages/`](generated/release-packages/).

## Shared syntax highlighting

PDF code blocks use `@kalm-lang/syntax-highlighting@0.1.0`: GitHub light syntax colors for light and print PDFs, and
GitHub dark colors for dark PDFs. The existing page palettes, fonts, wrapping, pagination and source text remain intact.
Highlighting rules preserve current Kalm coverage, including historical spellings; they do not implement the 1.2 draft.

Set `KALM_PACKAGES_READ_TOKEN` with package-read access, then run `npm install --no-package-lock`, `npm run test:pdfs`,
and `npm run build:pdfs`. Before registry publication, install the shared package's local tarball with
`npm install --no-save --no-package-lock <tarball>`. Default manifests resolve the pinned package independently of
sibling checkouts. Once published, commit a registry-backed lockfile. Release installation reads cross-repository
packages with the read token; package publication uses the repository token.
