import type { LngLat } from '../types.js';

/**
 * Haversine distance in meters between two [lng, lat] coordinates.
 */
export function distance([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
	const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
	const latitude = toRadians(lat2 - lat1);
	const longitude = toRadians(lng2 - lng1);
	const a =
		Math.sin(latitude / 2) ** 2 +
		Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(longitude / 2) ** 2;
	return 12742000 * Math.asin(Math.sqrt(a));
}
