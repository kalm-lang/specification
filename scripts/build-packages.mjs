import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {identityFor, loadEditions, parseBuildOptions, pdfName, root, selectEditions} from './editions.mjs';
import {writeModules} from './package-api.mjs';

export async function buildPackages(options, directory = root) {
    if (options.all) throw new Error('Package builds select one release; the full variant includes historical editions automatically');
    const entries = await loadEditions(directory);
    const [selected] = selectEditions(entries, options);
    const version = identityFor(selected.metadata);
    const basePackage = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    const outputRoot = options.outputDir ?? path.join(directory, 'generated', 'release-packages');
    const absoluteRoot = path.resolve(outputRoot);
    const relativeRoot = path.relative(path.resolve(directory), absoluteRoot);
    if (!relativeRoot || relativeRoot.startsWith('..') || path.isAbsolute(relativeRoot)) {
        throw new Error('Package output must be a child directory of the specification workspace');
    }
    // Validate all required inputs before replacing either prepared package.
    const pdfs = [];
    for (const changes of [false, ...(selected.changes ? [true] : [])]) {
        for (const theme of options.themes) {
            const name = pdfName(selected, theme, changes);
            await readFile(path.join(directory, 'generated', 'pdf', name));
            pdfs.push(name);
        }
    }
    for (const variant of ['versioned', 'full']) {
        const editionEntries = variant === 'full' ? entries : [selected];
        const output = path.resolve(absoluteRoot, variant);
        if (path.dirname(output) !== absoluteRoot) throw new Error('Invalid package output path');
        await rm(output, {recursive: true, force: true});
        await mkdir(path.join(output, 'generated', 'pdf'), {recursive: true});
        for (const entry of editionEntries) {
            for (const record of [entry, ...(entry.changes ? [entry.changes] : [])]) {
                await mkdir(path.dirname(path.join(output, record.file)), {recursive: true});
                await cp(path.join(directory, record.file), path.join(output, record.file));
            }
        }
        // Both variants include only the selected edition's explicitly requested PDF themes.
        for (const name of pdfs) {
            await cp(path.join(directory, 'generated', 'pdf', name), path.join(output, 'generated', 'pdf', name));
        }
        const packageJson = {...basePackage, version: variant === 'full' ? `${version}-full` : version};
        delete packageJson.devDependencies;
        delete packageJson.scripts;
        await Promise.all([
            writeFile(path.join(output, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n'),
            cp(path.join(directory, 'README.md'), path.join(output, 'README.md')),
            cp(path.join(directory, 'LICENSE'), path.join(output, 'LICENSE')),
            cp(path.join(directory, 'validation'), path.join(output, 'validation'), {recursive: true}),
        ]);
        await writeModules(output, editionEntries);
    }
    console.log(`Prepared ${version} and ${version}-full in ${absoluteRoot}`);
    return absoluteRoot;
}

async function main() {
    const options = parseBuildOptions(process.argv.slice(2));
    options.version ??= process.env.RELEASE_VERSION;
    options.outputDir ??= process.env.PACKAGE_OUTPUT_DIR ? path.resolve(process.env.PACKAGE_OUTPUT_DIR) : undefined;
    await buildPackages(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => { console.error(error); process.exitCode = 1; });
}
