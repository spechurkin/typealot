import {afterEach, expect, it, vi} from 'vitest';
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
// @ts-expect-error Server-only module.
import {
    BACKUP_INTERVAL,
    createServerBackups,
    retentionCutoff,
    scheduleServerBackups,
    validRetentionMonths
} from '../scripts/server-backups.mjs';

const directories: string[] = [];
afterEach(async () => {
    vi.useRealTimers();
    for (const directory of directories.splice(0)) await rm(directory, {recursive: true, force: true});
});

async function fixture() {
    await mkdir('test-results', {recursive: true});
    const directory = await mkdtemp(path.resolve('test-results/backups-'));
    directories.push(directory);
    let time = Date.parse('2026-11-04T12:00:00Z');
    const config = {backupCount: 12, backupRetentionMonths: 3};
    const options = {directory, getConfig: () => config, now: () => time};
    const backups = createServerBackups(options);
    await backups.initialize();
    const names = async () => {
        try {
            return (await readdir(path.join(directory, 'backups'))).filter(name => name.endsWith('.json'));
        } catch {
            return [];
        }
    };
    return {
        directory, config, backups, options, names, advance: () => {
            time += BACKUP_INTERVAL;
        }
    };
}

it('uses calendar months, clamps month ends, and validates whole months', () => {
    expect(new Date(retentionCutoff(Date.parse('2024-03-31T10:12:13Z'), 1)).toISOString()).toBe('2024-02-29T10:12:13.000Z');
    expect(new Date(retentionCutoff(Date.parse('2026-01-31T10:12:13Z'), 2)).toISOString()).toBe('2025-11-30T10:12:13.000Z');
    for (const value of [0, -1, 1.5, 121, '3', null]) expect(validRetentionMonths(value)).toBe(false);
    expect(validRetentionMonths(1)).toBe(true);
    expect(validRetentionMonths(120)).toBe(true);
});

it('backs up changed saved bytes, skips unchanged data, and remembers them after restart and expiry', async () => {
    const f = await fixture();
    expect(await f.backups.snapshot()).toBe(false);
    await writeFile(path.join(f.directory, 'workspace.json'), 'first');
    expect(await f.backups.snapshot()).toBe(true);
    f.advance();
    expect(await f.backups.snapshot()).toBe(false);
    await writeFile(path.join(f.directory, 'workspace.json'), 'second');
    f.advance();
    expect(await f.backups.snapshot()).toBe(true);
    expect(await f.names()).toHaveLength(2);
    const restarted = createServerBackups({...f.options, now: () => Date.parse('2027-11-04T12:00:00Z')});
    await restarted.initialize();
    await restarted.prune();
    expect(await f.names()).toHaveLength(0);
    expect(await restarted.snapshot()).toBe(false);
    await writeFile(path.join(f.directory, 'workspace.json'), 'third');
    expect(await restarted.snapshot()).toBe(true);
    expect(await readFile(path.join(f.directory, 'backups', (await f.names())[0]), 'utf8')).toBe('third');
});

it('prunes by age without writes, keeps the exact boundary, applies count, and ignores unrelated files', async () => {
    const f = await fixture(), dir = path.join(f.directory, 'backups');
    await mkdir(dir);
    const cutoff = Date.parse('2026-08-04T12:00:00Z');
    for (const time of [cutoff - 1, cutoff, cutoff + 1]) await writeFile(path.join(dir, `${time}-legacy.json`), 'old');
    await writeFile(path.join(dir, 'manual.json'), 'keep');
    await f.backups.prune();
    expect((await f.names()).sort()).toEqual([`${cutoff}-legacy.json`, `${cutoff + 1}-legacy.json`, 'manual.json'].sort());
    f.config.backupCount = 1;
    await f.backups.prune();
    expect(await f.names()).toHaveLength(2);
    f.config.backupRetentionMonths = 1;
    await f.backups.prune();
    expect(await f.names()).toEqual(['manual.json']);
});

it('recognizes the latest legacy backup before pruning it', async () => {
    const f = await fixture(), dir = path.join(f.directory, 'backups');
    await mkdir(dir);
    await writeFile(path.join(dir, '1-old.json'), 'same');
    await writeFile(path.join(f.directory, 'workspace.json'), 'same');
    const migrated = createServerBackups(f.options);
    await migrated.initialize();
    await migrated.prune();
    expect(await migrated.snapshot()).toBe(false);
});

it('runs on the server every 30 minutes through the write queue and recovers from a failed tick', async () => {
    vi.useFakeTimers();
    const snapshot = vi.fn().mockRejectedValueOnce(Error('disk')).mockResolvedValue(false), onError = vi.fn();
    const enqueue = vi.fn(async (task: () => Promise<unknown>) => task());
    const timer = scheduleServerBackups(enqueue, {snapshot}, onError);
    await vi.advanceTimersByTimeAsync(BACKUP_INTERVAL - 1);
    expect(snapshot).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(BACKUP_INTERVAL);
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledTimes(2);
    clearInterval(timer);
});
