import {
    type DisplayError,
    errorText,
    LocalizedError,
    t,
    toError,
    type TranslationKey,
    useLanguage
} from '../locales/i18n';
import {useState} from 'react';
import {syncUrl} from '../sync/sync';
import SshInstaller from './SshInstaller';

type Config = { maxUploadMb: number; backupCount: number; backupRetentionMonths: number; workspaceExists: boolean };
export default function ServerAdmin({enabled, toggle}: { enabled: boolean; toggle: (enabled: boolean) => void }) {
    useLanguage();
    const [host, setHost] = useState(''), [port, setPort] = useState('80'), [connected, setConnected] = useState(''), [config, setConfig] = useState<Config | null>(null), [error, setError] = useState<DisplayError>(''), [message, setMessage] = useState<TranslationKey | ''>(''), [busy, setBusy] = useState(false);
    const request = async (path: string, method: string, body?: unknown, origin = connected) => {
        const endpoint = new URL(path, origin);
        const response = await fetch(endpoint, {
            method,
            credentials: 'omit',
            headers: {'Content-Type': 'application/json'},
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(20000)
        });
        if (!response.ok) {
            if (response.status === 404) throw new LocalizedError('errors.adminUnsupported');
            throw new LocalizedError('errors.adminHttp', {status: response.status});
        }
        return response.json();
    };
    const login = async () => {
        setBusy(true);
        setError('');
        try {
            if (!Number.isInteger(+port) || +port < 1 || +port > 65535) throw new LocalizedError('errors.invalidPort');
            const origin = new URL(syncUrl(host));
            origin.port = port;
            setConfig(await request('/admin/config', 'GET', undefined, origin.href));
            setConnected(origin.href);
            setMessage('admin.settingsOpened');
        } catch (e) {
            setError(toError(e));
        } finally {
            setBusy(false);
        }
    };
    return <div className="server-admin"><label className="check-label"><input type="checkbox" checked={enabled}
                                                                               onChange={e => {
                                                                                   toggle(e.target.checked);
                                                                                   if (!e.target.checked) {
                                                                                       setConnected('');
                                                                                       setHost('');
                                                                                       setPort('80');
                                                                                       setConfig(null);
                                                                                       setError('');
                                                                                       setMessage('');
                                                                                   }
                                                                               }}/>{t('admin.enabled')}</label>
        {enabled && <div className="admin-options"><SshInstaller/><h3>{t('admin.serverAdministratorSignIn')}</h3>
            {!connected ? <form autoComplete="off" onSubmit={e => {
                    e.preventDefault();
                    void login();
                }}><label>{t('admin.serverIP')}<input required autoComplete="off" value={host}
                                                      onChange={e => setHost(e.target.value)}/></label><label>{t('admin.serverPort')}<input
                    required type="number" min="1" max="65535" value={port}
                    onChange={e => setPort(e.target.value)}/></label>
                    <button type="submit"
                            disabled={busy || !host}>{busy ? t('admin.signingIn') : t('admin.openSettings')}</button>
                </form>
                : <>
                    <button onClick={() => {
                        setConnected('');
                        setHost('');
                        setPort('80');
                        setConfig(null);
                        setMessage('admin.signedOut');
                    }}>{t('admin.signOut')}</button>
                    {config && <form onSubmit={async e => {
                        e.preventDefault();
                        setBusy(true);
                        setError('');
                        try {
                            setConfig(await request('/admin/config', 'PATCH', config));
                            setMessage('admin.saved');
                        } catch (e) {
                            setError(toError(e));
                        } finally {
                            setBusy(false);
                        }
                    }}>
                        <label>{t('admin.maximumWorkspaceSizeMB')}<input type="number" min="1" max="150" required
                                                                         value={config.maxUploadMb}
                                                                         onChange={e => setConfig({
                                                                             ...config,
                                                                             maxUploadMb: +e.target.value
                                                                         })}/></label>
                        <label>{t('admin.serverBackupsToKeep')}<input type="number" min="1" max="50" required
                                                                      value={config.backupCount}
                                                                      onChange={e => setConfig({
                                                                          ...config,
                                                                          backupCount: +e.target.value
                                                                      })}/></label>
                        <label>{t('admin.backupRetentionMonths')}<input type="number" min="1" max="120" step="1"
                                                                        required
                                                                        aria-describedby="server-backup-warning"
                                                                        value={config.backupRetentionMonths}
                                                                        onChange={e => setConfig({
                                                                            ...config,
                                                                            backupRetentionMonths: +e.target.value
                                                                        })}/></label>
                        <p>{t('admin.backupSchedule')}</p>
                        <p id="server-backup-warning">{t('admin.backupRetentionWarning')}</p>
                        <p>{config.workspaceExists ? t('admin.workspacePresent') : t('admin.workspaceEmpty')}</p>
                        <button disabled={busy} type="submit">{t('admin.saveServerSettings')}</button>
                    </form>}</>}
            {message && <p role="status">{t(message)}</p>}{error &&
                <p role="alert" className="error">{errorText(error)}</p>}</div>}
    </div>;
}
