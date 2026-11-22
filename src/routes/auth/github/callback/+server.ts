import {
	authConfigured,
	authErrorLocation,
	clearOAuthState,
	exchangeCode,
	fetchGitHubUser,
	readOAuthState,
	redirectResponse,
	safeNext,
	writeSession
} from '#lib/server/auth.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	if (!authConfigured()) {
		return new Response('GitHub sign-in is not configured on this deployment.', {
			status: 503,
			headers: { 'content-type': 'text/plain; charset=utf-8' }
		});
	}

	const state = url.searchParams.get('state');
	const code = url.searchParams.get('code');
	const oauthError = url.searchParams.get('error');
	const stored = readOAuthState(cookies);
	const next = safeNext(stored?.next);
	clearOAuthState(cookies);

	if (oauthError) {
		return redirectResponse(authErrorLocation(next, oauthError));
	}
	if (!code || !state || !stored || stored.state !== state) {
		return redirectResponse(authErrorLocation(next, 'invalid_state'));
	}

	try {
		const token = await exchangeCode(code, `${url.origin}/auth/github/callback`);
		const user = await fetchGitHubUser(token.token);
		await writeSession(cookies, { ...user, scopes: token.scopes }, token.token);
	} catch (error) {
		console.error('GitHub sign-in failed', error);
		return redirectResponse(authErrorLocation(next, 'exchange_failed'));
	}

	return redirectResponse(next);
};
