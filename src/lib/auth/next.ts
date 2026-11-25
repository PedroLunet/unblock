/**
 * Strip stale auth-result params so a successful retry doesn't keep an old
 * error banner; keeps the path, other query params and the hash.
 */
export function cleanNext(value: string): string {
	const url = new URL(value, 'https://unblock.invalid');
	url.searchParams.delete('auth');
	url.searchParams.delete('reason');
	return url.pathname + url.search + url.hash;
}
