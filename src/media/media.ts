export type Media = {
    provider: 'youtube' | 'spotify';
    contentType: string;
    externalId: string;
    canonicalUrl: string;
    start: number;
    compact: boolean
};
const ytId = /^[\w-]{11}$/;

function seconds(s: string | null) {
    if (!s) return 0;
    if (/^\d+$/.test(s)) return Math.min(86400, +s);
    const m = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    return m ? Math.min(86400, +(m[1] || 0) * 3600 + +(m[2] || 0) * 60 + +(m[3] || 0)) : 0;
}

export function parseMedia(raw: string): Media | null {
    try {
        const u = new URL(raw.trim());
        if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
        const h = u.hostname.toLowerCase();
        if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtube-nocookie.com'].includes(h)) {
            const p = u.pathname.split('/').filter(Boolean);
            const list = u.searchParams.get('list');
            const id = h === 'youtu.be' ? p[0] : p[0] === 'watch' ? u.searchParams.get('v') : ['shorts', 'embed', 'live'].includes(p[0]) ? p[1] : null;
            if (!id && list && /^[\w-]{10,100}$/.test(list)) return {
                provider: 'youtube',
                contentType: 'playlist',
                externalId: list,
                canonicalUrl: `https://www.youtube.com/playlist?list=${list}`,
                start: 0,
                compact: false
            };
            if (!id || !ytId.test(id)) return null;
            const start = seconds(u.searchParams.get('t') || u.searchParams.get('start'));
            return {
                provider: 'youtube',
                contentType: p[0] === 'shorts' ? 'short' : 'video',
                externalId: id,
                canonicalUrl: `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ''}`,
                start,
                compact: false
            };
        }
        if (h === 'open.spotify.com') {
            const p = u.pathname.split('/').filter(Boolean).filter(s => !/^intl-[a-z]+$/.test(s));
            if (p[0] === 'embed') p.shift();
            if (!['track', 'album', 'playlist', 'artist', 'show', 'episode'].includes(p[0]) || !/^[A-Za-z0-9]{22}$/.test(p[1] || '')) return null;
            return {
                provider: 'spotify',
                contentType: p[0],
                externalId: p[1],
                canonicalUrl: `https://open.spotify.com/${p[0]}/${p[1]}`,
                start: 0,
                compact: false
            };
        }
    } catch { /* Invalid URLs remain ordinary text. */
    }
    return null;
}

export function safeMedia(value: unknown): Media | null {
    const m = value as Media;
    if (!m || typeof m.canonicalUrl !== 'string') return null;
    const parsed = parseMedia(m.canonicalUrl);
    return parsed && parsed.provider === m.provider && parsed.externalId === m.externalId ? {
        ...parsed,
        ...(m.contentType === 'short' && parsed.provider === 'youtube' && parsed.contentType === 'video' ? {contentType: 'short'} : {}),
        compact: !!m.compact
    } : null;
}

export function embedUrl(m: Media) {
    if (m.provider === 'spotify') return `https://open.spotify.com/embed/${m.contentType}/${m.externalId}?utm_source=typealot`;
    const base = m.contentType === 'playlist' ? `videoseries?list=${m.externalId}&` : `${m.externalId}?`;
    return `https://www.youtube.com/embed/${base}start=${m.start}&playsinline=1&autoplay=0&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;
}
