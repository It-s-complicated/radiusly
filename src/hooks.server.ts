import { redirect, text } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	if (event.url.pathname.startsWith('/api/auth')) {
		return auth.handler(event.request);
	}

	if (event.url.pathname === '/api/health') {
		return resolve(event);
	}

	const current = await auth.api.getSession({ headers: event.request.headers });
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
