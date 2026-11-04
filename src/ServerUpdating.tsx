import {useEffect, useRef, useState} from 'react';
import {t, useLanguage} from './i18n';
import {syncUrl} from './sync';

export default function ServerUpdating({server}: { server: string }) {
    useLanguage();
    const [updating, setUpdating] = useState(false);
    useEffect(() => {
        setUpdating(false);
        if (!server) return;
        let base: string;
        try {
            base = syncUrl(server);
        } catch {
            return;
        }
        let stopped = false, lastActivity = 0;
        let timer: ReturnType<typeof setTimeout>;
        let activityTimer: ReturnType<typeof setTimeout> | undefined;
        const controller = new AbortController();
        const request = async (url: URL, method = 'GET') => {
            const timeoutController = new AbortController();
            const cancel = () => timeoutController.abort();
            controller.signal.addEventListener('abort', cancel, {once: true});
            const timeout = setTimeout(cancel, 5000);
            try {
                return await fetch(url, {
                    method,
                    cache: 'no-store',
                    credentials: 'omit',
                    signal: timeoutController.signal
                });
            } finally {
                clearTimeout(timeout);
                controller.signal.removeEventListener('abort', cancel);
            }
        };
        const poll = async () => {
            try {
                const response = await request(new URL('/__typealot/update', base));
                if (response.ok) {
                    const state = await response.json();
                    if (!stopped && typeof state.updating === 'boolean') setUpdating(state.updating);
                }
            } catch {
            } finally {
                if (!stopped) timer = setTimeout(() => void poll(), 1000);
            }
        };
        const sendActivity = () => {
            lastActivity = Date.now();
            void request(new URL('/__typealot/activity', base), 'POST').catch(() => {
            });
        };
        const activity = (event: Event) => {
            if (!event.isTrusted) return;
            clearTimeout(activityTimer);
            const remaining = 15000 - (Date.now() - lastActivity);
            if (remaining <= 0) sendActivity();
            else activityTimer = setTimeout(sendActivity, remaining);
        };
        const events = ['pointerdown', 'pointermove', 'keydown', 'input', 'wheel'];
        events.forEach(name => window.addEventListener(name, activity, {passive: true}));
        void poll();
        return () => {
            stopped = true;
            controller.abort();
            clearTimeout(timer);
            clearTimeout(activityTimer);
            events.forEach(name => window.removeEventListener(name, activity));
        };
    }, [server]);
    return updating ? <UpdatingDialog/> : null;
}

function UpdatingDialog() {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const previous = document.activeElement;
        const dialog = ref.current!;
        dialog.showModal();
        return () => {
            dialog.close();
            if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
        };
    }, []);
    return <dialog ref={ref} className="server-updating" aria-labelledby="server-updating-title"
                   aria-describedby="server-updating-description" onCancel={event => event.preventDefault()}>
        <span className="server-update-spinner" aria-hidden="true"/>
        <h2 id="server-updating-title" role="status">{t('updates.serverUpdating')}</h2>
        <p id="server-updating-description">{t('updates.serverWait')}</p>
    </dialog>;
}
