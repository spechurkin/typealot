import {useEffect, useState} from 'react';
import {Capacitor, CapacitorHttp} from '@capacitor/core';
import {newerVersion, releaseUrl, startUpdateChecks} from '../shared/updates.mjs';
import {t, useLanguage} from './i18n';
import type {UpdateState} from './desktop';

declare const __APP_VERSION__: string;
declare const __UPDATE_MANIFEST__: string;

export default function UpdateNotice({beforeInstall}: { beforeInstall: () => Promise<void> }) {
    useLanguage();
    const [update, setUpdate] = useState<UpdateState | null>(null);
    const [url, setUrl] = useState('');
    const [dismissed, setDismissed] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        let active = true;
        const desktop = window.typealotDesktop;
        if (desktop) {
            const receive = (state: UpdateState | null) => {
                if (active) setUpdate(state);
            };
            const unsubscribe = desktop.onUpdate(receive);
            void desktop.updateState().then(receive).catch(() => {
            });
            return () => {
                active = false;
                unsubscribe();
            };
        }
        const controller = new AbortController();
        const stop = startUpdateChecks(async () => {
            const native = Capacitor.isNativePlatform();
            if (native && !__UPDATE_MANIFEST__) return;
            let manifest;
            if (native) {
                const response = await CapacitorHttp.get({
                    url: releaseUrl(__UPDATE_MANIFEST__),
                    connectTimeout: 20000,
                    readTimeout: 20000,
                    responseType: 'json'
                });
                if (response.status !== 200) return;
                manifest = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
            } else {
                const requestController = new AbortController();
                const cancel = () => requestController.abort();
                controller.signal.addEventListener('abort', cancel, {once: true});
                const timeout = setTimeout(cancel, 20000);
                try {
                    const response = await fetch('/__typealot/version', {
                        cache: 'no-store',
                        credentials: 'omit',
                        signal: requestController.signal
                    });
                    if (!response.ok) return;
                    manifest = await response.json();
                } finally {
                    clearTimeout(timeout);
                    controller.signal.removeEventListener('abort', cancel);
                }
            }
            const release = native ? manifest.android : manifest;
            if (!newerVersion(release?.version, __APP_VERSION__)) return;
            const target = native ? releaseUrl(release.url) : '';
            if (active) {
                setUrl(target);
                setUpdate({status: 'available', version: release.version});
            }
        });
        return () => {
            active = false;
            controller.abort();
            stop();
        };
    }, []);
    if (!update?.version || dismissed === update.version) return null;
    const install = async () => {
        setBusy(true);
        try {
            if (window.typealotDesktop) {
                if (update.status === 'ready') {
                    await beforeInstall();
                    if (!await window.typealotDesktop.installUpdate()) throw Error();
                } else if (!await window.typealotDesktop.downloadUpdate()) throw Error();
            } else if (url) {
                window.location.assign(url);
            } else {
                await beforeInstall();
                window.location.reload();
            }
        } catch {
            setUpdate({...update, status: 'error'});
        } finally {
            setBusy(false);
        }
    };
    return <aside className="update-notice" aria-label={t('updates.title')}>
        <p role="status">{t(update.status === 'error' ? 'updates.failed' : update.status === 'downloading' ? 'updates.downloading' : update.status === 'ready' ? 'updates.ready' : 'updates.available', {version: update.version})}</p>
        <button className="primary" disabled={busy || update.status === 'downloading'}
                onClick={() => void install()}>{t(window.typealotDesktop && update.status !== 'ready' ? 'updates.download' : url ? 'updates.apk' : 'updates.install')}</button>
        <button disabled={busy} onClick={() => setDismissed(update.version!)}>{t('updates.later')}</button>
    </aside>;
}
