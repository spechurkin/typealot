export const UPDATE_INTERVAL = 30 * 60 * 1000;
export const RELEASES_API = 'https://api.github.com/repos/spechurkin/typealot/releases';

export async function latestNumberedRelease(channel, request = fetch) {
    if (!['desktop', 'android', 'server'].includes(channel)) throw Error('Unknown release channel');
    let latest = null;
    for (let page = 1; page <= 100; page++) {
        const response = await request(`${RELEASES_API}?per_page=100&page=${page}`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(20000)
        });
        if (!response.ok) throw Error(`Release HTTP ${response.status}`);
        const releases = await response.json();
        if (!Array.isArray(releases)) throw Error('Invalid release list');
        for (const release of releases) {
            const version = release.tag_name?.startsWith(`${channel}-`) ? release.tag_name.slice(channel.length + 1) : '';
            if (release.draft || release.prerelease || !newerVersion(version, '0.0.0')) continue;
            if (!latest || newerVersion(version, latest.version)) latest = {...release, version};
        }
        if (releases.length < 100) return latest;
    }
    throw Error('Release list too large');
}

export async function resolveManifestUrl(source, channel, filename, request = fetch) {
    if (source !== RELEASES_API) return releaseUrl(source);
    const release = await latestNumberedRelease(channel, request);
    const asset = release?.assets?.find(asset => asset.name === filename);
    if (!asset) throw Error('Release manifest missing');
    return releaseUrl(asset.browser_download_url);
}

export function newerVersion(candidate, current) {
    const parse = value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) ? value.split('.').map(Number) : null;
    const a = parse(candidate), b = parse(current);
    if (!a || !b) return false;
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
}

export function releaseUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw Error('HTTPS release URL required');
    return url.href;
}

export function startUpdateChecks(check, {
    interval = UPDATE_INTERVAL, onError = () => {
    }
} = {}) {
    let busy = false, stopped = false;
    const run = async () => {
        if (busy || stopped) return;
        busy = true;
        try {
            await check();
        } catch (error) {
            if (!stopped) onError(error);
        } finally {
            busy = false;
        }
    };
    void run();
    const timer = setInterval(() => void run(), interval);
    return () => {
        stopped = true;
        clearInterval(timer);
    };
}
