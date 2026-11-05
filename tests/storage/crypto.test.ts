import {afterEach, expect, it, vi} from 'vitest';
import {randomId, sha256Hex} from '../../src/storage/crypto';

afterEach(() => vi.unstubAllGlobals());
it('supports HTTP origins without randomUUID or subtle while retaining SHA-256 identity', async () => {
    const native = await sha256Hex('abc');
    vi.stubGlobal('crypto', {getRandomValues: crypto.getRandomValues.bind(crypto)});
    expect(await sha256Hex('abc')).toBe(native);
    expect(native).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(randomId()).toMatch(/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/);
    expect(randomId()).not.toBe(randomId());
});
