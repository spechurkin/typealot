import {LocalizedError} from './i18n';

type Player = { destroy: () => void };
type YouTubeApi = {
    Player: new(frame: HTMLIFrameElement, options: { events: { onError: (event: { data: number }) => void } }) => Player
};
declare global {
    interface Window {
        YT?: YouTubeApi;
        onYouTubeIframeAPIReady?: () => void
    }
}
let loading: Promise<YouTubeApi> | null = null;

export function youtubeApi(): Promise<YouTubeApi> {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (loading) return loading;
    loading = new Promise<YouTubeApi>((resolve, reject) => {
        const previous = window.onYouTubeIframeAPIReady;
        const timeout = setTimeout(() => {
            loading = null;
            script.remove();
            reject(new LocalizedError('errors.youTubeAPIIsUnavailable'));
        }, 20000);
        window.onYouTubeIframeAPIReady = () => {
            previous?.();
            clearTimeout(timeout);
            if (window.YT?.Player) resolve(window.YT); else {
                loading = null;
                reject(new LocalizedError('errors.youTubeAPIDidNotLoad'));
            }
        };
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        script.onerror = () => {
            clearTimeout(timeout);
            loading = null;
            script.remove();
            reject(new LocalizedError('errors.youTubeAPIIsUnavailable'));
        };
        document.head.append(script);
    });
    return loading;
}

export const youtubeError = (code: number) => code === 101 || code === 150 ? 'media.youtubeEmbeddingDisabled' : code === 100 ? 'media.youtubeUnavailable' : code === 153 ? 'media.youtubeUnverified' : 'media.youtubePlaybackFailed';
