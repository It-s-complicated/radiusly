import type { LatLng, LngLat } from '$lib/types';
import type { RoutedEdge } from '$lib/route/contracts';

export interface IsodistanceContour {
	distanceKm: number;
	rings: LngLat[][];
}

export interface ValhallaRoute {
	distance: number;
	duration: number;
	geometry: { type: 'LineString'; coordinates: LngLat[] };
}

interface ValhallaOptions {
	baseUrl: string;
	apiToken: string;
	signal: AbortSignal;
	maximumCalls: number;
	maximumConcurrency: number;
	callTimeoutMs: number;
}

export class ValhallaClient {
	readonly maximumCalls: number;
	private readonly baseUrl: string;
	private readonly apiToken: string;
	private readonly signal: AbortSignal;
	private readonly maximumConcurrency: number;
	private readonly callTimeoutMs: number;
	private activeCalls = 0;
	private callCount = 0;
	private readonly waiters: (() => void)[] = [];

	constructor(options: ValhallaOptions) {
		this.baseUrl = options.baseUrl.replace(/\/$/, '');
		this.apiToken = options.apiToken;
		this.signal = options.signal;
		this.maximumCalls = options.maximumCalls;
		this.maximumConcurrency = options.maximumConcurrency;
		this.callTimeoutMs = options.callTimeoutMs;
	}

	get usedCalls(): number {
		return this.callCount;
	}

	async isodistance(start: LatLng, distancesKm: number[]): Promise<IsodistanceContour[]> {
		const uniqueDistances = Array.from(
			new Set(distancesKm.map((distance) => Number(distance.toFixed(3)))),
		).sort((a, b) => a - b);
		const data = await this.post('/isochrone', {
			locations: [{ lat: start[0], lon: start[1] }],
			costing: 'pedestrian',
			contours: uniqueDistances.map((distance) => ({ distance })),
			polygons: true,
			generalize: 25,
		});
		const features = asRecord(data).features;
		if (!Array.isArray(features)) throw new Error('Valhalla returned no isodistance contours');

		return features.map((value) => {
			const feature = asRecord(value);
			const properties = asRecord(feature.properties);
			const geometry = asRecord(feature.geometry);
			return {
				distanceKm: numberValue(properties.contour, 'contour distance'),
				rings: polygonRings(geometry),
			};
		});
	}

	async route(points: LatLng[]): Promise<ValhallaRoute> {
		const data = asRecord(await this.post('/route', {
			locations: points.map(([lat, lon], index) => ({
				lat,
				lon,
				type: index === 0 || index === points.length - 1 ? 'break' : 'through',
			})),
			costing: 'pedestrian',
			format: 'osrm',
			shape_format: 'geojson',
		}));
		if (!Array.isArray(data.routes) || data.routes.length === 0) {
			throw new Error('Valhalla returned no routes');
		}
		const route = asRecord(data.routes[0]);
		const geometry = asRecord(route.geometry);
		const coordinates = lngLatCoordinates(geometry.coordinates);
		if (coordinates.length < 2) throw new Error('Valhalla returned an empty route shape');

		return {
			distance: numberValue(route.distance, 'route distance'),
			duration: numberValue(route.duration, 'route duration'),
			geometry: { type: 'LineString', coordinates },
		};
	}

	async traceEdges(coordinates: LngLat[]): Promise<RoutedEdge[]> {
		const data = asRecord(await this.post('/trace_attributes', {
			shape: coordinates.map(([lon, lat]) => ({ lat, lon })),
			costing: 'pedestrian',
			shape_match: 'walk_or_snap',
			filters: {
				action: 'include',
				attributes: [
					'edge.id',
					'edge.way_id',
					'edge.length',
					'edge.begin_osm_node_id',
					'edge.end_osm_node_id',
					'edge.use',
					'edge.road_class',
					'edge.surface',
					'edge.tunnel',
					'edge.traversability',
					'edge.forward',
					'edge.travel_mode',
				],
			},
		}));
		if (!Array.isArray(data.edges)) throw new Error('Valhalla returned no traced edges');

		return data.edges.map((value, index) => {
			const edge = asRecord(value);
			const wayId = optionalString(edge.way_id);
			const edgeId = optionalString(edge.id) ?? String(index);
			const beginNodeId = optionalString(edge.begin_osm_node_id);
			const endNodeId = optionalString(edge.end_osm_node_id);
			let nodePair = edgeId;
			let direction: 1 | -1 = 1;
			if (beginNodeId && endNodeId) {
				nodePair = beginNodeId < endNodeId
					? `${beginNodeId}:${endNodeId}`
					: `${endNodeId}:${beginNodeId}`;
				direction = beginNodeId > endNodeId ? -1 : 1;
			}
			if (typeof edge.forward === 'boolean') direction = edge.forward ? 1 : -1;

			return {
				id: `${wayId ?? edgeId}:${nodePair}`,
				wayId,
				lengthMeters: numberValue(edge.length, `edge ${index} length`) * 1000,
				direction,
				use: optionalString(edge.use),
				roadClass: optionalString(edge.road_class),
				surface: optionalString(edge.surface),
				tunnel: edge.tunnel === true,
				pedestrianAllowed: edge.travel_mode === undefined || edge.travel_mode === 'pedestrian',
			};
		});
	}

