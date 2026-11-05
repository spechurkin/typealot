import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
await patch('electron-updater', '6.8.11', 'out/DownloadedUpdateHelper.js',
    'require("lodash.isequal")', 'require("lodash.isequal/isEqual")');
// rimraf 6 returns a promise; temp still supplies its legacy callback and retry option.
await patch('temp', '0.9.4', 'lib/temp.js',
    "let rimraf     = require('rimraf');",
    `const {rimraf: remove, rimrafSync: removeSync} = require('rimraf');
const removalOptions = options => ({maxRetries: options.maxBusyTries});
const rimraf = (target, options, callback) => remove(target, removalOptions(options)).then(() => callback(null), callback);
rimraf.sync = (target, options) => removeSync(target, removalOptions(options));`);

async function patch(name, version, file, before, after) {
    const directory = path.join(root, 'node_modules', name);
    const installed = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')).version;
    if (installed !== version) throw Error(`Review the dependency migration for ${name}@${installed}.`);
    const filename = path.join(directory, file);
    const source = await readFile(filename, 'utf8');
    if (source.includes(after)) return;
    if (source.split(before).length !== 2) throw Error(`Unexpected dependency import in ${filename}.`);
    await writeFile(filename, source.replace(before, after));
}
