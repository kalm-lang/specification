import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceMap = JSON.parse(await readFile(path.join(root, 'map.json'), 'utf8'));
const basePackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = process.env.RELEASE_VERSION;
const versionMatch = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version ?? '');
const majorMinor = versionMatch ? `${versionMatch[1]}.${versionMatch[2]}` : '';
const selected = sourceMap.documents.find((entry) =>
  entry.majorMinor === majorMinor && entry.status === 'final');

if (!selected) {
  throw new Error(`No final specification document is mapped to release version ${version ?? '(empty)'}`);
}

const staticModule = async (entry) => {
  const content = JSON.stringify(await readFile(path.join(root, entry.file), 'utf8'));
  return `// Generated from ${entry.file}; edit the Markdown source instead.\n`
    + `export const metadata = Object.freeze(${JSON.stringify({
      majorMinor: entry.majorMinor,
      specificationVersion: entry.specificationVersion,
      status: entry.status,
    })});\n`
    + `export default ${content};\n`;
};

const writeStaticModule = async (output, directory, name, entry) => {
  const modulePath = path.join(output, directory, `${name}.mjs`);
  const typesPath = path.join(output, directory, `${name}.d.mts`);
  await mkdir(path.dirname(modulePath), { recursive: true });
  await Promise.all([
    writeFile(modulePath, await staticModule(entry)),
    writeFile(typesPath, [
      'export interface SpecificationMetadata {',
      '  majorMinor: string;',
      '  specificationVersion: string;',
      "  status: 'final' | 'draft';",
      '}',
      'export declare const metadata: Readonly<SpecificationMetadata>;',
      'declare const specification: string;',
      'export default specification;',
      '',
    ].join('\n')),
  ]);
};

const outputRoot = path.join(root, '.release-packages');
await rm(outputRoot, { recursive: true, force: true });

for (const variant of ['versioned', 'full']) {
  const entries = variant === 'full' ? sourceMap.documents : [selected];
  const output = path.join(outputRoot, variant);
  await mkdir(path.join(output, 'documents'), { recursive: true });
  await mkdir(path.join(output, 'schemas'), { recursive: true });

  for (const entry of entries) {
    await cp(path.join(root, entry.file), path.join(output, entry.file));
    if (entry.status === 'draft') {
      await writeStaticModule(output, 'drafts', entry.specificationVersion, entry);
    } else {
      await writeStaticModule(output, 'versions', entry.majorMinor, entry);
    }
  }

  // Every published package also gets an exact import path for its release.
  // The target must be a final document; draft-only releases are rejected above.
  await writeStaticModule(output, 'versions', version, selected);

  const packageJson = {
    ...basePackage,
    version: variant === 'full' ? `${version}-full` : version,
  };
  delete packageJson.devDependencies;

  await Promise.all([
    writeFile(path.join(output, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`),
    writeFile(path.join(output, 'map.json'), `${JSON.stringify({
      ...sourceMap,
      latestSeries: variant === 'full' ? sourceMap.latestSeries : selected.majorMinor,
      documents: entries,
    }, null, 2)}\n`),
    cp(path.join(root, 'README.md'), path.join(output, 'README.md')),
    cp(path.join(root, 'LICENSE'), path.join(output, 'LICENSE')),
    cp(path.join(root, 'index.cjs'), path.join(output, 'index.cjs')),
    cp(path.join(root, 'index.mjs'), path.join(output, 'index.mjs')),
    cp(path.join(root, 'index.d.ts'), path.join(output, 'index.d.ts')),
    cp(path.join(root, 'schemas', 'map.schema.json'), path.join(output, 'schemas', 'map.schema.json')),
  ]);
}

console.log(`Prepared ${version} and ${version}-full in ${outputRoot}`);
