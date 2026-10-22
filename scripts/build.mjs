import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

for (const [script, args] of [['generate-index.mjs', []], ['build-pdfs.mjs', process.argv.slice(2)]]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...args], {stdio: 'inherit'});
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}
