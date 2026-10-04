import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { auth } from '#lib/server/auth.js';
import { trustedAuthHeaders } from '#lib/server/trusted-auth-headers.js';

export const handle: Handle = async ({ event, resolve }) => {
	const headers = trustedAuthHeaders(event.request.headers, event.getClientAddress());

	if (event.url.pathname.startsWith('/api/auth')) {
		return auth.handler(new Request(event.request, { headers }));
	}

	const current = await auth.api.getSession({ headers });
	event.locals.session = current?.session ?? null;
	event.locals.user = current?.user ?? null;

	if (!current) {
		if (event.url.pathname.startsWith('/api/'))
			return new Response('Unauthorized', { status: 401 });
		if (event.url.pathname !== '/login') redirect(303, '/login');
	} else if (event.url.pathname === '/login') {
		redirect(303, '/');
	}

	return resolve(event);
};
