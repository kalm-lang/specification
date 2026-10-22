# Kalm language specification

The Markdown files in [documents/](documents/) are the source of truth for versioned language editions.
Optional [changes/](changes/) companions describe edition comparisons, breaking changes, and migration guidance.
The build produces static JavaScript/TypeScript package exports and separate PDFs for each available document.

## Folder overview

- [`documents/`](documents/): source Markdown editions.
- [`changes/`](changes/): optional companions with the same basename as their target edition.
- [`validation/`](validation/): the JSON front-matter schema and CommonJS parser/validator.
- [`scripts/`](scripts/): build, package, and release tooling.
- [`templates/`](templates/): shared PDF layout templates.
- [`tests/`](tests/): package, release, highlighting, and PDF layout checks.
- [`generated/`](generated/): package API, edition/change modules, PDFs, and release bundles.

## Versions and metadata

Each edition uses an `X.Y.Z` version. `final` has no suffix; other statuses use a lowercase `-<status>` suffix in
filenames, tags, and package versions. For example, `documents/v1.1.0.md` is final and
`documents/v1.2.0-draft.md` is a draft. An optional companion is `changes/v1.2.0-draft.md`.
A companion is plain Markdown and inherits its target edition's version, status, dates, and Java baseline.
It is not another language edition and does not affect latest-version selection. A missing companion is valid.

Specification front matter is validated by [`validation/frontmatter.cjs`](validation/frontmatter.cjs) against
[`validation/frontmatter.schema.json`](validation/frontmatter.schema.json):

```yaml
---
$schema: '../validation/frontmatter.schema.json'
title: 'Kalm Language Specification'
version: '1.1.0'
status: 'final'
date: '2026-10-10'
lastmod: '2026-10-10'
javaversion: '25'
---
```

Specification PDFs use the exact title **Kalm Language Specification**, including the PDF metadata and page header.
Companion PDFs use **Kalm Language Specification Changes**. Versions and statuses appear separately on the cover
and in the PDF subject. PDF source references are clickable; relative Markdown links target source documents and
anchors under the matching Git release tag, keeping them portable outside a local checkout. Relocating validation
changes only the schema path in historical edition front matter;
historical language rules remain unchanged.

## Install and check

Configure a GitHub Packages token with read access to the Kalm packages as `KALM_PACKAGES_READ_TOKEN`.
The checked-in `.npmrc` selects GitHub Packages for `@kalm-lang` and the lockfile records registry tarballs and integrity
hashes. No sibling checkout or local tarball is required.

```sh
npm ci
npm test
```

Use `npm install` when intentionally updating dependencies and commit the resulting `package-lock.json`.
The highlighter is pinned to published `@kalm-lang/syntax-highlighting@1.1.0`; the formerly pinned `0.1.0` is not
published. `npm ci` verifies reproducible installs locally and in GitHub Actions.

## Use the published package

Consumers configure package access, then install a focused edition or historical bundle:

```ini
@kalm-lang:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${KALM_PACKAGES_READ_TOKEN}
```

```sh
npm install @kalm-lang/specification@1.1.0
npm install @kalm-lang/specification@1.2.0-draft
npm install @kalm-lang/specification@1.1.0-full
```

The package root exports static records. Final editions are in `versions`, other statuses in `drafts`, and existing
companions in `changes`, keyed by target edition identity. A missing companion has no record.

```js
import {changes, drafts, latestVersion, versions} from '@kalm-lang/specification';

const finalMarkdown = versions['1.1.0']?.markdown;
const draftMarkdown = drafts['1.2.0-draft']?.markdown;
const migrationMarkdown = changes['1.2.0-draft']?.markdown;
console.log(latestVersion, finalMarkdown, draftMarkdown, migrationMarkdown);
```

Edition and companion subpaths export a Markdown string plus `metadata`:

```js
import specification, {metadata} from '@kalm-lang/specification/versions/1.1.0';
import draft from '@kalm-lang/specification/drafts/1.2.0-draft';
import migration from '@kalm-lang/specification/changes/1.2.0-draft';
```

Only included editions/companions have importable subpaths. Raw Markdown is shipped under `documents/` and `changes/`;
for example `@kalm-lang/specification/changes/v1.2.0-draft.md` resolves to the raw companion file. Type declarations
accompany every generated module. `latestVersion` is the newest included final edition, or `null` in a focused draft
package; the repository and historical bundles retain the latest historical final.

The schema is exported as `@kalm-lang/specification/schema` and
`@kalm-lang/specification/validation/frontmatter.schema.json`; the former
`@kalm-lang/specification/schemas/frontmatter.schema.json` export remains a compatibility alias.
The CommonJS validator is exported as `@kalm-lang/specification/validation/frontmatter.cjs`.

## Build documents and packages

The conventional build refreshes all package exports and generates PDFs for the latest **final** edition:

```sh
npm run build
```

Local PDF builds default to all three themes: light, dark, and print. Select another edition or repeat `--theme`
to choose a subset:

```sh
npm run build -- --version 1.2.0-draft --theme dark --theme print
npm run build:pdfs -- --version 1.2.0-draft --theme light
npm run build:pdfs -- --all --theme print
npm run build:index
```

`build:pdfs` only builds PDFs; `build:index` only refreshes package exports/modules. `--all` selects every edition and
its available companion; it cannot be combined with `--version`. `--theme all` explicitly selects all themes.
`--output-dir <directory>` changes the PDF output directory.

PDFs are written to [`generated/pdf/`](generated/pdf/):

- `v1.2.0-draft-dark.pdf`: specification.
- `v1.2.0-draft-changes-dark.pdf`: optional changes companion.

Prepare focused and historical publication packages after building the same edition and themes:

```sh
npm run build:packages -- --version 1.2.0-draft --theme dark --theme print
```

Packages are written under `generated/release-packages/versioned/` and `generated/release-packages/full/`.
The focused package includes one edition and its available companion; the historical package includes all editions
and available companions. Both include PDFs only for the selected release edition and requested themes. Missing
requested PDFs are errors; missing companion documents are not. Stale light PDFs are never copied into a dark/print
package. All package exports and validation files are self-contained. Package outputs may be redirected with
`--output-dir` to a child of this workspace. `RELEASE_VERSION` and `PACKAGE_OUTPUT_DIR` remain supported as fallbacks.

## Release

Push `vX.Y.Z` for a final release or `vX.Y.Z-<status>` otherwise, or dispatch the **Release specification** workflow
with a version and optional status. Empty version selects the latest final; empty status or `final` selects a final
edition. A leading hyphen on a non-final status is accepted in manual input. Final tags omit `-final`.

The workflow uses `npm ci`, runs `npm test`, builds **dark and print only**, prepares both package variants, publishes
them, and attaches the selected Markdown documents and PDFs to a GitHub release. Local tooling continues to support
light PDFs; workflow theme flags alone restrict release output. PDF tests in the workflow use `PDF_TEST_THEME=dark`
so CI does not generate light previews either.

All script entry points are npm commands: `build`, `build:index`, `build:pdfs`, `build:packages`, `test`, `test:pdfs`,
`release:resolve`, and `release:github`. The release commands read the workflow environment; `release:resolve` is run
with npm's `--silent` option when writing GitHub outputs. `release:github` validates the prepared package's exact
assets, stages a uniquely named `v<edition>-changes.md` when present, writes release notes to a file, and invokes
`gh release create`. It does not rebuild packages or publish npm packages.

The workflow's `KALM_PACKAGES_READ_TOKEN` installs dependencies; its repository token publishes packages and the release.
