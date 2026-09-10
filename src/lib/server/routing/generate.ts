import { loopPoints, targetKilometers } from '../../route/shapes.js';
import type { RouteDebug, RouteResult, WalkingRequest } from '../../types.js';
import {
	checkBudget,
	meters,
	RoutingError,
	WalkingGraph,
	type SearchBudget,
	type Traversal,
} from './graph.js';

const STATION_RADIUS = 250;

function stationIntervals(graph: WalkingGraph, edge: number): [number, number][] {
	const [from, to] = graph.data.edges[edge]!;
	const start = graph.data.nodes[from]!,
		end = graph.data.nodes[to]!;
	const lonScale = Math.cos(((start[0] + end[0]) * Math.PI) / 360);
	const dx = (end[1] - start[1]) * lonScale,
		dy = end[0] - start[0],
		lengthSquared = dx * dx + dy * dy;
	const intervals: [number, number][] = [];
	for (const station of graph.data.stations) {
		const closest = Math.max(
			0,
			Math.min(
				1,
				((station[1] - start[1]) * lonScale * dx + (station[0] - start[0]) * dy) / lengthSquared,
			),
		);
		if (meters(graph.point(edge, closest), station) > STATION_RADIUS) continue;
		const boundary = (outside: number, inside: number) => {
			if (meters(graph.point(edge, outside), station) <= STATION_RADIUS) return outside;
			for (let i = 0; i < 24; i++) {
				const middle = (outside + inside) / 2;
				if (meters(graph.point(edge, middle), station) <= STATION_RADIUS) inside = middle;
				else outside = middle;
			}
			return inside;
		};
		intervals.push([boundary(0, closest), boundary(1, closest)]);
	}
	const merged: [number, number][] = [];
	for (const interval of intervals.sort((a, b) => a[0] - b[0])) {
		const last = merged.at(-1);
		if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
		else merged.push([...interval]);
	}
	return merged;
}

/** Physical segment intervals make scoring independent of polyline sampling. */
export function repetition(graph: WalkingGraph, path: Traversal[], intentionalReturn = 0) {
	const seen = new Map<number, [number, number][]>();
	const stationCoverage = new Map<number, [number, number][]>();
	let repeated = 0,
		longest = 0,
		run = 0,
		accidental = 0,
		accidentalRun = 0,
		longestAccidental = 0,
		stationRepeat = 0;
	path.forEach((step, index) => {
		const lo = Math.min(step.from, step.to),
			hi = Math.max(step.from, step.to);
		const intervals = seen.get(step.edge) ?? [];
		const cuts = [...new Set([lo, hi, ...intervals.flat().filter((x) => x > lo && x < hi)])].sort(
			(a, b) => a - b,
		);
		if (step.to < step.from) cuts.reverse();
		for (let i = 1; i < cuts.length; i++) {
			const a = cuts[i - 1]!,
				b = cuts[i]!,
				mid = (a + b) / 2;
			const length = Math.abs(b - a) * graph.lengths[step.edge]!;
			if (intervals.some(([from, to]) => mid >= from && mid <= to)) {
				repeated += length;
				run += length;
				longest = Math.max(longest, run);
				if (index < path.length - intentionalReturn) {
					accidental += length;
					accidentalRun += length;
					longestAccidental = Math.max(longestAccidental, accidentalRun);
				}
				let coverage = stationCoverage.get(step.edge);
				if (!coverage) {
					coverage = stationIntervals(graph, step.edge);
					stationCoverage.set(step.edge, coverage);
				}
				const lower = Math.min(a, b),
					upper = Math.max(a, b);
				stationRepeat +=
					coverage.reduce(
						(sum, [from, to]) => sum + Math.max(0, Math.min(upper, to) - Math.max(lower, from)),
						0,
					) * graph.lengths[step.edge]!;
			} else {
				run = 0;
				accidentalRun = 0;
			}
		}
		const merged: [number, number][] = [];
		for (const interval of [...intervals, [lo, hi] as [number, number]].sort(
			(a, b) => a[0] - b[0],
		)) {
			const last = merged.at(-1);
			if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
			else merged.push([...interval]);
		}
		seen.set(step.edge, merged);
	});
	return { repeated, longest, accidental, longestAccidental, stationRepeat };
}

