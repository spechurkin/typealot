import {afterEach, expect, it, vi} from 'vitest';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
// @ts-expect-error Node release tooling.
import {publishRelease} from '../../scripts/release/publish-release.mjs';

const pkg = {version: '1.2.3', serverVersion: '1.2.0'};
const temporary: string[] = [];
afterEach(async () => {
    await Promise.all(temporary.splice(0).map(directory => rm(directory, {recursive: true, force: true})));
});

async function fixture(channel: string, {published = false, draft = false} = {}) {
    const directory = await mkdtemp(path.join(tmpdir(), 'typealot-publish-test-'));
    temporary.push(directory);
    const version = channel === 'server' ? pkg.serverVersion : pkg.version;
    const tag = `${channel}-${version}`;
    const asset = channel === 'android' ? 'app.apk' : channel === 'server' ? 'server.json.gz' : 'setup.exe';
    const manifest = channel === 'android' ? 'apps.json' : channel === 'server' ? 'server.json' : 'latest.yml';
    for (const name of [asset, manifest]) await writeFile(path.join(directory, name), 'built');
    const uploaded: { tag: string, name: string, body: string }[] = [];
    const gh = vi.fn(async (args: string[]) => {
        const [, command, target] = args;
        if (command === 'view') {
            if (target === tag && (published || draft)) return JSON.stringify({isDraft: draft});
            throw Error('release not found');
        }
        if (command === 'download') {
            const destination = args[args.indexOf('--dir') + 1];
            await mkdir(destination, {recursive: true});
            for (const name of [asset, manifest]) await writeFile(path.join(destination, name), 'published');
        }
        if (command === 'upload') {
            for (const file of args.slice(3).filter(value => value !== '--clobber')) {
                uploaded.push({tag: target, name: path.basename(file), body: await readFile(file, 'utf8')});
            }
        }
        return '';
    });
    return {directory, gh, uploaded, tag, asset, manifest};
}

it.each(['android', 'desktop', 'server'])('publishes only a complete numbered %s release', async channel => {
    const f = await fixture(channel);
    await publishRelease(channel, {...f, pkg, sha: 'commit'});
    expect(f.uploaded.slice(0, 2)).toEqual([
        {tag: f.tag, name: f.asset, body: 'built'},
        {tag: f.tag, name: f.manifest, body: 'built'}
    ]);
    expect(f.uploaded).toHaveLength(2);
    const calls = f.gh.mock.calls.map(([args]) => args);
    expect(calls.find(args => args[1] === 'create' && args[2] === f.tag)).toEqual(expect.arrayContaining(['--draft', '--title', `${channel[0].toUpperCase()}${channel.slice(1)} ${channel === 'server' ? pkg.serverVersion : pkg.version}`]));
    const publication = calls.findIndex(args => args[1] === 'edit' && args[2] === f.tag);
    expect(calls[publication]).toContain('--draft=false');
    expect(calls[publication]).toContain(channel === 'desktop' ? '--latest' : '--latest=false');
    expect(calls.every(args => !args.includes(`${channel}-latest`))).toBe(true);
});

it('never replaces a published numbered release, even when retrying with a different build', async () => {
    const f = await fixture('android', {published: true});
    await publishRelease('android', {...f, pkg, sha: 'commit'});
    expect(f.uploaded).toHaveLength(0);
    expect(f.gh).toHaveBeenCalledTimes(1);
    expect(f.gh.mock.calls.some(([args]) => ['edit', 'create', 'upload'].includes(args[1]) && args[2] === f.tag)).toBe(false);
});

it('resumes an unfinished draft without creating another release', async () => {
    const f = await fixture('server', {draft: true});
    await publishRelease('server', {...f, pkg, sha: 'commit'});
    expect(f.gh.mock.calls.some(([args]) => args[1] === 'create')).toBe(false);
    expect(f.uploaded.filter(file => file.tag === f.tag)).toHaveLength(2);
});

it('keeps a failed upload unpublished and leaves the update feed alone', async () => {
    const f = await fixture('android');
    const gh = async (args: string[]) => {
        if (args[1] === 'upload') throw Error('upload failed');
        return f.gh(args);
    };
    await expect(publishRelease('android', {...f, gh, pkg, sha: 'commit'})).rejects.toThrow('upload failed');
    expect(f.gh.mock.calls.some(([args]) => args[1] === 'edit' || args[2] === 'android-latest')).toBe(false);
});

it('fails closed when GitHub cannot confirm whether a numbered release exists', async () => {
    const gh = vi.fn(async () => {
        throw Error('HTTP 503');
    });
    await expect(publishRelease('android', {gh, pkg, sha: 'commit'})).rejects.toThrow('HTTP 503');
    expect(gh).toHaveBeenCalledTimes(1);
});