	private async post(path: string, payload: unknown): Promise<unknown> {
		if (this.callCount >= this.maximumCalls) throw new Error('Valhalla request budget exhausted');
		this.callCount += 1;
		await this.acquire();
		try {
			const timeout = AbortSignal.timeout(this.callTimeoutMs);
			const response = await fetch(`${this.baseUrl}${path}`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					authorization: `Bearer ${this.apiToken}`,
				},
				body: JSON.stringify(payload),
				signal: AbortSignal.any([this.signal, timeout]),
			});
			if (!response.ok) {
				const detail = (await response.text().catch(() => '')).slice(0, 300);
				throw new Error(`Valhalla ${path} failed (${response.status})${detail ? `: ${detail}` : ''}`);
			}
			return await response.json();
		} finally {
			this.release();
		}
	}

	private async acquire(): Promise<void> {
		if (this.activeCalls < this.maximumConcurrency) {
			this.activeCalls += 1;
			return;
		}
		await new Promise<void>((resolve, reject) => {
			const waiter = () => {
				this.signal.removeEventListener('abort', abort);
				this.activeCalls += 1;
				resolve();
			};
			const abort = () => {
				const index = this.waiters.indexOf(waiter);
				if (index >= 0) this.waiters.splice(index, 1);
				reject(this.signal.reason ?? new Error('Route generation aborted'));
			};
			if (this.signal.aborted) {
				abort();
				return;
			}
			this.signal.addEventListener('abort', abort, { once: true });
			this.waiters.push(waiter);
		});
	}

	private release(): void {
		this.activeCalls -= 1;
		this.waiters.shift()?.();
	}
}

export async function valhallaStatus(
	baseUrl: string,
	apiToken: string,
	signal: AbortSignal,
): Promise<Record<string, unknown>> {
	const response = await fetch(`${baseUrl.replace(/\/$/, '')}/status`, {
		headers: { authorization: `Bearer ${apiToken}` },
		signal,
	});
	if (!response.ok) throw new Error(`Valhalla health check failed (${response.status})`);
	return asRecord(await response.json());
}

function polygonRings(geometry: Record<string, unknown>): LngLat[][] {
	if (geometry.type === 'Polygon') {
		const coordinates = geometry.coordinates;
		if (!Array.isArray(coordinates) || !coordinates[0]) return [];
		return [lngLatCoordinates(coordinates[0])];
	}
	if (geometry.type === 'MultiPolygon') {
		const polygons = geometry.coordinates;
		if (!Array.isArray(polygons)) return [];
		return polygons.flatMap((polygon) => {
			if (!Array.isArray(polygon) || !polygon[0]) return [];
			return [lngLatCoordinates(polygon[0])];
		});
	}
	return [];
}

function lngLatCoordinates(value: unknown): LngLat[] {
	if (!Array.isArray(value)) throw new Error('Valhalla returned malformed coordinates');
	return value.map((coordinate) => {
		if (!Array.isArray(coordinate) || coordinate.length < 2) throw new Error('Valhalla returned malformed coordinates');
		return [numberValue(coordinate[0], 'longitude'), numberValue(coordinate[1], 'latitude')];
	});
}


function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Valhalla returned malformed JSON');
	return value as Record<string, unknown>;
}

function numberValue(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Valhalla returned invalid ${name}`);
	return value;
}


function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}
