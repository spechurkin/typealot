import {appendFile, readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {newerVersion, releaseUrl} from '../shared/updates.mjs';

export function validateReleaseTag(tag, pkg) {
    if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag) || tag !== `v${pkg.version}`) throw Error('Release tag must equal v' + pkg.version);
    if (!newerVersion(pkg.serverVersion, '0.0.0')) throw Error('serverVersion must be a stable version greater than 0.0.0');
}

export function assertNewRelease(candidate, published) {
    if (!newerVersion(candidate, published)) throw Error(`Refusing to replace published version ${published} with ${candidate}. Increase the corresponding version in package.json.`);
}

export async function guardRelease(channel, phase, {pkg, tag, request = fetch, env = process.env, skipPublished = false} = {}) {
    validateReleaseTag(tag, pkg);
    const bases = {
        desktop: env.TYPEALOT_DESKTOP_UPDATE_URL || 'https://github.com/spechurkin/typealot/releases/download/desktop-latest/',
        server: env.TYPEALOT_RELEASE_URL || 'https://github.com/spechurkin/typealot/releases/download/server-latest/'
    };
    if (!['desktop', 'android', 'server'].includes(channel)) throw Error('Unknown release channel');
    if (phase !== 'publish') return;
    const url = channel === 'android' ? 'https://github.com/spechurkin/typealot/releases/download/android-latest/apps.json' : new URL(channel === 'server' ? 'server.json' : 'latest.yml', releaseUrl(bases[channel])).href;
    const response = await request(url, {cache: 'no-store', signal: AbortSignal.timeout(20000)});
    if (response.status === 404) return;
    if (!response.ok) throw Error(`Cannot check published release: HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > 65536) throw Error('Release manifest too large');
    const published = channel === 'desktop' ? text.match(/^version:\s*['"]?([0-9]+\.[0-9]+\.[0-9]+)['"]?\s*$/m)?.[1] : channel === 'android' ? JSON.parse(text).android?.version : JSON.parse(text).version;
    if (!newerVersion(published, '0.0.0')) throw Error('Invalid published release version');
    const candidate = channel === 'server' ? pkg.serverVersion : pkg.version;
    if (skipPublished && candidate === published) return false;
    assertNewRelease(candidate, published);
    if (channel === 'android') {
        const previousCode = JSON.parse(text).android?.versionCode;
        const nextCode = Number(env.ANDROID_VERSION_CODE);
        if (!Number.isInteger(nextCode) || nextCode < 1 || nextCode > 2100000000) throw Error('Invalid ANDROID_VERSION_CODE');
        if (previousCode !== undefined && (!Number.isInteger(previousCode) || nextCode <= previousCode)) throw Error('ANDROID_VERSION_CODE must increase for every release');
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    guardRelease(process.argv[2], process.argv[3], {pkg, tag: process.env.GITHUB_REF_NAME, skipPublished: true}).then(async result => {
        if (result === false) console.log('This channel version is already published; skipping uploads.');
        if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `publish=${result !== false}\n`);
    }).catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
