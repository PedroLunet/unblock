export type GithubErrorKind =
	'not-found' | 'auth' | 'rate-limit' | 'network' | 'unavailable' | 'unknown';

export class GithubError extends Error {
	readonly kind: GithubErrorKind;
	readonly status: number | null;

	constructor(kind: GithubErrorKind, message: string, status: number | null = null) {
		super(message);
		this.name = 'GithubError';
		this.kind = kind;
		this.status = status;
	}
}
