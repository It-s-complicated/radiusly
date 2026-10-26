import { describe, expect, it } from 'vitest';
import { RoutingError, WalkingGraph, type GraphData, type SearchBudget } from './graph';
import { generateLoop, repetition } from './generate';
import { parseWalkingRequest } from './request';
import type { WalkingRequest } from '#lib/types.js';

const budget = (): SearchBudget => ({
	remaining: 1_000_000,
	expanded: 0,
	deadline: performance.now() + 10_000,
});
const request: WalkingRequest = {
	start: [52.52, 13.4],
	target: { mode: 'distance', value: 2 },
	pace: 5,
	shape: 'organic',
	search: 'astar',
	spots: [],
	bearing: 25,
};
function grid(): WalkingGraph {
	const data: GraphData = {
		version: 1,
		region: 'test grid',
		dataVersion: 'fixture',
		nodes: [],
		edges: [],
		stations: [],
	};
	for (let y = 0; y < 25; y++)
		for (let x = 0; x < 25; x++) {
			const node = y * 25 + x;
			data.nodes.push([52.508 + y * 0.001, 13.388 + x * 0.001]);
			if (x) data.edges.push([node - 1, node, String(node), 3]);
			if (y) data.edges.push([node - 25, node, String(node + 1000), 3]);
		}
	return new WalkingGraph(data);
}

