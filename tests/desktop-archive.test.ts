import {createRequire} from 'node:module';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {afterEach, expect, it} from 'vitest';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const {verifyDesktopArchive} = require('../scripts/verify-desktop-archive.cjs');
const directories: string[] = [];
afterEach(async () => {
    asar.uncacheAll();
    for (const directory of directories.splice(0)) await rm(directory, {recursive: true, force: true});
});

async function archive(locale = '{"desktop.startupFailed":"Ошибка запуска"}') {
    const parent = path.resolve('test-results');
    await mkdir(parent, {recursive: true});
    const directory = await mkdtemp(path.join(parent, 'archive-'));
    directories.push(directory);
    const source = path.join(directory, 'source');
    await mkdir(path.join(source, 'src/locales'), {recursive: true});
    await writeFile(path.join(source, 'package.json'), JSON.stringify({main: 'main.cjs'}));
    await writeFile(path.join(source, 'main.cjs'), 'module.exports = {};');
    await writeFile(path.join(source, 'src/locales/ru.json'), locale);
    const target = path.join(directory, 'app.asar');
    await asar.createPackage(source, target);
    return target;
}

it('accepts an intact archive and rejects changed bytes in its body', async () => {
    const target = await archive();
    expect(verifyDesktopArchive(target)).toBe(3);
    const contents = await readFile(target);
    const position = contents.lastIndexOf(Buffer.from('Ошибка запуска'));
    expect(position).toBeGreaterThan(0);
    contents[position] ^= 1;
    await writeFile(target, contents);
    asar.uncacheAll();
    expect(() => verifyDesktopArchive(target)).toThrow(/integrity check failed: src[/\\]locales[/\\]ru.json/);
});

it('rejects invalid locale JSON even when its archive checksum is correct', async () => {
    const target = await archive(') { let busy = false;');
    expect(() => verifyDesktopArchive(target)).toThrow(SyntaxError);
});
