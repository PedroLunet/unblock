import { clearSession } from '#lib/server/auth.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request, url, cookies }) => {
	const origin = request.headers.get('origin');
	if (origin !== null && origin !== url.origin) {
		return new Response('Forbidden', { status: 403 });
	}

	clearSession(cookies);
	return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
};
