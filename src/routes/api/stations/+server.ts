import type { RequestHandler } from './$types';

const OVERPASS = 'https://overpass-api.de/api/interpreter';

export const GET: RequestHandler = async ({ url }) => {
	const bbox = url.searchParams.get('bbox');

	if (!bbox || !/^-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*$/.test(bbox)) {
		return new Response('Invalid bbox. Expected: lat,lat,lng,lng', { status: 400 });
	}

	const query = `[out:json][timeout:10];node["railway"="station"](${bbox});out;`;

	try {
		const response = await fetch(`${OVERPASS}?data=${encodeURIComponent(query)}`, {
			signal: AbortSignal.timeout(12000),
			headers: {
				'User-Agent': 'Radiusly/0.1 (neighborhood-walk-planner)',
			},
		});

		if (!response.ok) {
			return new Response('Station lookup temporarily unavailable', {
				status: 502,
			});
		}

		const { elements } = await response.json();
		const stations = elements
			.map(
				(el: {
					center?: { lon: number; lat: number };
					lat?: number;
					lon?: number;
					tags?: { name?: string };
				}) => ({
					name: el.tags?.name,
					coordinates: el.center
						? ([el.center.lon, el.center.lat] as [number, number])
						: ([el.lon, el.lat] as [number, number]),
				}),
			)
			.filter(
				(s: { coordinates: [number, number] }) =>
					Number.isFinite(s.coordinates[0]) && Number.isFinite(s.coordinates[1]),
			);

		return new Response(JSON.stringify({ available: true, stations }), {
			headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
		});
	} catch {
		return new Response('Station lookup upstream request failed', {
			status: 502,
		});
	}
};
