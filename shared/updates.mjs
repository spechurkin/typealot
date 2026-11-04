export const UPDATE_INTERVAL = 30 * 60 * 1000;

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