describe('local walking router', () => {
	it('A* and Dijkstra find equal-cost paths on the same graph, including mid-edge endpoints', () => {
		const graph = grid();
		let aExpanded = 0,
			dExpanded = 0;
		for (let i = 0; i < 20; i++) {
			const from = graph.snap([52.51 + i * 0.0003, 13.389 + i * 0.0001], 100);
			const to = graph.snap([52.53 - i * 0.0002, 13.41 - i * 0.0001], 100);
			const a = budget(),
				d = budget();
			const length = (algorithm: 'astar' | 'dijkstra', b: SearchBudget) =>
				graph
					.search(from, to, algorithm, b)
					.reduce((sum, s) => sum + Math.abs(s.to - s.from) * graph.lengths[s.edge]!, 0);
			expect(length('astar', a)).toBeCloseTo(length('dijkstra', d), 5);
			aExpanded += a.expanded;
			dExpanded += d.expanded;
		}
		expect(aExpanded).toBeLessThan(dExpanded);
	});
	it('respects pedestrian one-way edges and disconnected topology', () => {
		const graph = new WalkingGraph({
			version: 1,
			region: 'fixture',
			dataVersion: 'fixture',
			nodes: [
				[52, 13],
				[52, 13.01],
				[52.01, 13],
				[52.01, 13.01],
			],
			edges: [
				[0, 1, 'oneway', 1],
				[2, 3, 'island', 3],
			],
			stations: [],
		});
		const a = graph.snap([52, 13.002], 10),
			b = graph.snap([52, 13.008], 10);
		for (const algorithm of ['astar', 'dijkstra'] as const) {
			const path = graph.search(a, b, algorithm, budget());
			expect(path).toHaveLength(1);
			expect(path[0]!.to - path[0]!.from).toBeCloseTo(0.6);
			expect(() => graph.search(b, a, algorithm, budget())).toThrow(/not connected/);
			expect(() => graph.search(a, graph.snap([52.01, 13.005], 10), algorithm, budget())).toThrow(
				/not connected/,
			);
		}
	});
	it('measures out-and-back repetition and exempts only the deliberate return', () => {
		const graph = grid();
		graph.data.stations.push(graph.data.nodes[0]!);
		const path = [
			{ edge: 0, from: 0, to: 1 },
			{ edge: 1, from: 0, to: 1 },
			{ edge: 1, from: 1, to: 0 },
			{ edge: 0, from: 1, to: 0 },
		];
		const outbound = graph.lengths[0]! + graph.lengths[1]!;
		const repeat = repetition(graph, path);
		expect(repeat.repeated).toBeCloseTo(outbound);
		expect(repeat.longest).toBeCloseTo(outbound);
		expect(repeat.accidental).toBeCloseTo(outbound);
		expect(repeat.longestAccidental).toBeCloseTo(outbound);
		expect(repeat.stationRepeat).toBeCloseTo(outbound);
		const deliberate = repetition(graph, path, 2);
		expect(deliberate.repeated).toBeCloseTo(outbound);
		expect(deliberate.longest).toBeCloseTo(outbound);
		expect(deliberate.accidental).toBe(0);
		expect(deliberate.longestAccidental).toBe(0);
		expect(deliberate.stationRepeat).toBe(0);
	});
	it('counts only overlapping fractions', () => {
		const graph = grid();
		const path = [
			{ edge: 0, from: 0.2, to: 0.8 },
			{ edge: 0, from: 0.8, to: 0.5 },
		];
		expect(repetition(graph, path).repeated).toBeCloseTo(graph.lengths[0]! * 0.3);
		expect(repetition(graph, path).accidental).toBeGreaterThan(0);
	});
	it('clips station repetition to the part of an edge inside the station radius', () => {
		const graph = new WalkingGraph({
			version: 1,
			region: 'station edge',
			dataVersion: 'fixture',
			nodes: [
				[52.52, 13.39],
				[52.52, 13.41],
			],
			edges: [[0, 1, 'long', 3]],
			stations: [[52.52, 13.4]],
		});
		const repeat = repetition(graph, [
			{ edge: 0, from: 0, to: 1 },
			{ edge: 0, from: 1, to: 0 },
		]);
		expect(repeat.stationRepeat).toBeCloseTo(500, 0);
		expect(repeat.stationRepeat).toBeLessThan(graph.lengths[0]!);
		expect(repetition(graph, [{ edge: 0, from: 0, to: 1 }]).stationRepeat).toBe(0);
	});
	it('rejects excessive backtracking even when a candidate is closer to the target', () => {
		const { route, debug } = generateLoop(grid(), request, budget());
		const candidates = debug.candidates as {
			distance: number;
			accidental: number;
			accepted: boolean;
		}[];
		const closer = candidates.find(
			(candidate) =>
				Math.abs(candidate.distance - 2000) < route.distanceErrorDistance &&
				candidate.accidental / candidate.distance > 0.05,
		);
		expect(closer).toMatchObject({ accepted: false });
		expect(route.distanceError).toBeLessThanOrEqual(0.25);
		expect(route.repeatRatio).toBeLessThanOrEqual(0.05);
		expect(route.longestRepeatDistance).toBeLessThanOrEqual(210);
	});
	it('prefers less station backtracking over a closer distance match', () => {
		const graph = grid();
		const input: WalkingRequest = {
			...request,
			target: { mode: 'distance', value: 1.5 },
			bearing: 240,
		};
		const { route: withoutStation } = generateLoop(graph, input, budget());
		graph.data.stations.push(input.start);
		const { route: withStation } = generateLoop(graph, input, budget());
		expect(withStation.distanceError).toBeGreaterThan(withoutStation.distanceError);
		expect(withStation.repeatedDistance).toBeLessThan(withoutStation.repeatedDistance);
		expect(withStation.stationRepeatDistance).toBeGreaterThan(0);
		expect(withStation.stationRepeatDistance).toBeLessThan(withoutStation.repeatedDistance);
		expect(withStation.score).toBeLessThan(
			withoutStation.score + withoutStation.repeatedDistance * 4,
		);
	});
	it('rejects an orbit with an excessive deliberate stem despite otherwise acceptable quality', () => {
		// A winding access path reaches a ring around the start, making the shared stem too long.
		const graph = new WalkingGraph({
			version: 1,
			region: 'long orbit stem',
			dataVersion: 'fixture',
			nodes: [
				[0, 0],
				[0.0006, 0],
				[0.0006, 0.0018],
				[0, 0.0018],
				[0, 0.0009],
				[0.00135, 0.0009],
				[0.00135, 0],
				[0.0021, 0],
				[0, 0.0021],
				[-0.0021, 0],
				[0, -0.0021],
			],
			edges: [
				[0, 1, 'stem', 3],
				[1, 2, 'stem', 3],
				[2, 3, 'stem', 3],
				[3, 4, 'stem', 3],
				[4, 5, 'stem', 3],
				[5, 6, 'stem', 3],
				[6, 7, 'stem', 3],
				[7, 8, 'ring', 3],
				[8, 9, 'ring', 3],
				[9, 10, 'ring', 3],
				[10, 7, 'ring', 3],
			],
			stations: [],
		});
		try {
			generateLoop(
				graph,
				{
					...request,
					start: [0, 0],
					shape: 'orbit-same',
					bearing: 0,
					target: { mode: 'distance', value: 2.4 },
				},
				budget(),
			);
		} catch (error) {
			if (!(error instanceof RoutingError)) throw error;
			expect(error.code).toBe('ROUTE_QUALITY');
			const [first] = error.details as { distance: number; stemLength: number }[];
			expect(first).toMatchObject({
				accepted: false,
				accidental: 0,
				longestAccidental: 0,
				stationRepeat: 0,
			});
			expect(Math.abs(first!.distance - 2400) / 2400).toBeLessThanOrEqual(0.25);
			expect(first!.stemLength).toBeGreaterThan(500);
			expect(first!.stemLength / first!.distance).toBeGreaterThan(0.2);
			return;
		}
		expect.fail('Expected the router to reject the excessive orbit stem');
	});
	it('generates closed loops with both algorithms and visits a required segment midpoint', () => {
		const graph = grid();
		for (const search of ['astar', 'dijkstra'] as const) {
			const input = { ...request, search, spots: [[52.523, 13.4005] as [number, number]] };
			const { route, debug } = generateLoop(graph, input, budget());
			expect(route.geometry.coordinates[0]).toEqual(route.geometry.coordinates.at(-1));
			expect(route.distanceError).toBeLessThanOrEqual(0.25);
			expect(
				route.geometry.coordinates.some(
					([lon, lat]) => Math.abs(lat - 52.523) < 1e-8 && Math.abs(lon - 13.4005) < 1e-8,
				),
			).toBe(true);
			expect(debug.input).toEqual(input);
		}
	});
	it('keeps every shape available beside a station, including the deliberate orbit return', () => {
		const graph = grid();
		graph.data.stations.push(request.start);
		for (const shape of ['organic', 'tangent', 'orbit-same', 'orbit-near', 'spaghetti'] as const) {
			const { route } = generateLoop(graph, { ...request, shape }, budget());
			expect(route.candidate?.algorithm).toBe(shape);
			expect(route.geometry.coordinates[0]).toEqual(route.geometry.coordinates.at(-1));
			expect(route.stationRepeatDistance).toBeLessThanOrEqual(100);
			if (shape === 'orbit-same') {
				expect(route.repeatRatio).toBeGreaterThan(0.05);
				expect(route.longestRepeatDistance).toBeGreaterThan(210);
			}
		}
	});

	it('has cancellable, bounded search and rejects invalid API inputs', () => {
		const graph = grid(),
			snap = graph.snap(request.start, 40);
		const cancelled = new Int32Array(new SharedArrayBuffer(4));
		Atomics.store(cancelled, 0, 1);
		expect(() => graph.search(snap, snap, 'astar', { ...budget(), cancelled })).toThrow(
			/cancelled/,
		);
		expect(() => graph.search(snap, snap, 'dijkstra', { ...budget(), remaining: 0 })).toThrow(
			/budget/,
		);
		expect(parseWalkingRequest(request)).toEqual(request);
		for (const input of [
			{ ...request, search: 'Dijkstra*' },
			{ ...request, start: [90, 13] },
			{ ...request, spots: Array(9).fill(request.start) },
			{ ...request, target: { mode: 'distance', value: Infinity } },
			{ ...request, target: { mode: 'time', value: 600 } },
		])
			expect(() => parseWalkingRequest(input)).toThrow();
		expect(
			parseWalkingRequest({ ...request, target: { mode: 'time', value: 30 } }).target.mode,
		).toBe('time');
	});
});
