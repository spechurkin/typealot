import {createRequire} from 'node:module';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {expect, it} from 'vitest';

const require = createRequire(import.meta.url);

it('reuses downloaded update metadata and rejects changed metadata', async () => {
    const {DownloadedUpdateHelper} = require('electron-updater/out/DownloadedUpdateHelper');
    await mkdir('test-results', {recursive: true});
    const directory = await mkdtemp(path.resolve('test-results/update-cache-'));
    try {
        const filename = path.join(directory, 'update.exe');
        await writeFile(filename, 'update');
        const helper = new DownloadedUpdateHelper(directory);
        const version = {version: '1.2.3', files: [{url: 'update.exe', sha512: 'abc'}]};
        const file = {url: new URL('https://example.com/update.exe'), info: version.files[0]};
        await helper.setDownloadedFile(filename, null, version, file, 'update.exe', false);
        const sameFile = {url: new URL(file.url), info: structuredClone(file.info)};
        expect(await helper.validateDownloadedPath(filename, structuredClone(version), sameFile, console)).toBe(filename);
        expect(await helper.validateDownloadedPath(filename, {...version, version: '1.2.4'}, file, console)).toBeNull();
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

it('cleans tracked installer directories through callback and synchronous APIs', async () => {
    const temp = require('temp');
    temp.track();
    const first = await temp.mkdir('typealot-compat-');
    await writeFile(path.join(first, 'file.txt'), 'data');
    const counts = await temp.cleanup();
    expect(counts.dirs).toBeGreaterThan(0);
    expect(existsSync(first)).toBe(false);
    const second = temp.mkdirSync('typealot-compat-');
    temp.cleanupSync();
    expect(existsSync(second)).toBe(false);
});
