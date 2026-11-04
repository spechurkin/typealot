import {get, set, update} from 'idb-keyval';
import {randomId} from './crypto';
import {initialWorkspace, validateWorkspace, type Workspace} from './model';
import {Capacitor} from '@capacitor/core';
import {t} from './i18n';

export async function loadWorkspace(): Promise<Workspace> {
    const value = await get('typealot.workspace');
    return value ? validateWorkspace(value) : initialWorkspace();
}

export async function saveWorkspace(w: Workspace) {
    await set('typealot.workspace', w);
    const now = Date.now();
    await update<LocalBackup[]>('typealot.backups', items => {
        const backups = items || [];
        if (backups.length && now - backups[0].createdAt < 5 * 60 * 1000) return backups;
        return [{id: randomId(), createdAt: now, workspace: w}, ...backups].slice(0, 12);
    });
}

export type LocalBackup = { id: string; createdAt: number; workspace: Workspace };

export async function listBackups(): Promise<LocalBackup[]> {
    return (await get('typealot.backups')) || [];
}

export async function checkpoint(w: Workspace): Promise<void> {
    await update<LocalBackup[]>('typealot.backups', items => [{
        id: randomId(),
        createdAt: Date.now(),
        workspace: w
    }, ...(items || [])].slice(0, 12));
}

export function download(name: string, data: string, type = 'application/json') {
    if (Capacitor.isNativePlatform()) {
        void nativeExport(name, data, false).catch(error => window.dispatchEvent(new CustomEvent('typealot:error', {detail: String(error)})));
        return;
    }
    const url = URL.createObjectURL(new Blob([data], {type}));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function nativeExport(name: string, data: string, binary: boolean) {
    const [{
        Filesystem,
        Directory,
        Encoding
    }, {Share}] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    const safeName = name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 180) || 'Typealot-export';
    const file = await Filesystem.writeFile({
        path: `exports/${safeName}`,
        directory: Directory.Cache,
        data: binary ? data.split(',')[1] : data, ...(!binary ? {encoding: Encoding.UTF8} : {}),
        recursive: true
    });
    try {
        await Share.share({title: safeName, url: file.uri, dialogTitle: t('storage.shareFile')});
    } catch (error) {
        if (error instanceof Error && error.message === 'Share canceled') return;
        throw error;
    }
}

export function downloadAttachment(name: string, data: string) {
    if (Capacitor.isNativePlatform()) {
        void nativeExport(name, data, true).catch(error => window.dispatchEvent(new CustomEvent('typealot:error', {detail: String(error)})));
        return;
    }
    const a = document.createElement('a');
    a.href = data;
    a.download = name;
    a.click();
}

export function fileData(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(file);
    });
}
