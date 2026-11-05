export type UpdateState = { status: 'idle' | 'available' | 'downloading' | 'ready' | 'error'; version?: string };
export type SshInstallInput = { host: string; port: number; username: string; password: string };
export type SshInstallResult = { ok: true; host: string; port: number } | { ok: false; error: string; detail?: string };
declare global {
    interface Window {
        typealotDesktop?: {
            loadSyncCache: () => Promise<string | null>;
            saveSyncCache: (text: string) => Promise<void>;
            updateState: () => Promise<UpdateState | null>;
            downloadUpdate: () => Promise<boolean>;
            installUpdate: () => Promise<boolean>;
            onUpdate: (handler: (state: UpdateState) => void) => () => void;
            onBeforeClose: (handler: () => Promise<void>) => () => void;
            installServer: (input: SshInstallInput) => Promise<SshInstallResult>;
        };
    }
}
