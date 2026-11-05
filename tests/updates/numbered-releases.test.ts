import {expect, it, vi} from 'vitest';
import {latestNumberedRelease, RELEASES_API, resolveManifestUrl} from '../../shared/updates.mjs';

const release = (tag_name: string, extra = {}) => ({
    tag_name,
    assets: [{
        name: 'apps.json',
        browser_download_url: `https://github.com/spechurkin/typealot/releases/download/${tag_name}/apps.json`
    }], ...extra
});

it('selects the highest stable version within one channel, regardless of publication order', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify([
        release('android-1.9.0'), release('server-99.0.0'), release('android-latest'),
        release('android-1.10.0'), release('android-2.0.0', {draft: true}),
        release('android-3.0.0', {prerelease: true}), release('android-4.0.0-beta'), release('android-01.0.0')
    ])));
    expect(await resolveManifestUrl(RELEASES_API, 'android', 'apps.json', request)).toBe('https://github.com/spechurkin/typealot/releases/download/android-1.10.0/apps.json');
});

it('continues through pages containing other channels and ignores old compatibility feeds', async () => {
    const request = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(String(url).endsWith('page=1')
        ? Array.from({length: 100}, () => release('desktop-1.0.0')) : [release('server-1.2.0')])));
    expect(await latestNumberedRelease('server', request)).toMatchObject({version: '1.2.0'});
    expect(request).toHaveBeenCalledTimes(2);
});

it('keeps explicit manifest sources and rejects unavailable or incomplete numbered releases', async () => {
    const request = vi.fn(async () => new Response('[]'));
    expect(await resolveManifestUrl('https://example.com/apps.json', 'android', 'apps.json', request)).toBe('https://example.com/apps.json');
    expect(request).not.toHaveBeenCalled();
    await expect(resolveManifestUrl(RELEASES_API, 'android', 'apps.json', request)).rejects.toThrow('manifest missing');
    request.mockResolvedValue(new Response('', {status: 503}));
    await expect(latestNumberedRelease('android', request)).rejects.toThrow('HTTP 503');
    const incomplete = async () => new Response(JSON.stringify([release('android-2.0.0', {assets: []})]));
    await expect(resolveManifestUrl(RELEASES_API, 'android', 'apps.json', incomplete)).rejects.toThrow('manifest missing');
});
