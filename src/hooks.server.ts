import { redirect, text, type Handle } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { trustedAuthHeaders } from '$lib/server/trusted-auth-headers';

export const handle: Handle = async ({ event, resolve }) => {
	const headers = trustedAuthHeaders(event.request.headers, event.getClientAddress());

	if (event.url.pathname.startsWith('/api/auth')) {
		return auth.handler(new Request(event.request, { headers }));
	}

	const current = await auth.api.getSession({ headers });
	event.locals.session = current?.session ?? null;
	event.locals.user = current?.user ?? null;

	if (!current) {
		if (event.url.pathname.startsWith('/api/')) return text('Unauthorized', { status: 401 });
		if (event.url.pathname !== '/login') redirect(303, '/login');
	} else if (event.url.pathname === '/login') {
		redirect(303, '/');
	}

	return resolve(event);
};
