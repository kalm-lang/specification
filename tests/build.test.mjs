import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {PDFDocument, PDFName} from 'pdf-lib';
import {loadEditions, parseBuildOptions, root, selectEditions} from '../scripts/editions.mjs';
import {writeModules} from '../scripts/package-api.mjs';
import {buildPdfs} from '../scripts/build-pdfs.mjs';
import {buildPackages} from '../scripts/build-packages.mjs';
import {prepareRelease} from '../scripts/create-release.mjs';

const require = createRequire(import.meta.url);
const changeMarkdown = '# Changes for 1.2.0\n\nCompanion introduction before any subheading.\n\n## Compatibility\n\nSee the [target](../documents/v1.2.0-draft.md#intro).\n';
const optionsFor = version => parseBuildOptions(['--version', version, '--theme', 'dark', '--theme', 'print']);

async function fixture(run) {
    await mkdir(path.join(root, 'tmp'), {recursive: true});
    const directory = await mkdtemp(path.join(root, 'tmp', 'build-test-'));
    try {
        await mkdir(path.join(directory, 'documents'));
        await mkdir(path.join(directory, 'changes'));
        await mkdir(path.join(directory, 'generated', 'pdf'), {recursive: true});
        for (const file of ['package.json', 'README.md', 'LICENSE']) await cp(path.join(root, file), path.join(directory, file));
        await cp(path.join(root, 'validation'), path.join(directory, 'validation'), {recursive: true});
        for (const [version, status] of [['1.1.0', 'final'], ['1.2.0', 'draft']]) {
            const identity = version + (status === 'final' ? '' : `-${status}`);
            const markdown = [
                '---', "$schema: '../validation/frontmatter.schema.json'", "title: 'Kalm Language Specification'",
                `version: '${version}'`, `status: '${status}'`, "date: '2026-10-11'", "lastmod: '2026-10-22'",
                "javaversion: '25'", '---', '', '# Kalm Language Specification', '', '[main]: #intro', '',
                '## Intro', '', 'A minimal specification body.', '',
            ].join('\n');
            await writeFile(path.join(directory, 'documents', `v${identity}.md`), markdown);
            for (const theme of ['light', 'dark', 'print']) {
                await writeFile(path.join(directory, 'generated', 'pdf', `v${identity}-${theme}.pdf`), `fixture ${identity} ${theme}`);
            }
        }
        await writeFile(path.join(directory, 'changes', 'v1.2.0-draft.md'), changeMarkdown);
        for (const theme of ['light', 'dark', 'print']) {
            await writeFile(path.join(directory, 'generated', 'pdf', `v1.2.0-draft-changes-${theme}.pdf`), `fixture changes ${theme}`);
        }
        await run(directory);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
}

test('local theme defaults retain light while workflow-style repeated flags select dark and print', () => {
    assert.deepEqual(parseBuildOptions([]).themes, ['light', 'dark', 'print']);
    assert.deepEqual(parseBuildOptions(['--theme','light']).themes, ['light']);
    assert.deepEqual(parseBuildOptions(['--theme','dark','--theme','print','--theme','dark']).themes, ['dark','print']);
    for (const args of [['--version'], ['--output-dir'], ['--theme','sepia'], ['--version','1.1.0-final'], ['--all','--version','1.1.0']]) {
        assert.throws(() => parseBuildOptions(args));
    }
});

test('edition loading tolerates missing companions and selects exactly the latest final by default', async () => {
    await fixture(async directory => {
        const entries = await loadEditions(directory);
        assert.equal(selectEditions(entries)[0].metadata.status, 'final');
        assert.equal(selectEditions(entries).length, 1);
        assert.equal(entries[0].changes, undefined);
        assert.equal(entries[1].changes.markdown, changeMarkdown);
        assert.equal(selectEditions(entries, {all:true}).length, 2);
        await rm(path.join(directory, 'changes'), {recursive:true});
        assert.ok((await loadEditions(directory)).every(e => !e.changes));
    });
});

test('generated root and edition modules expose available changes without inventing missing entries', async () => {
    await fixture(async directory => {
        await writeModules(directory, await loadEditions(directory));
        const api = require(path.join(directory,'generated/package-api/index.cjs'));
        assert.equal(api.latestVersion, '1.1.0');
        assert.equal(api.changes['1.1.0'], undefined);
        assert.equal(api.changes['1.2.0-draft'].markdown, changeMarkdown);
        const module = await import(pathToFileURL(path.join(directory,'generated/changes/1.2.0-draft.mjs')));
        assert.equal(module.default, changeMarkdown);
        assert.equal(module.metadata.title, 'Kalm Language Specification Changes');
    });
});

test('PDF builds generate separate companion files and exact document titles', async () => {
    await fixture(async directory => {
        const options = {...optionsFor('1.2.0-draft'), outputDir:path.join(directory,'previews')};
        const outputs = await buildPdfs(options, directory);
        assert.equal(outputs.length, 4);
        assert.ok(outputs.every(file => !file.endsWith('-light.pdf')));
        for (const file of outputs) {
            const pdf = await PDFDocument.load(await readFile(file));
            assert.equal(pdf.getTitle(), path.basename(file).includes('-changes-')
                ? 'Kalm Language Specification Changes' : 'Kalm Language Specification');
            assert.ok(pdf.getPageCount() >= 3);
            if (path.basename(file).includes('-changes-')) {
                const uris = pdf.getPages().flatMap(page => (page.node.Annots()?.asArray() ?? []).flatMap(ref => {
                    const annotation = pdf.context.lookup(ref);
                    const action = annotation.get(PDFName.of('A'));
                    const uri = action?.get(PDFName.of('URI'));
                    return uri ? [uri.decodeText()] : [];
                }));
                assert.ok(uris.includes('https://github.com/kalm-lang/specification/blob/v1.2.0-draft/documents/v1.2.0-draft.md#intro'));
            }
        }
        const withoutCompanion = await buildPdfs({...optionsFor('1.1.0'), outputDir:options.outputDir}, directory);
        assert.equal(withoutCompanion.length, 2);
    });
});

test('packages expose companions to consumers and copy only explicitly selected PDF themes', async () => {
    await fixture(async directory => {
        const output = await buildPackages(optionsFor('1.2.0-draft'), directory);
        for (const variant of ['versioned','full']) {
            const packageDir = path.join(output,variant);
            const pdfs = await readdir(path.join(packageDir,'generated/pdf'));
            assert.equal(pdfs.length, 4);
            assert.ok(pdfs.every(name => !name.endsWith('-light.pdf')));
            assert.equal(await readFile(path.join(packageDir,'changes/v1.2.0-draft.md'),'utf8'),changeMarkdown);
            const result = execFileSync(process.execPath, ['--input-type=module', '--eval', `
                import changes, {metadata} from '@kalm-lang/specification/changes/1.2.0-draft';
                import {changes as records} from '@kalm-lang/specification';
                import {readFileSync} from 'node:fs';
                import {createRequire} from 'node:module';
                const require = createRequire(import.meta.url);
                const raw = readFileSync(new URL(import.meta.resolve('@kalm-lang/specification/changes/v1.2.0-draft.md')), 'utf8');
                const schema = require('@kalm-lang/specification/schema');
                const validator = require('@kalm-lang/specification/validation/frontmatter.cjs');
                if (raw !== changes || records['1.2.0-draft'].markdown !== changes || !validator.parseFrontMatter || !schema.properties) throw Error('Broken exports');
                console.log(metadata.specificationVersion);
            `], {cwd:packageDir, encoding:'utf8'});
            assert.equal(result.trim(),'1.2.0-draft');
        }
        const focused = require(path.join(output,'versioned/generated/package-api/index.cjs'));
        assert.equal(focused.latestVersion,null);
        const full = require(path.join(output,'full/generated/package-api/index.cjs'));
        assert.equal(full.latestVersion,'1.1.0');
        assert.deepEqual(Object.keys(full.versions),['1.1.0']);
    });
});

test('release preparation includes uniquely named Markdown companions and handles absent changes', async () => {
    await fixture(async directory => {
        await buildPackages(optionsFor('1.2.0-draft'), directory);
        const release = await prepareRelease(optionsFor('1.2.0-draft'), directory, {});
        assert.equal(release.assets.length,6);
        assert.equal(new Set(release.assets.map(p=>path.basename(p))).size,6);
        assert.ok(release.prerelease);
        assert.match(release.notes,/v1.2.0-draft-changes.md/);
        assert.doesNotMatch(release.notes,/light/);
        await buildPackages(optionsFor('1.1.0'), directory);
        const final = await prepareRelease(optionsFor('1.1.0'), directory, {});
        assert.equal(final.assets.length,3);
        assert.equal(final.prerelease,false);
        assert.doesNotMatch(final.notes,/Markdown changes|Changes PDF/);
    });
});

test('package preparation rejects missing PDFs before replacing outputs and prevents workspace deletion', async () => {
    await fixture(async directory => {
        const options = optionsFor('1.2.0-draft');
        const output = await buildPackages(options,directory);
        const sentinel = path.join(output,'versioned','keep.txt');
        await writeFile(sentinel,'keep');
        await rm(path.join(directory,'generated/pdf/v1.2.0-draft-changes-print.pdf'));
        await assert.rejects(buildPackages(options,directory), {code:'ENOENT'});
        assert.equal(await readFile(sentinel,'utf8'),'keep');
        await assert.rejects(buildPackages({...options,outputDir:directory},directory), /child directory/);
    });
});

test('release selection accepts normal final tags and rejects an explicit final suffix', () => {
    const run = tag => execFileSync(process.execPath,[path.join(root,'scripts/resolve-release-version.mjs')], {
        cwd:root, encoding:'utf8', stdio:['ignore','pipe','pipe'],
        env:{...process.env,EVENT_NAME:'push',TAG_NAME:tag},
    });
    assert.match(run('v1.1.0'),/^version=1.1.0$/m);
    assert.match(run('v1.2.0-draft'),/^status=draft$/m);
    assert.throws(()=>run('v1.1.0-final'));
});
