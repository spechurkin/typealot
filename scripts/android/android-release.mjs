import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectApk} from './android-apk-name.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const versionCode = Number(process.env.ANDROID_VERSION_CODE);
if (!Number.isInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) throw Error('ANDROID_VERSION_CODE must be an integer between 1 and 2100000000');
const apkDirectory = path.join(root, 'android/app/build/outputs/apk/release');
const metadata = JSON.parse(await readFile(path.join(apkDirectory, 'output-metadata.json'), 'utf8'));
if (metadata.elements?.length !== 1) throw Error('Expected one standalone release APK');
const output = metadata.elements[0];
if (output.versionCode !== versionCode) throw Error('APK versionCode does not match ANDROID_VERSION_CODE');
const apk = path.join(apkDirectory, output.outputFile);
const {name, version} = await inspectApk(apk, root, output.filters);
if (version !== pkg.version) throw Error('APK versionName does not match package.json');
const destination = path.join(root, 'release/android');
await mkdir(destination, {recursive: true});
await copyFile(apk, path.join(destination, name));
await writeFile(path.join(destination, 'apps.json'), JSON.stringify({
    android: {
        version: pkg.version,
        versionCode,
        url: `https://github.com/spechurkin/typealot/releases/download/android-${pkg.version}/${name}`
    }
}, null, 2));
console.log(`Packaged ${name}`);
