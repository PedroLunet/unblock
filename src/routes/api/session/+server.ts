import { authConfigured, publicUser, readSession } from '#lib/server/auth.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	const session = await readSession(cookies);
	return Response.json(
		{
			configured: authConfigured(),
			user: session ? publicUser(session) : null
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
};
