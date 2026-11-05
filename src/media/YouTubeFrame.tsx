import {type TranslationKey, useLanguage} from '../locales/i18n';
import {useEffect, useRef} from 'react';
import {youtubeApi, youtubeError} from './youtube';

export default function YouTubeFrame({src, error}: { src: string; error: (message: TranslationKey) => void }) {
    useLanguage();
    const container = useRef<HTMLDivElement>(null), onError = useRef(error);
    onError.current = error;
    useEffect(() => {
        const frame = document.createElement('iframe');
        frame.src = src;
        frame.title = 'YouTube';
        frame.width = '820';
        frame.height = '461';
        frame.loading = 'eager';
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        frame.allow = 'encrypted-media; fullscreen; picture-in-picture';
        frame.allowFullscreen = true;
        frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups');
        frame.onerror = () => onError.current('media.loadFailed');
        container.current!.append(frame);
        let active = true, player: { destroy: () => void } | undefined;
        void youtubeApi().then(api => {
            if (active) player = new api.Player(frame, {
                events: {
                    onError: event => {
                        if (active) onError.current(youtubeError(event.data));
                    }
                }
            });
        }).catch(() => {/* The iframe can still play if the optional control script is blocked. */
        });
        return () => {
            active = false;
            player?.destroy();
            frame.remove();
        };
    }, [src]);
    return <div className="youtube-frame" ref={container}/>;
}
