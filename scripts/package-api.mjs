import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {compareVersions, identityFor} from './editions.mjs';

export const recordTypes = `export interface SpecificationFrontMatter {
  title: string;
  version: string;
  status: string;
  date: string;
  lastmod: string;
  javaversion: string;
  [key: string]: string | number | boolean | null;
}
export interface SpecificationMetadata extends SpecificationFrontMatter {
  specificationVersion: string;
}
export interface SpecificationRecord {
  file: string;
  specificationVersion: string;
  metadata: Readonly<SpecificationMetadata>;
  markdown: string;
}
`;

export function metadataFor(entry) {
    return {...entry.metadata, specificationVersion: identityFor(entry.metadata)};
}

function record(entry) {
    return {
        file: entry.file,
        specificationVersion: identityFor(entry.metadata),
        metadata: metadataFor(entry),
        markdown: entry.markdown,
    };
}

export async function writeRootApi(directory, entries) {
    const latest = entries.filter(e => e.metadata.status === 'final').map(e => e.metadata.version).sort(compareVersions).at(-1);
    const api = {latestVersion: latest ?? null, versions: {}, drafts: {}, changes: {}};
    for (const entry of entries) {
        const identity = identityFor(entry.metadata);
        api[entry.metadata.status === 'final' ? 'versions' : 'drafts'][identity] = record(entry);
        if (entry.changes) api.changes[identity] = record(entry.changes);
    }
    const output = path.join(directory, 'generated', 'package-api');
    await mkdir(output, {recursive: true});
    await Promise.all([
        writeFile(path.join(output, 'index.cjs'), `'use strict';\n\nmodule.exports = ${JSON.stringify(api, null, 2)};\n`),
        writeFile(path.join(output, 'index.mjs'), [
            "import specification from './index.cjs';",
            ...['latestVersion', 'versions', 'drafts', 'changes'].map(key => `export const ${key} = specification.${key};`),
            '',
        ].join('\n')),
        writeFile(path.join(output, 'index.d.ts'), recordTypes
            + 'export declare const latestVersion: string | null;\n'
            + ['versions', 'drafts', 'changes'].map(key => `export declare const ${key}: Readonly<Record<string, SpecificationRecord>>;\n`).join('')),
    ]);
}

export async function writeEditionModule(directory, subdirectory, entry) {
    const output = path.join(directory, 'generated', subdirectory);
    const identity = identityFor(entry.metadata);
    await mkdir(output, {recursive: true});
    await Promise.all([
        writeFile(path.join(output, `${identity}.mjs`),
            `// Generated from ${entry.file}; edit the Markdown source instead.\n`
            + `export const metadata = Object.freeze(${JSON.stringify(metadataFor(entry))});\n`
            + `export default ${JSON.stringify(entry.markdown)};\n`),
        writeFile(path.join(output, `${identity}.d.mts`), recordTypes
            + 'export declare const metadata: Readonly<SpecificationMetadata>;\n'
            + 'declare const markdown: string;\nexport default markdown;\n'),
    ]);
}

export async function writeModules(directory, entries) {
    for (const entry of entries) {
        await writeEditionModule(directory, entry.metadata.status === 'final' ? 'versions' : 'drafts', entry);
        if (entry.changes) await writeEditionModule(directory, 'changes', entry.changes);
    }
    await writeRootApi(directory, entries);
}
