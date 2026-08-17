import type { Algorithm, LatLng, RouteResult } from '$lib/types';

/**
 * Generate a walking loop via a single backend request. The server runs all
 * candidate rounds, station penalties, fallbacks, and calibration.
 */
export async function walkingLoop(
	start: LatLng,
	targetKm: number,
	bearing: number,
	favorites: LatLng[] = [],
	algorithm: Algorithm = 'organic',
): Promise<RouteResult> {
	const response = await fetch('/api/routing', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ start, targetKm, bearing, favorites, algorithm }),
	});
	const data = await response.json().catch(() => ({}));
	if (!response.ok) {
		const error = new Error(
			data.message || `Route generation failed (${response.status})`,
		) as Error & { code?: string };
		error.code = data.code;
		throw error;
	}
	return data as RouteResult;
}
