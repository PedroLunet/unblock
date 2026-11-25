import { clearRepoCache } from '#lib/github/storage.ts';

export interface SessionUser {
	login: string;
	name: string | null;
	avatarUrl: string;
	scopes: string[];
}

export interface SessionInfo {
	configured: boolean;
	user: SessionUser | null;
}

class SessionStore {
	configured = $state(false);
	user = $state<SessionUser | null>(null);
	loading = $state(true);
	#pending: Promise<SessionInfo> | null = null;

	/** Fetch the session once; later calls reuse the result (or a forced refresh). */
	ensure(force = false): Promise<SessionInfo> {
		if (force || this.#pending === null) this.#pending = this.#load();
		return this.#pending;
	}

	async #load(): Promise<SessionInfo> {
		this.loading = true;
		try {
			const response = await fetch('/api/session', {
				headers: { Accept: 'application/json' },
				credentials: 'same-origin'
			});
			if (!response.ok) throw new Error(`Session request failed (${response.status})`);
			const info = await response.json<SessionInfo>();
			this.configured = info.configured === true;
			this.user = info.user ?? null;
			return { configured: this.configured, user: this.user };
		} catch {
			this.configured = false;
			this.user = null;
			// Allow a later ensure() to retry after a transient failure.
			this.#pending = null;
			return { configured: false, user: null };
		} finally {
			this.loading = false;
		}
	}

	async refresh(): Promise<SessionInfo> {
		return this.ensure(true);
	}

	async signOut(): Promise<void> {
		try {
			await fetch('/auth/logout', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { Accept: 'application/json' }
			});
		} finally {
			this.user = null;
			clearRepoCache();
			this.#pending = Promise.resolve({ configured: this.configured, user: null });
		}
	}
}

export const session = new SessionStore();

/**
 * GitHub OAuth Apps grant write access through `public_repo` (public repos) or
 * `repo` (all repos the user can reach). Without either, the app is read-only.
 */
export function canWriteIssues(scopes: readonly string[]): boolean {
	return scopes.includes('repo') || scopes.includes('public_repo');
}
