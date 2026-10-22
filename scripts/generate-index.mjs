import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import frontMatter from '../frontmatter.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'generated', 'package-api');
const {parseFrontMatter} = frontMatter;
const files = (await readdir(path.join(root, 'documents')))
    .filter((file) => file.endsWith('.md'))
    .sort();
const records = await Promise.all(files.map(async (name) => {
    const file = `documents/${name}`;
    const markdown = await readFile(path.join(root, file), 'utf8');
    const metadata = parseFrontMatter(markdown, file);
    const expectedName = `v${metadata.version}${metadata.status === 'final' ? '' : `-${metadata.status}`}.md`;
    if (name !== expectedName) throw new Error(`${file} must be named documents/${expectedName} for its version and status`);
    return {file, markdown, metadata};
}));
const compare = (left, right) => {
    const [leftMajor, leftMinor, leftPatch] = left.split('.').map(Number);
    const [rightMajor, rightMinor, rightPatch] = right.split('.').map(Number);
    return leftMajor - rightMajor || leftMinor - rightMinor || leftPatch - rightPatch;
};
const latestVersion = records
    .filter(({metadata}) => metadata.status === 'final')
    .sort((left, right) => compare(left.metadata.version, right.metadata.version))
    .at(-1);
if (!latestVersion) throw new Error('No final specification document found');

const identityFor = (metadata) => metadata.status === 'final' ? metadata.version : `${metadata.version}-${metadata.status}`;
const api = {latestVersion: identityFor(latestVersion.metadata), versions: {}, drafts: {}};
for (const {file, markdown, metadata} of records) {
    const bucket = metadata.status === 'final' ? api.versions : api.drafts;
    const identity = identityFor(metadata);
    const specificationVersion = identity;
    bucket[identity] = {
        file,
        specificationVersion,
        metadata: {...metadata, specificationVersion},
        markdown,
    };
}

await mkdir(output, {recursive: true});
await Promise.all([
    writeFile(path.join(output, 'index.cjs'), `'use strict';\n\nmodule.exports = ${JSON.stringify(api, null, 2)};\n`),
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
        '  status: string;',
        '  date: string;',
        '  lastmod: string;',
        '  javaversion: string;',
        '  [key: string]: string | number | boolean | null;',
        '}',
        'export interface SpecificationMetadata extends SpecificationFrontMatter {',
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
