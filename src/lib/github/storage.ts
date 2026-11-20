import type { RepoData } from './types';

const PAT_KEY = 'unblock:pat';
const CACHE_PREFIX = 'unblock:repo:v1';
const TTL_MS = 5 * 60 * 1000;

function available(): boolean {
	return typeof localStorage !== 'undefined';
}

/** --- optional GitHub PAT, stored strictly in this browser --- */

export function loadPat(): string | null {
	if (!available()) return null;
	return localStorage.getItem(PAT_KEY) || null;
}

export function savePat(pat: string): void {
	if (!available()) return;
	const trimmed = pat.trim();
	if (trimmed) localStorage.setItem(PAT_KEY, trimmed);
	else localStorage.removeItem(PAT_KEY);
}

export function clearPat(): void {
	if (!available()) return;
	localStorage.removeItem(PAT_KEY);
}

/** Mask a token for display: keep enough to recognize, never the full value. */
export function maskPat(pat: string): string {
	if (pat.length <= 8) return `${pat.slice(0, 2)}••••`;
	return `${pat.slice(0, 4)}••••••${pat.slice(-4)}`;
}

/** --- raw repo data cache (5-minute TTL, bypassed by `refresh`) --- */

export function repoCacheKey(owner: string, repo: string, scope: string, hasPat: boolean): string {
	return `${owner.toLowerCase()}/${repo.toLowerCase()}|${scope}|${hasPat ? 'pat' : 'anon'}`;
}

export function readRepoCache(key: string): RepoData | null {
	if (!available()) return null;
	const storageKey = `${CACHE_PREFIX}:${key}`;
	const raw = localStorage.getItem(storageKey);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as { storedAt: number; data: RepoData };
		if (Date.now() - parsed.storedAt > TTL_MS) {
			localStorage.removeItem(storageKey);
			return null;
		}
		parsed.data.meta.fromCache = true;
		return parsed.data;
	} catch {
		localStorage.removeItem(storageKey);
		return null;
	}
}

/** Returns false when the payload is too large or storage is unavailable. */
export function writeRepoCache(key: string, data: RepoData): boolean {
	if (!available()) return false;
	try {
		localStorage.setItem(`${CACHE_PREFIX}:${key}`, JSON.stringify({ storedAt: Date.now(), data }));
		return true;
	} catch {
		try {
			localStorage.removeItem(`${CACHE_PREFIX}:${key}`);
		} catch {
			/* ignore */
		}
		return false;
	}
}
