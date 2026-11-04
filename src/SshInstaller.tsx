import {useEffect, useRef, useState} from 'react';
import {t, type TranslationKey} from './i18n';
import {Modal} from './ui';

const errors: Record<string, TranslationKey> = {
    buildMissing: 'ssh.buildMissing',
    invalidInput: 'ssh.invalidInput',
    authenticationFailed: 'ssh.authenticationFailed',
    connectionFailed: 'ssh.connectionFailed',
    cancelled: 'ssh.cancelled',
    timeout: 'ssh.timeout',
    installFailed: 'ssh.installFailed',
    unavailable: 'ssh.unavailable'
};

export default function SshInstaller() {
    const [host, setHost] = useState(''), [port, setPort] = useState('22'), [username, setUsername] = useState(''), [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false), [error, setError] = useState<TranslationKey | ''>(''), [detail, setDetail] = useState(''), [installed, setInstalled] = useState('');
    const [available, setAvailable] = useState(!!window.typealotDesktop?.installServer);
    const [fingerprint, setFingerprint] = useState('');
    const confirm = useRef<((accepted: boolean) => void) | null>(null);
    useEffect(() => {
        if (window.typealotDesktop?.installServer) return;
        const controller = new AbortController();
        let retry: ReturnType<typeof setTimeout> | undefined, checking = false;
        const check = async () => {
            if (checking || controller.signal.aborted) return;
            checking = true;
            clearTimeout(retry);
            let ready = false;
            try {
                const response = await fetch('/__typealot/ssh', {
                    cache: 'no-store',
                    credentials: 'omit',
                    signal: controller.signal
                });
                ready = response.ok && (await response.json()).available === true;
            } catch {
            } finally {
                checking = false;
                if (!controller.signal.aborted) {
                    setAvailable(ready);
                    if (!ready) retry = setTimeout(() => void check(), 3000);
                }
            }
        };
        const focus = () => void check();
        void check();
        window.addEventListener('focus', focus);
        return () => {
            controller.abort();
            clearTimeout(retry);
            window.removeEventListener('focus', focus);
            confirm.current?.(false);
        };
    }, []);
    const trust = (accepted: boolean) => {
        confirm.current?.(accepted);
        confirm.current = null;
        setFingerprint('');
    };
    const install = async () => {
        if (!available || busy) return;
        setBusy(true);
        setError('');
        setDetail('');
        setInstalled('');
        const input = {host: host.trim(), port: Number(port), username: username.trim(), password};
        setPassword('');
        try {
            let result;
            if (window.typealotDesktop?.installServer) result = await window.typealotDesktop.installServer(input);
            else {
                const request = async (path: string, body: unknown) => {
                    const response = await fetch(`/__typealot/ssh/${path}`, {
                        method: 'POST',
                        credentials: 'omit',
                        cache: 'no-store',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(body)
                    });
                    if (!response.ok) throw Error('unavailable');
                    return response.json();
                };
                const probe = await request('probe', {host: input.host, port: input.port});
                if (!probe.ok) result = probe;
                else {
                    setFingerprint(probe.fingerprint);
                    const accepted = await new Promise<boolean>(resolve => {
                        confirm.current = resolve;
                    });
                    result = accepted ? await request('install', {
                        ...input,
                        fingerprint: probe.fingerprint
                    }) : {ok: false, error: 'cancelled'};
                }
            }
            if (result.ok) {
                setInstalled(`http://${result.host.includes(':') ? '[' + result.host + ']' : result.host}${result.port === 80 ? '' : ':' + result.port}/`);
                setHost('');
                setUsername('');
                setPort('22');
            } else {
                setError(errors[result.error] || 'ssh.installFailed');
                setDetail(result.detail || '');
            }
        } catch {
            setError('ssh.connectionFailed');
        } finally {
            input.password = '';
            setBusy(false);
        }
    };
    return <section className="ssh-installer">
        <h3>{t('ssh.title')}</h3>
        <p>{t('ssh.description')}</p>
        <form autoComplete="off" onSubmit={event => {
            event.preventDefault();
            void install();
        }}>
            <fieldset disabled={busy}>
                <label>{t('ssh.host')}<input required autoComplete="off" value={host}
                                             onChange={e => setHost(e.target.value)}/></label>
                <label>{t('ssh.port')}<input required type="number" min="1" max="65535" value={port}
                                             onChange={e => setPort(e.target.value)}/></label>
                <label>{t('ssh.username')}<input required autoComplete="off" value={username}
                                                 onChange={e => setUsername(e.target.value)}/></label>
                <label>{t('ssh.password')}<input required type="password" autoComplete="off" value={password}
                                                 onChange={e => setPassword(e.target.value)}/></label>
                <button type="submit"
                        disabled={!available || !host.trim() || !username.trim() || !password}>{busy ? t('ssh.installing') : t('ssh.install')}</button>
                {!available && <p role="status">{t('ssh.browserUnavailable')}</p>}
            </fieldset>
        </form>
        {busy && <p role="status">{t('ssh.installing')}</p>}
        {installed && <><p role="status">{t('ssh.installed', {address: installed})}</p><a href={installed}
                                                                                          target="_blank"
                                                                                          rel="noreferrer">{t('ssh.openApp')}</a></>}
        {error && <p role="alert" className="error">{t(error)}</p>}
        {detail && <pre className="ssh-output">{detail}</pre>}
        {fingerprint && <Modal title={t('ssh.verifyHost')} close={() => trust(false)}><p
            className="ssh-output">{t('ssh.hostFingerprint', {host, port, fingerprint})}</p>
            <div className="button-row">
                <button onClick={() => trust(false)}>{t('ssh.cancel')}</button>
                <button onClick={() => trust(true)}>{t('ssh.trustAndInstall')}</button>
            </div>
        </Modal>}
    </section>;
}
