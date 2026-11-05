import {afterEach, expect, it, vi} from 'vitest';
import {gunzipSync, gzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {newerVersion, releaseUrl, startUpdateChecks, UPDATE_INTERVAL} from '../../shared/updates.mjs';
// @ts-expect-error Node-only deployment code has no browser declarations.
import {decodeBundle} from '../../server/server-update.mjs';

const {deploymentBundle} = createRequire(import.meta.url)('../../electron/ssh-install.cjs');
afterEach(() => vi.useRealTimers());

it('compares numeric release versions and rejects malformed versions and downgrades', () => {
    expect(newerVersion('1.10.0', '1.9.9')).toBe(true);
    for (const candidate of ['0.9.0', '1.0.0', '1.0.0-beta', '01.1.0', 'garbage', null]) expect(newerVersion(candidate, '1.0.0')).toBe(false);
    expect(() => releaseUrl('http://example.com/update')).toThrow();
    expect(() => releaseUrl('https://user:secret@example.com/update')).toThrow();
});

it('checks immediately and every half hour, retries after failure, and cleans up', async () => {
    vi.useFakeTimers();
    const check = vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue(undefined);
    const errors = vi.fn();
    const stop = startUpdateChecks(check, {onError: errors});
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL - 1);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL * 2);
    expect(check).toHaveBeenCalledTimes(2);
});

it('does not overlap slow checks', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const check = vi.fn(() => new Promise<void>(resolve => {
        finish = resolve;
    }));
    const stop = startUpdateChecks(check);
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL * 3);
    expect(check).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL);
    expect(check).toHaveBeenCalledTimes(2);
    stop();
    finish();
});

it('packages a complete server with an independent version, and rejects traversal and incomplete releases', async () => {
    const body = await deploymentBundle();
    const files = decodeBundle(body);
    const pkg = createRequire(import.meta.url)('../../package.json');
    expect(JSON.parse(Buffer.from(files['package.json'], 'base64').toString())).toMatchObject({
        version: pkg.serverVersion || pkg.version,
        appVersion: pkg.appVersion || pkg.version,
        dependencies: {ws: expect.any(String)}
    });
    expect(files['scripts/realtime.mjs']).toBeTruthy();
    for (const name of ['scripts/../workspace.json', 'dist/../../etc/passwd', 'dist\\escape', 'dist//escape']) {
        expect(() => decodeBundle(gzipSync(JSON.stringify({
            ...files,
            [name]: 'AA=='
        })))).toThrow('Invalid deployment path');
    }
    const incomplete = JSON.parse(gunzipSync(body).toString());
    delete incomplete['scripts/server-update.mjs'];
    expect(() => decodeBundle(gzipSync(JSON.stringify(incomplete)))).toThrow('Incomplete release');
});
