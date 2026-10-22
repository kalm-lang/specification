import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import frontMatter from '../validation/frontmatter.cjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const pdfThemes = ['light', 'dark', 'print'];
export const identityFor = metadata => metadata.version + (metadata.status === 'final' ? '' : `-${metadata.status}`);

export function compareVersions(left, right) {
    const a = left.split('.').map(Number);
    const b = right.split('.').map(Number);
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export async function loadEditions(directory = root) {
    const names = (await readdir(path.join(directory, 'documents'))).filter(name => name.endsWith('.md')).sort();
    return Promise.all(names.map(async name => {
        const file = `documents/${name}`;
        const markdown = await readFile(path.join(directory, file), 'utf8');
        const metadata = frontMatter.parseFrontMatter(markdown, file);
        if (name !== `v${identityFor(metadata)}.md`) throw new Error(`${file} does not match its version and status`);
        const entry = {file, markdown, metadata};
        const changeFile = `changes/${name}`;
        try {
            const changeMarkdown = await readFile(path.join(directory, changeFile), 'utf8');
            // Plain-Markdown companions inherit metadata from their target edition.
            entry.changes = {
                file: changeFile,
                markdown: changeMarkdown,
                metadata: {...metadata, title: 'Kalm Language Specification Changes'},
            };
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        return entry;
    }));
}

export function selectEditions(entries, {version, all = false} = {}) {
    if (all) return entries;
    const identity = version ?? entries.filter(e => e.metadata.status === 'final')
        .map(e => e.metadata.version).sort(compareVersions).at(-1);
    const selected = entries.filter(e => identityFor(e.metadata) === identity);
    if (!selected.length) throw new Error(`No specification document found for ${identity ?? 'the latest final version'}`);
    return selected;
}

export function parseBuildOptions(args) {
    const options = {themes: [], all: false};
    for (let i = 0; i < args.length; i++) {
        const option = args[i];
        if (option === '--all') options.all = true;
        else if (['--version', '--theme', '--output-dir'].includes(option)) {
            const value = args[++i];
            if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
            if (option === '--theme') options.themes.push(value);
            else if (option === '--version') options.version = value;
            else options.outputDir = path.resolve(value);
        } else throw new Error(`Unknown option: ${option}`);
    }
    if (options.all && options.version) throw new Error('Use either --all or --version, not both');
    if (options.version && !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?!final$)[a-z][a-z0-9-]*)?$/.test(options.version)) {
        throw new Error('Use X.Y.Z with an optional -status suffix for --version');
    }
    if (options.themes.some(theme => theme !== 'all' && !pdfThemes.includes(theme))) {
        throw new Error('Unsupported theme; choose light, dark, print, or all');
    }
    options.themes = !options.themes.length || options.themes.includes('all')
        ? [...pdfThemes] : [...new Set(options.themes)];
    return options;
}

export function pdfName(entry, theme, changes = false) {
    return `v${identityFor(entry.metadata)}${changes ? '-changes' : ''}-${theme}.pdf`;
}
