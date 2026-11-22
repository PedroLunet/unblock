import { clearSession, readSession } from '#lib/server/auth.ts';
import type { RequestHandler } from './$types';

const GITHUB_GRAPHQL = 'https://api.github.com/graphql';

/**
 * Same-origin GraphQL proxy: the GitHub token stays in the encrypted session
 * cookie and is never exposed to browser JavaScript.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const session = await readSession(cookies);
	if (!session) {
		return Response.json(
			{ error: 'Not signed in' },
			{ status: 401, headers: { 'cache-control': 'no-store' } }
		);
	}

	const contentType = request.headers.get('content-type') ?? '';
	if (!contentType.includes('application/json')) {
		return new Response('Expected application/json', { status: 415 });
	}

	const body = await request.text();
	let upstream: Response;
	try {
		upstream = await fetch(GITHUB_GRAPHQL, {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${session.token}`,
				'Content-Type': 'application/json',
				'User-Agent': 'unblock'
			},
			body
		});
	} catch {
		return Response.json(
			{ error: 'Could not reach GitHub' },
			{ status: 502, headers: { 'cache-control': 'no-store' } }
		);
	}

	if (upstream.status === 401) {
		clearSession(cookies);
		return Response.json(
			{ error: 'GitHub session expired' },
			{ status: 401, headers: { 'cache-control': 'no-store' } }
		);
	}

	const text = await upstream.text();
	return new Response(text, {
		status: upstream.status,
		headers: {
			'content-type': 'application/json',
			'cache-control': 'no-store'
		}
	});
};
