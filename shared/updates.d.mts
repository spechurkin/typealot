export const UPDATE_INTERVAL: number;
export const RELEASES_API: string;

export function latestNumberedRelease(channel: string, request?: typeof fetch): Promise<null | {
    version: string;
    tag_name: string;
    assets: { name: string; browser_download_url: string }[]
}>;

export function resolveManifestUrl(source: string, channel: string, filename: string, request?: typeof fetch): Promise<string>;

export function newerVersion(candidate: unknown, current: unknown): boolean;

export function releaseUrl(value: string): string;

export function startUpdateChecks(check: () => Promise<void>, options?: {
    interval?: number;
    onError?: (error: unknown) => void
}): () => void;
