import {
	authConfigured,
	oauthAuthorizeUrl,
	redirectResponse,
	writeOAuthState
} from '#lib/server/auth.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url, cookies }) => {
	if (!authConfigured()) {
		return new Response('GitHub sign-in is not configured on this deployment.', {
			status: 503,
			headers: { 'content-type': 'text/plain; charset=utf-8' }
		});
	}

	const next = url.searchParams.get('next') ?? '/';
	const privateRepos = url.searchParams.get('private') === '1';
	const write = url.searchParams.get('write') === '1';
	const state = crypto.randomUUID();

	writeOAuthState(cookies, { state, next, privateRepos, write });
	return redirectResponse(oauthAuthorizeUrl(url.origin, state, { privateRepos, write }));
};
