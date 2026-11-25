import {
	authConfigured,
	oauthAuthorizeUrl,
	readSession,
	redirectResponse,
	writeOAuthState
} from '#lib/server/auth.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	if (!authConfigured()) {
		return new Response('GitHub sign-in is not configured on this deployment.', {
			status: 503,
			headers: { 'content-type': 'text/plain; charset=utf-8' }
		});
	}

	const current = await readSession(cookies);
	const granted = new Set(current?.scopes ?? []);
	const next = url.searchParams.get('next') ?? '/';
	// Re-authorizing to add one scope must not silently drop the others.
	const privateRepos = url.searchParams.get('private') === '1' || granted.has('repo');
	const write = url.searchParams.get('write') === '1' || granted.has('public_repo') || privateRepos;
	const projects =
		url.searchParams.get('projects') === '1' ||
		granted.has('read:project') ||
		granted.has('project');
	const state = crypto.randomUUID();

	writeOAuthState(cookies, { state, next, privateRepos, write, projects });
	return redirectResponse(oauthAuthorizeUrl(url.origin, state, { privateRepos, write, projects }));
};
