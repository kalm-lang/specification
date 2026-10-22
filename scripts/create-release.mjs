import {cp, mkdir, writeFile, access} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {identityFor, loadEditions, parseBuildOptions, pdfName, root, selectEditions} from './editions.mjs';

// Prepare a concrete release without publishing it; also used by the packaging tests.
export async function prepareRelease(options, directory = root, environment = process.env) {
    if (options.all || options.outputDir) throw new Error('Releases use one edition from generated/release-packages/versioned');
    const packageDir = path.join(directory, 'generated', 'release-packages', 'versioned');
    const editions = await loadEditions(packageDir);
    if (editions.length !== 1) throw new Error('Expected exactly one focused specification edition');
    const [entry] = selectEditions(editions, options);
    const identity = identityFor(entry.metadata);
    const tag = `v${identity}`;
    const title = `${entry.metadata.title} ${identity}`;
    const repository = environment.GITHUB_REPOSITORY ?? 'kalm-lang/specification';
    const server = environment.GITHUB_SERVER_URL ?? 'https://github.com';
    const baseUrl = `${server}/${repository}/releases/download/${tag}`;
    const staging = path.join(directory, 'generated', 'release-assets', identity);
    await mkdir(staging, {recursive: true});
    const assets = [path.join(packageDir, entry.file)];
    const links = [`- [Markdown specification](${baseUrl}/${path.basename(entry.file)})`];
    if (entry.changes) {
        // Specification and companion source share a basename; GitHub asset names must be unique.
        const changeAsset = path.join(staging, `v${identity}-changes.md`);
        await cp(path.join(packageDir, entry.changes.file), changeAsset);
        assets.push(changeAsset);
        links.push(`- [Markdown changes](${baseUrl}/${path.basename(changeAsset)})`);
    }
    for (const changes of [false, ...(entry.changes ? [true] : [])]) {
        for (const theme of options.themes) {
            const name = pdfName(entry, theme, changes);
            const asset = path.join(packageDir, 'generated', 'pdf', name);
            await access(asset);
            assets.push(asset);
            links.push(`- [${changes ? 'Changes' : 'Specification'} PDF (${theme})](${baseUrl}/${name})`);
        }
    }
    const notes = [
        '## Published documents', '', ...links, '',
        '## Published packages', '',
        `- Focused: \`@kalm-lang/specification@${identity}\``,
        `- Historical bundle: \`@kalm-lang/specification@${identity}-full\``, '',
    ].join('\n');
    const notesFile = path.join(staging, 'notes.md');
    await writeFile(notesFile, notes);
    return {tag, title, notes, notesFile, assets, prerelease: entry.metadata.status !== 'final'};
}

async function main() {
    const options = parseBuildOptions(process.argv.slice(2));
    options.version ??= process.env.RELEASE_VERSION;
    const release = await prepareRelease(options);
    const args = ['release', 'create', release.tag, ...release.assets, '--verify-tag', '--title', release.title,
        '--notes-file', release.notesFile, ...(release.prerelease ? ['--prerelease'] : [])];
    const result = spawnSync('gh', args, {stdio: 'inherit'});
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => { console.error(error); process.exitCode = 1; });
}
