export const UPDATE_INTERVAL: number;

export function newerVersion(candidate: unknown, current: unknown): boolean;

export function releaseUrl(value: string): string;

export function startUpdateChecks(check: () => Promise<void>, options?: {
    interval?: number;
    onError?: (error: unknown) => void
}): () => void;
