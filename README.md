# Kalm language specifications

This repository holds the versioned Kalm language specifications and publishes
them as `@kalm-lang/specifications` to GitHub Packages.

## Repository layout

- `specifications/` contains the Markdown specification documents. Final
  versions use `v<major>.<minor>.md` (for example, `v1.1.md`); historical drafts
  retain the `-draft` suffix. Names stay short and version-first.
- `specification-map.json` maps each SemVer major/minor series to its document,
  document version, and status. Patch releases in the series point to that same
  document.
- `index.cjs`, `index.mjs`, and `index.d.ts` provide CommonJS, ESM, and
  TypeScript entry points for packages built from this repository.
- `scripts/` prepares the focused and historical package variants and resolves
  the release version.
- `.github/workflows/release.yml` handles tag and manually started releases.

## Published packages

Each release publishes two versions of the same package:

- `@kalm-lang/specifications@1.1.0` contains only the document mapped to
  `1.1.0`.
- `@kalm-lang/specifications@1.1.0-full` contains all documents, including
  historical drafts.

The package version is the release SemVer. The map connects its major/minor
series to the document's own version label, so patch releases can update a
document without changing its identity. Historical draft labels remain intact.
Add a mapping and its Markdown document before releasing a new major or minor
specification version.

## Importing from another project

Configure npm to resolve the organization scope through GitHub Packages and
authenticate with a token that can read the package:

```ini
@kalm-lang:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Then install a focused or full version:

```sh
npm install @kalm-lang/specifications@1.1.0
# Or install the historical bundle:
npm install @kalm-lang/specifications@1.1.0-full
```

Import the Markdown as a string from a versioned module. This uses a static ESM
import; the text is embedded in the module, so no lookup function or file read is
needed at runtime:

```js
import specification from '@kalm-lang/specifications/versions/1.1.0';

console.log(specification);
```

The full package also provides a major/minor alias for each final specification,
such as `@kalm-lang/specifications/versions/1.1`. Draft modules use a separate
explicit path:

```js
import draft from '@kalm-lang/specifications/drafts/1.1-draft';
```

The function API remains available when dynamic selection is useful. Its
listing and lookup return final specifications by default; draft access requires
`includeDrafts: true` or `{ status: 'draft' }`.

The mapping is also available as JSON:

```js
import map from '@kalm-lang/specifications/map' with { type: 'json' };
```

## Releasing

Push a `vX.Y.Z` tag to release that mapped version, or start **Release
specifications** with `workflow_dispatch` and enter an optional `X.Y.Z`. An
empty manual version uses GitVersion. The workflow rejects malformed or
unmapped versions and stops when the GitHub release or tag already exists.
It publishes both package variants and creates a GitHub release with generated
notes.

Versions must use plain `X.Y.Z` SemVer and must have a matching major/minor
series in `specification-map.json`.
