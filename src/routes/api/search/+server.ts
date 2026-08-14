import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const query = url.searchParams.get('q');

	if (!query || query.length > 100) {
		return new Response('Invalid query', { status: 400 });
	}

	try {
		const response = await fetch(
			`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`,
			{
				signal: AbortSignal.timeout(10000),
				headers: {
					'User-Agent': 'Radiusly/0.1 (neighborhood-walk-planner)',
					Referer: 'https://radiusly.app',
				},
			},
		);

		if (!response.ok) {
			return new Response('Place search temporarily unavailable', {
				status: 502,
			});
		}

		const data = await response.json();
		return new Response(JSON.stringify(data), {
			headers: {
				'content-type': 'application/json',
				'cache-control': 'no-store',
			},
		});
	} catch {
		return new Response('Place search upstream request failed', { status: 502 });
	}
};
