# Kalm language specification

This repository contains the versioned Kalm language specifications and
publishes them as `@kalm-lang/specification` to GitHub Packages.

## Documents and metadata

The Markdown files in [`documents/`](documents/) are the source of truth. Build
scripts discover every `*.md` file in that folder; no separate document map is
maintained. Each file starts with YAML front matter validated against
[`schemas/frontmatter.schema.json`](schemas/frontmatter.schema.json). The
front matter is also exported in the JavaScript API. `revision` is a quoted
positive integer, normally `1`, and is incremented when the same version and
status must be re-released. Revisions above `1` add `-rN` to the release tag
and package version, such as `v1.1.0-r2` for revision `2` of a final release.

The visible Markdown heading and concise edition details follow the front
matter. The `[main]` reference points to the first section included in generated
PDFs, allowing PDFs to use the metadata for their cover without repeating the
Markdown preface.

Documents use `X.Y.Z` version identities and filenames such as `v1.1.0.md` or
`v1.1.0-draft.md`. Final releases omit a status suffix; other statuses use
`-<status>` in filenames, Git tags, and package versions:

- `@kalm-lang/specification@1.1.0` contains the final `1.1.0` document.
- `@kalm-lang/specification@1.1.0-draft` contains the `1.1.0` draft document.
- `@kalm-lang/specification@1.1.0-full` contains all documents, including
  historical drafts.

## Importing

Configure npm to resolve the organization scope through GitHub Packages and
authenticate with a token that can read the package:

```ini
@kalm-lang:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Then install a package:

```sh
npm install @kalm-lang/specification@1.1.0
# Or install the historical bundle:
npm install @kalm-lang/specification@1.1.0-full
```

The root API is static data: each edition record contains the Markdown and all
front matter fields. It exposes `latestVersion`, final `versions`, and `drafts`;
there are no runtime document lookup functions or file reads.

```js
import { drafts, latestVersion, versions } from '@kalm-lang/specification';

const markdown = versions['1.1.0'].markdown;
const metadata = versions['1.1.0'].metadata;
const latestDraft = drafts['1.1.0-draft'];

console.log(latestVersion, metadata.revision, latestDraft?.metadata.status);
```

Each document is also available as a static ESM module. It exports the Markdown
as its default value and its front matter as `metadata`:

```js
import specification, { metadata } from '@kalm-lang/specification/versions/1.1.0';
import draft from '@kalm-lang/specification/drafts/1.1.0-draft';

console.log(specification, metadata.javaversion, draft);
```

The schema is published at `@kalm-lang/specification/schema` and
`@kalm-lang/specification/schemas/frontmatter.schema.json`.

## PDFs

Generate light, dark, and print editions with Node.js:

```sh
npm install
npm run build:pdfs
```

By default, the build selects the latest final specification version and
generates its three theme PDFs. Select a document with
`npm run build:pdfs -- --version 1.1.0` for its final version, or pass
`1.1.0-draft` (or another status suffix) to generate that status. Use
`npm run build:pdfs -- --all` to generate every version.

Choose one theme with `npm run build:pdfs -- --theme print` (also accepts
`light` or `dark`). Outputs are named `<document>-<theme>.pdf` in `output/pdf/`.

The renderer measures content before placing it: headings stay with the start
of their sections, short paragraphs and examples stay together, and longer
paragraphs avoid single lines at page edges. Code preserves indentation when
wrapped and prefers source boundaries when split. Tables size columns from
their content and repeat headers on subsequent pages. Contents entries include
page numbers and links to the corresponding sections.

When the last page is almost empty, a bounded reflow pass tries slightly tighter
body spacing without changing font sizes. It is used only when it removes a page.

Run the layout and pagination regression checks with `npm run test:pdfs`.

## Releasing

Push a `vX.Y.Z` tag for a final specification or `vX.Y.Z-<status>` for another
status, or start **Release specification** with `workflow_dispatch`. Enter an
X.Y.Z version and choose a status; empty or `final` omits the suffix. An empty
version selects the latest final version. The workflow validates the tag and
status against front matter and stops when the GitHub release or npm package
version already exists.

The workflow generates all three PDF themes for the release's target version,
prepares focused and historical Markdown packages, and attaches the matching
Markdown and PDFs to the GitHub release. Both packages include the PDFs for
that release; the historical package retains Markdown and static APIs for every
specification version.
Git tags, specification identities, and npm package versions use `X.Y.Z`, with
`-<status>` for non-final releases.
