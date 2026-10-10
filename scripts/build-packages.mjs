import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import frontMatter from '../frontmatter.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await import('./generate-index.mjs');
const { parseFrontMatter } = frontMatter;
const pdfThemes = ['light', 'dark', 'print'];
const documentNames = (await readdir(path.join(root, 'documents')))
  .filter((file) => file.endsWith('.md'))
  .sort();
const documents = await Promise.all(documentNames.map(async (name) => {
  const file = path.posix.join('documents', name);
  const contents = await readFile(path.join(root, file), 'utf8');
  const metadata = parseFrontMatter(contents, file);
  return { file, contents, metadata, version: metadata.version, status: metadata.status };
}));

const compareVersions = (left, right) => {
  const [leftMajor, leftMinor] = left.split('.').map(Number);
  const [rightMajor, rightMinor] = right.split('.').map(Number);
  return leftMajor - rightMajor || leftMinor - rightMinor;
};
const latestVersion = documents
  .filter((entry) => entry.status === 'final')
  .map((entry) => entry.version)
  .sort(compareVersions)
  .at(-1);
if (!latestVersion) throw new Error('The documents folder must contain at least one final specification');

const basePackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = process.env.RELEASE_VERSION;
const versionMatch = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version ?? '');
const majorMinor = versionMatch ? `${versionMatch[1]}.${versionMatch[2]}` : '';
const selected = documents.find((entry) => entry.version === majorMinor && entry.status === 'final');
if (!selected) throw new Error(`No final specification document exists for release version ${version ?? '(empty)'}`);

function enrichedMetadata(entry) {
  return {
    ...entry.metadata,
    majorMinor: entry.version,
    specificationVersion: entry.status === 'draft' ? `${entry.version}-draft` : entry.version,
  };
}

function staticModule(entry) {
  return `// Generated from ${entry.file}; edit the Markdown source instead.\n`
    + `export const metadata = Object.freeze(${JSON.stringify(enrichedMetadata(entry))});\n`
    + `export default ${JSON.stringify(entry.contents)};\n`;
}

function typeDefinitions() {
  return [
    'export interface SpecificationFrontMatter {',
    '  title: string;',
    '  version: string;',
    "  status: 'final' | 'draft';",
    '  date: string;',
    '  lastmod: string;',
    '  javaversion: string;',
    '  revision: number;',
    '  [key: string]: string | number | boolean | null;',
    '}',
    'export interface SpecificationMetadata extends SpecificationFrontMatter {',
    '  majorMinor: string;',
    '  specificationVersion: string;',
    '}',
    'export declare const metadata: Readonly<SpecificationMetadata>;',
    'declare const specification: string;',
    'export default specification;',
    '',
  ].join('\n');
}

async function writeStaticModule(output, directory, entry) {
  const modulePath = path.join(output, directory, `${entry.version}.mjs`);
  await mkdir(path.dirname(modulePath), { recursive: true });
  await Promise.all([
    writeFile(modulePath, staticModule(entry)),
    writeFile(modulePath.replace(/\.mjs$/, '.d.mts'), typeDefinitions()),
  ]);
}

function rootApi(entries) {
  const api = { latestVersion, versions: {}, drafts: {} };
  for (const entry of entries) {
    const bucket = entry.status === 'draft' ? api.drafts : api.versions;
    bucket[entry.version] = {
      file: entry.file,
      specificationVersion: entry.status === 'draft' ? `${entry.version}-draft` : entry.version,
      metadata: enrichedMetadata(entry),
      markdown: entry.contents,
    };
  }
  return api;
}

async function writeRootApi(output, entries) {
  const serialized = JSON.stringify(rootApi(entries), null, 2);
  await Promise.all([
    writeFile(path.join(output, 'index.cjs'), `'use strict';\n\nmodule.exports = ${serialized};\n`),
    writeFile(path.join(output, 'index.mjs'), [
      "import specification from './index.cjs';",
      'export const latestVersion = specification.latestVersion;',
      'export const versions = specification.versions;',
      'export const drafts = specification.drafts;',
      '',
    ].join('\n')),
    writeFile(path.join(output, 'index.d.ts'), [
      'export interface SpecificationFrontMatter {',
      '  title: string;',
      '  version: string;',
      "  status: 'draft' | 'final';",
      '  date: string;',
      '  lastmod: string;',
      '  javaversion: string;',
      '  revision: number;',
      '  [key: string]: string | number | boolean | null;',
      '}',
      'export interface SpecificationMetadata extends SpecificationFrontMatter {',
      '  majorMinor: string;',
      '  specificationVersion: string;',
      '}',
      'export interface SpecificationRecord {',
      '  file: string;',
      '  specificationVersion: string;',
      '  metadata: Readonly<SpecificationMetadata>;',
      '  markdown: string;',
      '}',
      'export declare const latestVersion: string;',
      'export declare const versions: Readonly<Record<string, SpecificationRecord>>;',
      'export declare const drafts: Readonly<Record<string, SpecificationRecord>>;',
      '',
    ].join('\n')),
  ]);
}

const outputRoot = process.env.PACKAGE_OUTPUT_DIR
  ? path.resolve(process.env.PACKAGE_OUTPUT_DIR)
  : path.join(root, '.release-packages');
await rm(outputRoot, { recursive: true, force: true });

for (const variant of ['versioned', 'full']) {
  const entries = variant === 'full' ? documents : [selected];
  const output = path.join(outputRoot, variant);
  await mkdir(path.join(output, 'documents'), { recursive: true });
  await mkdir(path.join(output, 'schemas'), { recursive: true });
  await mkdir(path.join(output, 'pdf'), { recursive: true });

  for (const entry of entries) {
    await cp(path.join(root, entry.file), path.join(output, entry.file));
    const documentName = path.parse(entry.file).name;
    for (const theme of pdfThemes) {
      const pdfName = `${documentName}-${theme}.pdf`;
      await cp(path.join(root, 'output', 'pdf', pdfName), path.join(output, 'pdf', pdfName));
    }
    await writeStaticModule(output, entry.status === 'draft' ? 'drafts' : 'versions', entry);
  }

  const packageJson = {
    ...basePackage,
    version: variant === 'full' ? `${version}-full` : version,
  };
  delete packageJson.devDependencies;

  await Promise.all([
    writeFile(path.join(output, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`),
    cp(path.join(root, 'README.md'), path.join(output, 'README.md')),
    cp(path.join(root, 'LICENSE'), path.join(output, 'LICENSE')),
    cp(path.join(root, 'schemas', 'frontmatter.schema.json'), path.join(output, 'schemas', 'frontmatter.schema.json')),
  ]);
  await writeRootApi(output, entries);
}

console.log(`Prepared ${version} and ${version}-full in ${outputRoot}`);
