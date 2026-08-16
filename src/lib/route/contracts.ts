import type { LatLng, LngLat, Mode, Pace } from '$lib/types';

export interface RoutePreferences {
	backtracking: 'avoid' | 'allow-short';
}

export interface RequiredSpot {
	name?: string;
	coordinates: LatLng;
}

export interface RouteGenerationRequest {
	start: LatLng;
	target: {
		mode: Mode;
		value: number;
	};
	paceKmH: Pace;
	requiredSpots: RequiredSpot[];
	preferences: RoutePreferences;
	seed: string;
}

export interface RoutedEdge {
	id: string;
	wayId?: string;
	lengthMeters: number;
	direction: 1 | -1;
	use?: string;
	roadClass?: string;
	surface?: string;
	tunnel: boolean;
	pedestrianAllowed: boolean;
}

export interface RouteScoreComponents {
	distanceErrorRatio: number;
	distanceErrorMeters: number;
	repeatedDistanceMeters: number;
	repeatRatio: number;
	longestRepeatedRunMeters: number;
	immediateReversalMeters: number;
	unsuitableAccessMeters: number;
	requiredSpotsMissed: number;
	softExposures: {
		majorRoadMeters: number;
		stepsMeters: number;
		tunnelMeters: number;
		roughSurfaceMeters: number;
	};
	total: number;
}

export interface RouteCandidateMetadata {
	id: string;
	anchorCount: 2 | 3;
	contourDistanceKm: number;
	traversal: 'clockwise' | 'counterclockwise';
	adjustment: number;
	anchors: LatLng[];
}

export interface RouteResult {
	distance: number;
	duration: number;
	geometry: { type: 'LineString'; coordinates: LngLat[] };
	candidate: RouteCandidateMetadata;
	scores: RouteScoreComponents;
}

export interface CandidateDebug {
	candidate: RouteCandidateMetadata;
	distance?: number;
	duration?: number;
	scores?: RouteScoreComponents;
	rejectionReasons: string[];
	error?: string;
}

export interface RouteDebug {
	schemaVersion: number;
	generatedAt: string;
	seed: string;
	generatorVersion: string;
	graphDataVersion: string;
	input: RouteGenerationRequest & { targetKm: number };
	candidates: CandidateDebug[];
	selectedCandidateId?: string;
	requestBudget: {
		maximumValhallaCalls: number;
		usedValhallaCalls: number;
		elapsedMs: number;
	};
	error?: string;
}

export interface RouteGenerationResponse {
	route: RouteResult;
	debug: RouteDebug;
}
