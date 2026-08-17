import { distance } from '$lib/route/edge-scoring';
import { pointAt } from '$lib/route/shapes';
import type { RoutedEdge } from '$lib/route/contracts';
import type { LatLng, LngLat } from '$lib/types';
import type { IsodistanceContour, ProviderRoute } from './route-generation';

/** Vertices per isodistance ring (73 with the closing point), inside the 64–128 range the anchor sampler tolerates. */
const RING_POINTS = 72;

/**
 * A dependency-free route provider that draws synthetic circular contours and
 * straight great-circle segments instead of consulting a road network. It
 * satisfies the RouteProvider surface generateRoute() consumes with no network
 * or Node-only APIs, so it runs unchanged in any serverless runtime.
 */
export class GeometricRouter {
	readonly maximumCalls: number;
	private callCount = 0;

	constructor(maximumCalls = 12) {
		this.maximumCalls = maximumCalls;
	}

	get usedCalls(): number {
		return this.callCount;
	}

	async isodistance(start: LatLng, distancesKm: number[]): Promise<IsodistanceContour[]> {
		const uniqueDistances = Array.from(
			new Set(distancesKm.map((distanceKm) => Number(distanceKm.toFixed(3)))),
		).sort((a, b) => a - b);
		return uniqueDistances.map((distanceKm) => {
			this.callCount += 1;
			const ring: LngLat[] = Array.from({ length: RING_POINTS }, (_, index) => {
				const point = pointAt(start, distanceKm, index / RING_POINTS * 360);
				return [point[1], point[0]];
			});
			ring.push(ring[0]!);
			return { distanceKm, rings: [ring] };
		});
	}

	async route(points: LatLng[]): Promise<ProviderRoute> {
		if (points.length < 2) {
			throw new Error('GeometricRouter needs at least two coordinates for a route');
		}
		this.callCount += 1;
		const coordinates: LngLat[] = points.map(([lat, lng]) => [lng, lat]);
		let totalMeters = 0;
		for (let index = 0; index < coordinates.length - 1; index += 1) {
			totalMeters += distance(coordinates[index]!, coordinates[index + 1]!);
		}
		return {
			distance: totalMeters,
			duration: Math.round(totalMeters / 1.4),
			geometry: { type: 'LineString', coordinates },
		};
	}

	async traceEdges(_coordinates: LngLat[]): Promise<RoutedEdge[]> {
		this.callCount += 1;
		// ponytail: no road-network data exists here, so edge-derived score components
		// (repetition, unsuitable access, soft exposures) stay at zero. Wiring a real
		// road-network trace source restores full edge scoring.
		return [];
	}
}