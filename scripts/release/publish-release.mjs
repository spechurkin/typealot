import {execFileSync} from 'node:child_process';
import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateReleaseTag} from './release-guard.mjs';

const channels = {
    android: {title: 'Android', notes: 'Android APK.', manifest: name => name === 'apps.json'},
    desktop: {title: 'Desktop', notes: 'Windows, macOS and Linux builds.', manifest: name => name.endsWith('.yml')},
    server: {title: 'Server', notes: 'Synchronization server.', manifest: name => name === 'server.json'}
};

export async function publishRelease(channel, {
    pkg,
    sha,
    gh,
    directory = `release/${channel}`
} = {}) {
    const config = channels[channel];
    if (!config) throw Error('Unknown release channel');
    validateReleaseTag(`v${pkg.version}`, pkg);
    const version = channel === 'server' ? pkg.serverVersion : pkg.version;
    const tag = `${channel}-${version}`;
    const title = `${config.title} ${version}`;
    const latest = channel === 'desktop' ? '--latest' : '--latest=false';
    // A published numbered release is permanent; only unfinished drafts can be resumed.
    let release;
    try {
        release = JSON.parse(await gh(['release', 'view', tag, '--json', 'isDraft']));
    } catch (error) {
        if (!/release not found/i.test(`${error.message}\n${error.stderr || ''}`)) throw error;
    }
    if (release && !release.isDraft) return;
    const files = (await readdir(directory, {withFileTypes: true})).filter(entry => entry.isFile()).map(entry => entry.name);
    const metadata = files.filter(config.manifest);
    const assets = files.filter(name => !config.manifest(name));
    if (!assets.length || !metadata.length) throw Error('Release assets or metadata missing');
    if (!release) await gh(['release', 'create', tag, '--draft', '--title', title, '--notes', config.notes, '--target', sha, '--latest=false']);
    await gh(['release', 'upload', tag, ...assets.map(name => path.join(directory, name)), '--clobber']);
    await gh(['release', 'upload', tag, ...metadata.map(name => path.join(directory, name)), '--clobber']);
    await gh(['release', 'edit', tag, '--draft=false', '--prerelease=false', '--title', title, latest]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    publishRelease(process.argv[2], {
        pkg,
        sha: process.env.GITHUB_SHA,
        gh: args => execFileSync('gh', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']})
    }).catch(error => {
        console.error(error.stderr?.toString() || error.message);
        process.exitCode = 1;
    });
}
