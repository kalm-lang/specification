import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import frontMatter from '../frontmatter.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { parseFrontMatter } = frontMatter;
const files = (await readdir(path.join(root, 'documents')))
  .filter((file) => file.endsWith('.md'))
  .sort();
const records = await Promise.all(files.map(async (name) => {
  const file = `documents/${name}`;
  const markdown = await readFile(path.join(root, file), 'utf8');
  const metadata = parseFrontMatter(markdown, file);
  return { file, markdown, metadata };
}));
const compare = (left, right) => {
  const [leftMajor, leftMinor] = left.split('.').map(Number);
  const [rightMajor, rightMinor] = right.split('.').map(Number);
  return leftMajor - rightMajor || leftMinor - rightMinor;
};
const latestVersion = records
  .filter(({ metadata }) => metadata.status === 'final')
  .map(({ metadata }) => metadata.version)
  .sort(compare)
  .at(-1);
if (!latestVersion) throw new Error('No final specification document found');

const api = { latestVersion, versions: {}, drafts: {} };
for (const { file, markdown, metadata } of records) {
  const bucket = metadata.status === 'draft' ? api.drafts : api.versions;
  bucket[metadata.version] = {
    file,
    specificationVersion: metadata.status === 'draft' ? `${metadata.version}-draft` : metadata.version,
    metadata: { ...metadata, majorMinor: metadata.version,
      specificationVersion: metadata.status === 'draft' ? `${metadata.version}-draft` : metadata.version },
    markdown,
  };
}

await Promise.all([
  writeFile(path.join(root, 'index.cjs'), `'use strict';\n\nmodule.exports = ${JSON.stringify(api, null, 2)};\n`),
  writeFile(path.join(root, 'index.mjs'), [
    "import specification from './index.cjs';",
    'export const latestVersion = specification.latestVersion;',
    'export const versions = specification.versions;',
    'export const drafts = specification.drafts;',
    '',
  ].join('\n')),
  writeFile(path.join(root, 'index.d.ts'), [
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
