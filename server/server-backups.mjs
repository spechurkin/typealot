import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readdir, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';

export const BACKUP_INTERVAL = 30 * 60 * 1000;
export const DEFAULT_RETENTION_MONTHS = 3;
export const validRetentionMonths = value => Number.isInteger(value) && value >= 1 && value <= 120;

export function scheduleServerBackups(enqueue, backups, onError) {
    const timer = setInterval(() => {
        void enqueue(() => backups.snapshot()).catch(onError);
    }, BACKUP_INTERVAL);
    timer.unref();
    return timer;
}

export function retentionCutoff(now, months) {
    const date = new Date(now), day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - months);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
    return date.getTime();
}

export function createServerBackups({directory, getConfig, now = Date.now}) {
    const backupDir = path.join(directory, 'backups'), stateFile = path.join(directory, 'backup-state.json');
    const copies = async () => {
        try {
            return (await readdir(backupDir)).filter(name => /^\d+-[\w-]+\.json$/.test(name)).sort((a, b) => Number(b.split('-')[0]) - Number(a.split('-')[0]) || b.localeCompare(a));
        } catch (error) {
            if (error.code === 'ENOENT') return [];
            throw error;
        }
    };
    const digest = body => createHash('sha256').update(body).digest('hex');
    let lastHash;
    const initialize = async () => {
        try {
            lastHash = JSON.parse(await readFile(stateFile, 'utf8')).hash;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        if (!lastHash) {
            const latest = (await copies())[0];
            if (latest) {
                lastHash = digest(await readFile(path.join(backupDir, latest)));
                await saveState();
            }
        }
    };
    const saveState = async () => {
        await writeFile(stateFile + '.tmp', JSON.stringify({hash: lastHash}));
        await rename(stateFile + '.tmp', stateFile);
    };
    const prune = async () => {
        const config = getConfig(), cutoff = retentionCutoff(now(), config.backupRetentionMonths);
        const names = await copies();
        for (const [index, name] of names.entries()) {
            if (index >= config.backupCount || Number(name.split('-')[0]) < cutoff) await unlink(path.join(backupDir, name));
        }
    };
    const snapshot = async () => {
        let body;
        try {
            body = await readFile(path.join(directory, 'workspace.json'));
        } catch (error) {
            if (error.code === 'ENOENT') {
                await prune();
                return false;
            }
            throw error;
        }
        const hash = digest(body);
        if (hash === lastHash) {
            await prune();
            return false;
        }
        await mkdir(backupDir, {recursive: true});
        const name = path.join(backupDir, `${now()}-${randomUUID()}.json`);
        await writeFile(name + '.tmp', body);
        await rename(name + '.tmp', name);
        lastHash = hash;
        await saveState();
        await prune();
        return true;
    };
    return {initialize, prune, snapshot};
}