export function generateLoop(
	graph: WalkingGraph,
	request: WalkingRequest,
	budget: SearchBudget,
): { route: RouteResult; debug: RouteDebug } {
	const started = performance.now();
	if (graph.data.bounds) {
		const [west, south, east, north] = graph.data.bounds;
		if (
			request.start[1] < west ||
			request.start[1] > east ||
			request.start[0] < south ||
			request.start[0] > north
		)
			throw new RoutingError(
				'OUTSIDE_COVERAGE',
				'This starting point is outside the supported walking region.',
			);
	}
	const target = targetKilometers(request.target.mode, request.target.value, request.pace) * 1000;
	const start = graph.snap(request.start, 40);
	const component = graph.component(start);
	const maxStemKm = graph.data.stations.some((station) => meters(start.point, station) <= 250)
		? 0.05
		: 0.25;
	const spots = request.spots.map((point) => graph.snap(point, 40, component));
	for (const spot of spots) graph.search(start, spot, request.search, budget);
	const candidates: Record<string, unknown>[] = [];
	let best: RouteResult | undefined;
	let scale = 0.9;
	for (let attempt = 0; attempt < 12; attempt++) {
		checkBudget(budget);
		const bearing = (request.bearing + Math.floor(attempt / 3) * 89) % 360;
		const points = loopPoints(
			start.point,
			target / 1000,
			bearing,
			request.spots,
			scale,
			request.shape,
			maxStemKm,
		);
		try {
			const snaps = points.map((point, index) => {
				if (index === 0 || index === points.length - 1) return start;
				const spot = request.spots.findIndex((p) => p[0] === point[0] && p[1] === point[1]);
				return spot >= 0
					? spots[spot]!
					: graph.snap(point, Math.min(1000, Math.max(150, target / 8)), component);
			});
			const used = new Set<number>();
			const path: Traversal[] = [];
			let stem: Traversal[] = [];
			let intentionalReturn = 0;
			for (let i = 1; i < snaps.length; i++) {
				checkBudget(budget);
				let leg: Traversal[];
				if (request.shape === 'orbit-same' && i === snaps.length - 1) {
					if (stem.some((step) => graph.data.edges[step.edge]![3] !== 3))
						throw new RoutingError(
							'SHAPE_UNAVAILABLE',
							'The orbit stem cannot be walked both ways.',
						);
					leg = [...stem]
						.reverse()
						.map((step) => ({ edge: step.edge, from: step.to, to: step.from }));
					intentionalReturn = leg.length;
				} else leg = graph.search(snaps[i - 1]!, snaps[i]!, request.search, budget, used);
				if (i === 1) stem = leg;
				path.push(...leg);
				for (const step of leg) used.add(step.edge);
			}
			const distance = path.reduce(
				(sum, step) => sum + Math.abs(step.to - step.from) * graph.lengths[step.edge]!,
				0,
			);
			if (distance < 1)
				throw new RoutingError('SHAPE_UNAVAILABLE', 'Shape collapsed to a single point.');
			const repeat = repetition(graph, path, intentionalReturn);
			const distanceError = Math.abs(distance - target) / target;
			const stemLength = stem.reduce(
				(sum, step) => sum + Math.abs(step.to - step.from) * graph.lengths[step.edge]!,
				0,
			);
			const accepted =
				distanceError <= 0.25 &&
				repeat.accidental / distance <= 0.05 &&
				repeat.longestAccidental <= 210 &&
				repeat.stationRepeat <= 100 &&
				(request.shape !== 'orbit-same' || stemLength <= 500);
			const score =
				Math.abs(distance - target) +
				repeat.accidental +
				repeat.longestAccidental * 2 +
				repeat.stationRepeat * 4;
			candidates.push({
				attempt,
				bearing,
				scale,
				distance,
				accepted,
				...repeat,
				expandedNodes: budget.expanded,
				stemLength,
			});
			if (accepted && (!best || score < best.score)) {
				const geometry: [number, number][] = [[start.point[1], start.point[0]]];
				for (const step of path) {
					const p = graph.point(step.edge, step.to);
					geometry.push([p[1], p[0]]);
				}
				best = {
					distance,
					duration: (distance / 1000 / request.pace) * 3600,
					geometry: { coordinates: geometry },
					weight: distance,
					candidate: {
						algorithm: request.shape,
						bearing,
						scale,
						points: snaps.map((s) => s.point),
					},
					distanceError,
					distanceErrorDistance: Math.abs(distance - target),
					repeatRatio: repeat.repeated / distance,
					repeatedDistance: repeat.repeated,
					longestRepeatRatio: repeat.longest / distance,
					longestRepeatDistance: repeat.longest,
					stationRepeatDistance: repeat.stationRepeat,
					score,
				};
			}
			if (best && best.distanceError <= 0.1) break;
			scale = Math.max(0.2, Math.min(1.6, (scale * target) / distance));
		} catch (error) {
			if (!(error instanceof RoutingError) || ['CANCELLED', 'SEARCH_LIMIT'].includes(error.code))
				throw error;
			candidates.push({ attempt, bearing, scale, error: error.code });
		}
		if (attempt % 3 === 2) scale = 0.9;
	}
	if (!best)
		throw new RoutingError(
			'ROUTE_QUALITY',
			'No acceptable loop found. Try another shape, a different start or fewer walk-by spots.',
			candidates,
		);
	const debug: RouteDebug = {
		schemaVersion: 14,
		generatedAt: new Date().toISOString(),
		input: request,
		candidates,
		selectedRoute: {
			...best,
			search: request.search,
			graphVersion: graph.data.dataVersion,
			region: graph.data.region,
			expandedNodes: budget.expanded,
			elapsedMs: Math.round(performance.now() - started),
			snappedStart: start,
			snappedSpots: spots,
		},
	};
	return { route: best, debug };
}
