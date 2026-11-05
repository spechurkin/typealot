import {expect, it, vi} from 'vitest';
// @ts-expect-error Node release tooling.
import {validateReleaseTag, guardRelease} from '../../scripts/release/release-guard.mjs';

function publishedRequest(channel: string, manifest: string) {
    const version = channel === 'desktop' ? manifest.match(/version: ([0-9.]+)/)![1] : channel === 'android' ? JSON.parse(manifest).android.version : JSON.parse(manifest).version;
    return async (url: string) => new Response(url.includes('api.github.com') ? JSON.stringify([{tag_name: `${channel}-${version}`, assets: [{name: channel === 'desktop' ? 'latest.yml' : channel === 'android' ? 'apps.json' : 'server.json', browser_download_url: 'https://example.com/manifest'}]}]) : manifest);
}
const pkg = {version: '1.2.3', serverVersion: '0.2.0'};
it('accepts only stable tags that match the application version', () => {
    expect(() => validateReleaseTag('v1.2.3', pkg)).not.toThrow();
    for (const tag of ['v-test', 'v1.2.4', 'v1.2.3-beta', 'v01.2.3', 'desktop-latest', 'server-latest', undefined]) expect(() => validateReleaseTag(tag, pkg)).toThrow();
});
it('allows first publication but fails closed on an unavailable release channel', async () => {
    const options = {pkg, tag: 'v1.2.3', request: vi.fn(async () => new Response('[]'))};
    await expect(guardRelease('server', 'publish', options)).resolves.toBeUndefined();
    options.request.mockResolvedValue(new Response('', {status: 503}));
    await expect(guardRelease('server', 'publish', options)).rejects.toThrow('HTTP 503');
});
it('prevents old or repeated tags from replacing each channel and permits a newer version', async () => {
    for (const channel of ['server', 'android', 'desktop']) {
        const current = channel === 'server' ? pkg.serverVersion : pkg.version;
        const manifest = channel === 'desktop' ? `version: ${current}\n` : JSON.stringify(channel === 'android' ? {android: {version: current}} : {version: current});
        const options = {
            pkg,
            tag: 'v1.2.3',
            env: {ANDROID_VERSION_CODE: '2'},
            request: publishedRequest(channel, manifest)
        };
        await expect(guardRelease(channel, 'publish', options)).rejects.toThrow('Refusing to replace');
        const next = {version: '1.2.4', serverVersion: '0.2.1'};
        await expect(guardRelease(channel, 'publish', {...options, pkg: next, tag: 'v1.2.4'})).resolves.toBeUndefined();
        await expect(guardRelease(channel, 'publish', {
            ...options,
            pkg: {version: '1.0.0', serverVersion: '0.1.0'},
            tag: 'v1.0.0'
        })).rejects.toThrow('Refusing to replace');
    }
});
it('rejects a newer Android version with a reused installation versionCode', async () => {
    const options = {
        pkg,
        tag: 'v1.2.3',
        env: {ANDROID_VERSION_CODE: '5'},
        request: publishedRequest('android', JSON.stringify({android: {version: '1.2.2', versionCode: 5}}))
    };
    await expect(guardRelease('android', 'publish', options)).rejects.toThrow('must increase');
    await expect(guardRelease('android', 'publish', {
        ...options,
        env: {ANDROID_VERSION_CODE: '6'}
    })).resolves.toBeUndefined();
});
it('skips uploads of an already published channel when resuming a partial release, but rejects downgrades', async () => {
    for (const channel of ['server', 'android', 'desktop']) {
        const current = channel === 'server' ? pkg.serverVersion : pkg.version;
        const manifest = channel === 'desktop' ? `version: ${current}\n` : JSON.stringify(channel === 'android' ? {android: {version: current, versionCode: 1}} : {version: current});
        const options = {pkg, tag: 'v1.2.3', skipPublished: true, request: publishedRequest(channel, manifest)};
        await expect(guardRelease(channel, 'publish', options)).resolves.toBe(false);
        await expect(guardRelease(channel, 'publish', {...options, pkg: {version: '1.0.0', serverVersion: '0.1.0'}, tag: 'v1.0.0'})).rejects.toThrow('Refusing to replace');
    }
});
