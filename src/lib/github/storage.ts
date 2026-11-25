import { SNAPSHOT_VERSION } from './snapshot';
import type { RepoSnapshot } from './snapshot';
import type { AuthMode, RepoData } from './types';

const LEGACY_PAT_KEY = 'unblock:pat';
const CACHE_PREFIX = 'unblock:repo:v5';
const SNAPSHOT_PREFIX = 'unblock:snapshot:v2';
/**
 * Reuse a cached payload for page loads and scope switches within this window.
 * The manual Refresh action always bypasses it, and the rail shows the last
 * fetch time so a long window never hides staleness.
 */
const TTL_MS = 60 * 60 * 1000;

function available(): boolean {
	return typeof localStorage !== 'undefined';
}

/** Remove the PAT that older versions kept in localStorage. */
export function clearLegacyPat(): void {
	if (!available()) return;
	localStorage.removeItem(LEGACY_PAT_KEY);
}

/** --- raw repo data cache (1-hour TTL, bypassed by `refresh`) --- */

export function repoCacheKey(
	owner: string,
	repo: string,
	scope: string,
	auth: AuthMode,
	includeProjectIterations = false
): string {
	const key = `${owner.toLowerCase()}/${repo.toLowerCase()}|${scope}|${auth}`;
	// Iteration data only exists when the Projects scope was available, so the
	// two payloads must not share a cache entry.
	return includeProjectIterations ? `${key}|projects` : key;
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

/** --- compact refresh snapshot (persistent, no bodies) --- */

export function readSnapshot(key: string): RepoSnapshot | null {
	if (!available()) return null;
	const storageKey = `${SNAPSHOT_PREFIX}:${key}`;
	const raw = localStorage.getItem(storageKey);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as RepoSnapshot;
		if (
			parsed.version !== SNAPSHOT_VERSION ||
			typeof parsed.fetchedAt !== 'string' ||
			(parsed.source !== 'rest' && parsed.source !== 'graphql') ||
			(parsed.scope !== 'open' && parsed.scope !== 'all') ||
			!Array.isArray(parsed.issues) ||
			!Array.isArray(parsed.edges) ||
			!Array.isArray(parsed.prs)
		) {
			localStorage.removeItem(storageKey);
			return null;
		}
		return parsed;
	} catch {
		localStorage.removeItem(storageKey);
		return null;
	}
}

/** Returns false when the payload is too large or storage is unavailable. */
export function writeSnapshot(key: string, snapshot: RepoSnapshot): boolean {
	if (!available()) return false;
	const storageKey = `${SNAPSHOT_PREFIX}:${key}`;
	try {
		localStorage.setItem(storageKey, JSON.stringify(snapshot));
		return true;
	} catch {
		try {
			// Leave no stale baseline behind: the next refresh will fall back to
			// the in-memory board data instead of diffing against older data.
			localStorage.removeItem(storageKey);
		} catch {
			/* ignore */
		}
		return false;
	}
}

/** Drop every cached repository and refresh snapshot (used on sign-out so private data isn't left behind). */
export function clearRepoCache(): void {
	if (!available()) return;
	const keys: string[] = [];
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (key && (key.startsWith('unblock:repo:') || key.startsWith('unblock:snapshot:'))) {
			keys.push(key);
		}
	}
	for (const key of keys) localStorage.removeItem(key);
}

/**
 * After an edit, other scope variants of the same repo are stale. Drop them
 * (keeping the current key, which the caller just rewrote) so switching scope
 * refetches instead of showing pre-edit data.
 */
export function clearOtherRepoEntries(
	owner: string,
	repo: string,
	auth: AuthMode,
	keepKey: string
): void {
	if (!available()) return;
	const repoKey = `${owner.toLowerCase()}/${repo.toLowerCase()}|`;
	const keepCacheKey = `${CACHE_PREFIX}:${keepKey}`;
	const keepSnapshotKey = `${SNAPSHOT_PREFIX}:${keepKey}`;
	const keys: string[] = [];
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (!key) continue;
		const isRepoEntry = key.startsWith(`${CACHE_PREFIX}:${repoKey}`);
		const isSnapshot = key.startsWith(`${SNAPSHOT_PREFIX}:${repoKey}`);
		if (!isRepoEntry && !isSnapshot) continue;
		const matchesAuth = key.endsWith(`|${auth}`) || key.includes(`|${auth}|`);
		if (!matchesAuth) continue;
		if (key === keepCacheKey || key === keepSnapshotKey) continue;
		keys.push(key);
	}
	for (const key of keys) localStorage.removeItem(key);
}
