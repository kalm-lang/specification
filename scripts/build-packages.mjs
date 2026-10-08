import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceMap = JSON.parse(await readFile(path.join(root, 'specification-map.json'), 'utf8'));
const basePackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = process.env.RELEASE_VERSION;
const versionMatch = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version ?? '');
const majorMinor = versionMatch ? `${versionMatch[1]}.${versionMatch[2]}` : '';
const selected = sourceMap.specifications.find((entry) =>
  entry.majorMinor === majorMinor && entry.status === 'final')
  ?? sourceMap.specifications.find((entry) => entry.majorMinor === majorMinor);

if (!selected) {
  throw new Error(`No specification document is mapped to release version ${version ?? '(empty)'}`);
}

const outputRoot = path.join(root, '.release-packages');
await rm(outputRoot, { recursive: true, force: true });

for (const variant of ['versioned', 'full']) {
  const entries = variant === 'full' ? sourceMap.specifications : [selected];
  const output = path.join(outputRoot, variant);
  await mkdir(path.join(output, 'specifications'), { recursive: true });

  for (const entry of entries) {
    await cp(path.join(root, entry.file), path.join(output, entry.file));
  }

  const packageJson = {
    ...basePackage,
    version: variant === 'full' ? `${version}-full` : version,
  };
  delete packageJson.devDependencies;

  await Promise.all([
    writeFile(path.join(output, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`),
    writeFile(path.join(output, 'specification-map.json'), `${JSON.stringify({
      ...sourceMap,
      latest: version,
      latestSpecification: variant === 'full' ? sourceMap.latestSpecification : selected.majorMinor,
      specifications: entries,
    }, null, 2)}\n`),
    cp(path.join(root, 'README.md'), path.join(output, 'README.md')),
    cp(path.join(root, 'LICENSE'), path.join(output, 'LICENSE')),
    cp(path.join(root, 'index.cjs'), path.join(output, 'index.cjs')),
    cp(path.join(root, 'index.mjs'), path.join(output, 'index.mjs')),
    cp(path.join(root, 'index.d.ts'), path.join(output, 'index.d.ts')),
  ]);
}

console.log(`Prepared ${version} and ${version}-full in ${outputRoot}`);
