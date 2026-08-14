import type { RequestHandler } from './$types';

const OSRM_BASE = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving';

export const GET: RequestHandler = async ({ url }) => {
	const coordinates = url.searchParams.get('coordinates');

	if (!coordinates || !/^-?\d+\.?\d*,-?\d+\.?\d*(;-?\d+\.?\d*,-?\d+\.?\d*)+$/.test(coordinates)) {
		return new Response('Invalid coordinates. Expected: lng,lat;lng,lat;...', {
			status: 400,
		});
	}

	const coords = coordinates.split(';');
	if (coords.length < 2) {
		return new Response('At least two coordinate pairs required', { status: 400 });
	}

	try {
		const response = await fetch(
			`${OSRM_BASE}/${coordinates}?overview=full&geometries=geojson&steps=false`,
			{
				signal: AbortSignal.timeout(15000),
				headers: {
					'User-Agent': 'Radiusly/0.1 (neighborhood-walk-planner)',
				},
			},
		);

		if (!response.ok) {
			const text = await response.text().catch(() => '');
			return new Response(text || `OSRM error (${response.status})`, {
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
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Routing upstream request failed';
		return new Response(message, { status: 502 });
	}
};
