export type LatLng = [number, number]; // [lat, lng]
export type LngLat = [number, number]; // [lng, lat] — OSRM/GeoJSON

export type Algorithm = 'organic' | 'tangent' | 'orbit-same' | 'orbit-near' | 'spaghetti';

export type InternalAlgorithm = Algorithm | 'spaghetti-cross' | 'spaghetti-safe';

export type Mode = 'distance' | 'time';
export type Pace = 4 | 5 | 6;

export interface SavedPoint {
	id: string;
	name: string;
	lat: number;
	lng: number;
	selected?: boolean;
}

export interface RouteCandidate {
	algorithm: InternalAlgorithm;
	bearing: number;
	scale: number;
	points: LatLng[];
}

export interface RouteResult {
	distance: number;
	duration: number;
	geometry: { coordinates: LngLat[] };
	weight: number;
	candidate?: RouteCandidate;
	distanceError: number;
	distanceErrorDistance: number;
	repeatRatio: number;
	repeatedDistance: number;
	longestRepeatRatio: number;
	longestRepeatDistance: number;
	stationRepeatDistance: number;
	score: number;
	debugCandidates?: unknown[];
	debugStationData?: unknown;
}

export interface RouteDebug {
	schemaVersion: number;
	generatedAt: string;
	input: unknown;
	candidates?: unknown[];
	stationData?: unknown;
	selectedRoute?: unknown;
	error?: string;
	fallbackCoordinates?: LatLng[];
}
