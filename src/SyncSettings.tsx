import {type DisplayError, errorText, formatDate, t, toError, type TranslationKey, useLanguage} from './i18n';
import {type Dispatch, type SetStateAction, useEffect, useRef, useState} from 'react';
import {uid, type Workspace} from './model';
import {checkpoint, download, listBackups, type LocalBackup} from './storage';
import {
    defaultSync,
    digestWorkspace,
    portableWorkspace,
    synchronize,
    type SyncResult,
    syncServerId,
    type SyncSettings
} from './sync';
import {mergeWorkspaces} from './merge';
import {RealtimeChannel} from './realtime';
import {Modal} from './ui';
import ServerAdmin from './ServerAdmin';
import ServerUpdating from './ServerUpdating';
import {loadSyncSettings, saveSyncSettings} from './sync-cache';

export function useWorkspaceSync(workspace: Workspace | null, replace: Dispatch<SetStateAction<Workspace | null>>) {
    useLanguage();
    const [config, setConfig] = useState<SyncSettings>(defaultSync), [ready, setReady] = useState(false);
    const [state, setState] = useState<TranslationKey | ''>(''), [error, setError] = useState<DisplayError>(''), [busy, setBusy] = useState(false);
    const [conflict, setConflict] = useState<Extract<SyncResult, { kind: 'conflict' }> | null>(null);
    const [backups, setBackups] = useState<LocalBackup[]>([]), [restore, setRestore] = useState<LocalBackup | null>(null);
    const [liveUrl, setLiveUrl] = useState(''), [realtime, setRealtime] = useState<RealtimeChannel | null>(null);
    const current = useRef(workspace);
    current.current = workspace;
    const settings = useRef(config);
    const cacheReadFailed = useRef(false);
    settings.current = config;
    const conflictRef = useRef(conflict);
    conflictRef.current = conflict;
    const running = useRef(false), requested = useRef(false), live = useRef(realtime);
    live.current = realtime;
    const runRef = useRef<(force?: boolean) => Promise<void>>(async () => {
    });
    const schedule = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const requestSync = () => {
        if (running.current) {
            requested.current = true;
            return;
        }
        clearTimeout(schedule.current);
        schedule.current = setTimeout(() => void runRef.current(), 80);
    };
    useEffect(() => () => clearTimeout(schedule.current), []);
    useEffect(() => {
        const controller = new AbortController();
        let cancelled = false;
        void (async () => {
            try {
                const saved = await loadSyncSettings();
                if (cancelled) return;
                if (saved) {
                    const next = {...defaultSync, ...saved, protectLocal: true};
                    settings.current = next;
                    setConfig(next);
                    setReady(true);
                    return;
                }
            } catch {
                cacheReadFailed.current = true;
                if (!cancelled) setError('sync.cacheReadFailed');
                if (!cancelled) setReady(true);
                return;
            }
            try {
                const response = await fetch('/.well-known/typealot', {
                    cache: 'no-store',
                    credentials: 'omit',
                    signal: controller.signal
                });
                if (response.ok && (await response.json()).application === true && !cancelled && !settings.current.url) {
                    const next = {...defaultSync, url: location.origin};
                    settings.current = next;
                    setConfig(next);
                    await saveSyncSettings(next).catch(() => {
                        if (!cancelled) setError('sync.cacheSaveFailed');
                    });
                }
            } catch {
            } finally {
                if (!cancelled) setReady(true);
            }
        })();
        return () => {
            cancelled = true;
            controller.abort();
        };
    }, []);
    const configure = (patch: Partial<SyncSettings>) => {
        if (!ready) return;
        const changed = patch.url !== undefined && patch.url !== settings.current.url;
        const next = {
            ...settings.current, ...patch, ...(changed ? {
                digest: undefined,
                etag: undefined,
                base: undefined,
                protectLocal: false
            } : {})
        };
        settings.current = next;
        setConfig(next);
        if (patch.url !== undefined) cacheReadFailed.current = false;
        if (patch.url !== undefined || (patch.automatic !== undefined && !cacheReadFailed.current)) {
            void saveSyncSettings(next).catch(() => setError('sync.cacheSaveFailed'));
        }
        if (changed) {
            conflictRef.current = null;
            setConflict(null);
            setLiveUrl('');
            setState('');
            setError('');
        }
    };
    useEffect(() => {
        if (!config.automatic || !liveUrl || conflict) return;
        const channel = new RealtimeChannel(liveUrl, requestSync);
        const unsubscribe = channel.subscribe(() => {
            // Rejoin live rooms only after HTTP sync has reconciled the offline changes.
            if (channel.status() === 'offline') setLiveUrl('');
        });
        setRealtime(channel);
        live.current = channel;
        return () => {
            unsubscribe();
            channel.destroy();
            live.current = null;
            setRealtime(null);
        };
    }, [config.url, config.automatic, liveUrl, !!conflict]);
    const replaceCurrent = (next: Workspace) => {
        current.current = next;
        replace(next);
    };
    const accept = async (result: SyncResult, snapshot: Workspace) => {
        if (result.connection?.realtime) setLiveUrl(result.connection.realtime);
        if (result.kind === 'conflict') {
            conflictRef.current = result;
            setConflict(result);
            setState('sync.conflict');
            return;
        }
        const liveWorkspace = current.current!;
        const url = settings.current.url;
        const rebased = mergeWorkspaces(snapshot, liveWorkspace, result.workspace);
        if (rebased.conflicts.length) {
            const next = {
                kind: 'conflict' as const,
                local: liveWorkspace,
                remote: result.workspace,
                workspace: rebased.workspace,
                conflicts: rebased.conflicts,
                etag: result.etag,
                connection: result.connection
            };
            conflictRef.current = next;
            setConflict(next);
            setState('sync.conflict');
            return;
        }
        if (!settings.current.base && await digestWorkspace(liveWorkspace) !== await digestWorkspace(rebased.workspace)) await checkpoint(liveWorkspace);
        const next = {
            ...settings.current,
            digest: result.digest,
            etag: result.etag,
            base: portableWorkspace(result.workspace),
            protectLocal: false
        };
        // Autosave writes the accepted baseline together with the local content in one record.
        const contentChanged = await digestWorkspace(liveWorkspace) !== await digestWorkspace(rebased.workspace);
        const server = await syncServerId(url);
        if (settings.current.url !== url) return;
        if (current.current !== liveWorkspace) return accept(result, snapshot);
        if (contentChanged || liveWorkspace.syncState?.server !== server || liveWorkspace.syncState?.digest !== next.digest || liveWorkspace.syncState?.etag !== next.etag) {
            replaceCurrent({
                ...rebased.workspace,
                syncState: {server, base: next.base, digest: next.digest, etag: next.etag}
            });
        }
        settings.current = next;
        setConfig(next);
        conflictRef.current = null;
        setConflict(null);
        setState(await digestWorkspace(current.current!) === result.digest ? 'sync.synced' : 'sync.unsynced');
    };
    const run = async (force = false) => {
        if (!current.current || !settings.current.url || (!settings.current.automatic && !force) || conflictRef.current) return;
        if (running.current) {
            requested.current = true;
            return;
        }
        if (!navigator.onLine) {
            setState('sync.unsynced');
            setError('sync.offline');
            return;
        }
        const snapshot = current.current, connection = settings.current;
        running.current = true;
        setBusy(true);
        setState('sync.title');
        setError('');
        try {
            const result = await synchronize(snapshot, {...connection, session: live.current?.token});
            if (connection.url === settings.current.url) await accept(result, snapshot);
        } catch (e) {
            if (connection.url === settings.current.url) {
                setState('sync.failed');
                setError(toError(e));
            }
        } finally {
            running.current = false;
            setBusy(false);
            if (requested.current) {
                requested.current = false;
                requestSync();
            }
        }
    };
    runRef.current = run;
    useEffect(() => {
        if (!workspace || !ready || !config.url || conflict) return;
        let cancelled = false;
        void digestWorkspace(workspace).then(hash => {
            if (!cancelled && !running.current) setState(hash === settings.current.digest ? 'sync.synced' : 'sync.unsynced');
        });
        return () => {
            cancelled = true;
        };
    }, [workspace, ready, config.url, config.digest, conflict]);
    useEffect(() => {
        if (!workspace || !ready || !config.automatic || !config.url || conflict) return;
        const timer = setTimeout(() => void runRef.current(), 180);
        return () => clearTimeout(timer);
    }, [workspace, ready, config.automatic, config.url, conflict]);
    useEffect(() => {
        if (!ready || !config.automatic || !config.url) return;
        const poll = setInterval(() => void runRef.current(), realtime ? 15000 : 3000),
            online = () => void runRef.current(),
            visible = () => {
                if (document.visibilityState === 'visible') void runRef.current();
            };
        window.addEventListener('online', online);
        window.addEventListener('focus', online);
        document.addEventListener('visibilitychange', visible);
        return () => {
            clearInterval(poll);
            window.removeEventListener('online', online);
            window.removeEventListener('focus', online);
            document.removeEventListener('visibilitychange', visible);
        };
    }, [ready, config.automatic, config.url, realtime]);
    const refresh = () => void listBackups().then(setBackups).catch(e => setError(toError(e)));
    const resolve = async (keepCopies: boolean) => {
        const pending = conflictRef.current;
        if (!pending || !current.current) return;
        try {
            await checkpoint(current.current);
            const next = mergeWorkspaces(pending.local, current.current, pending.workspace).workspace;
            for (const file of pending.conflicts) {
                const copyTitle = (title: string) => t('collaboration.localCopy', {title});
                if (file.kind === 'boards') {
                    const local = current.current.boards.find(item => item.id === file.id);
                    next.boards = next.boards.filter(item => item.id !== file.id);
                    if (file.remote) next.boards.push(file.remote);
                    if (keepCopies && local) next.boards.push({...local, id: uid(), title: copyTitle(local.title)});
                    continue;
                }
                if (file.kind === 'attachments') {
                    const local = current.current.attachments.find(item => item.id === file.id);
                    next.attachments = next.attachments.filter(item => item.id !== file.id);
                    if (file.remote) next.attachments.push(file.remote);
                    if (keepCopies && local) next.attachments.push({...local, id: uid(), name: copyTitle(local.name)});
                    continue;
                }
                if (file.kind === 'folders') {
                    const local = current.current.folders.find(item => item.id === file.id);
                    next.folders = next.folders.filter(item => item.id !== file.id);
                    if (file.remote) next.folders.push(file.remote);
                    if (keepCopies && local) {
                        const id = uid();
                        next.folders.push({...local, id, name: copyTitle(local.name)});
                        if (!file.remote) {
                            next.notes = next.notes.map(note => note.folderId === file.id ? {
                                ...note,
                                folderId: id
                            } : note);
                            next.folders = next.folders.map(folder => folder.parentId === file.id ? {
                                ...folder,
                                parentId: id
                            } : folder);
                        }
                    }
                    continue;
                }
                next.notes = next.notes.filter(note => note.id !== file.id);
                if (file.remote) next.notes.push({
                    ...file.remote
                });
                const local = current.current.notes.find(note => note.id === file.id);
                if (keepCopies && local) {
                    const {collaboration, ...note} = local;
                    next.notes.push({
                        ...note,
                        id: uid(),
                        title: copyTitle(note.title || t('notes.untitled'))
                    });
                }
            }
            const folders = new Set(next.folders.map(folder => folder.id));
            next.notes = next.notes.map(note => ({
                ...note,
                folderId: note.folderId && folders.has(note.folderId) ? note.folderId : null
            }));
            next.folders = next.folders.map(folder => ({
                ...folder,
                parentId: folder.parentId && folders.has(folder.parentId) ? folder.parentId : null
            }));
            const nextConfig = {
                ...settings.current,
                base: portableWorkspace(pending.remote),
                digest: await digestWorkspace(pending.remote),
                etag: pending.etag,
                protectLocal: false
            };
            settings.current = nextConfig;
            setConfig(nextConfig);
            replaceCurrent(next);
            conflictRef.current = null;
            setConflict(null);
            setError('');
            setState('sync.unsynced');
            requestSync();
        } catch (e) {
            setError(toError(e));
        }
    };
    const panel = <>
        <section id="settings-sync" tabIndex={-1} aria-labelledby="settings-sync-title" className="sync-settings"><h2
            id="settings-sync-title">{t('sync.title')}</h2>
            <label>{t('sync.serverIPOrDomain')}<input type="text" autoComplete="off" placeholder="192.168.1.10"
                                                      disabled={!ready}
                                                      value={config.url}
                                                      onChange={e => configure({url: e.target.value.trim()})}/></label>
            <p>{t('sync.addressDescription')}</p><p>{t('collaboration.syncDescription')}</p>
            <label className="check-label"><input type="checkbox" checked={config.automatic} disabled={!ready}
                                                  onChange={e => configure({automatic: e.target.checked})}/>{t('sync.syncAutomatically')}
            </label>
            <div className="button-row">
                <button disabled={busy || !config.url}
                        onClick={() => void run(true)}>{busy ? t('sync.syncing') : t('sync.syncNow')}</button>
                {conflict && <button onClick={() => setState('sync.conflict')}>{t('sync.resolveConflict')}</button>}
            </div>
            {state && <p role="status">{t(state)}</p>}{error &&
                <p role="alert" className="error">{errorText(error)}</p>}
            <ServerAdmin enabled={!!config.administration} toggle={administration => configure({administration})}/>
        </section>
        <section id="settings-backups" tabIndex={-1} aria-labelledby="settings-backups-title"><h2
            id="settings-backups-title">{t('sync.automaticBackups')}</h2><p>{t('backups.description')}</p>
            <button onClick={refresh}>{t('sync.showLocalBackups')}</button>
            <div className="backup-list">{backups.map(b => <div key={b.id}>
                <time>{formatDate(b.createdAt)}</time>
                <span>{t('backups.noteCount', {count: b.workspace.notes.length})}</span>
                <button
                    onClick={() => download(`Typealot-backup-${b.createdAt}.json`, JSON.stringify(b.workspace))}>{t('sync.export')}</button>
                <button onClick={() => setRestore(b)}>{t('sync.restore')}</button>
            </div>)}</div>
        </section>
        {restore && <Modal title={t('sync.restoreLocalBackup')} close={() => setRestore(null)}>
            <p>{t('backups.restoreDescription')}</p>
            <button className="primary" onClick={async () => {
                try {
                    await checkpoint(current.current!);
                    const restored = structuredClone(restore.workspace);
                    restored.notes = restored.notes.map(({collaboration, ...note}) => note);
                    replaceCurrent(restored);
                    setRestore(null);
                    refresh();
                } catch (e) {
                    setError(toError(e));
                }
            }}>{t('sync.restore')}</button>
        </Modal>}</>;
    const conflictDialog = conflict && state === 'sync.conflict' ?
        <Modal title={t('collaboration.fileConflict')} close={() => setState('sync.unsynced')}>
            <p>{t('collaboration.fileConflictDescription')}</p>
            <ul>{conflict.conflicts.map(file => <li
                key={`${file.kind || 'notes'}:${file.id}`}>{file.title || t('notes.untitled')}</li>)}</ul>
            <div className="button-row">
                <button className="primary" disabled={busy}
                        onClick={() => void resolve(false)}>{t('collaboration.useServerFile')}</button>
                <button disabled={busy} onClick={() => void resolve(true)}>{t('collaboration.keepLocalCopies')}</button>
            </div>
            {error && <p role="alert">{errorText(error)}</p>}
        </Modal> : null;
    return {
        panel,
        conflictDialog: <>{conflictDialog}<ServerUpdating server={config.url}/></>,
        status: config.url ? state : '',
        error,
        realtime
    };
}
