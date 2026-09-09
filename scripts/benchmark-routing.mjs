import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { WalkingGraph } from '../.routing/lib/server/routing/graph.js';
import { generateLoop } from '../.routing/lib/server/routing/generate.js';

const started = performance.now();
const graph = new WalkingGraph(
	JSON.parse(await readFile(process.env.ROUTING_GRAPH_PATH || 'data/routing/graph.json', 'utf8')),
);
const report = {
	generatedAt: new Date().toISOString(),
	graphVersion: graph.data.dataVersion,
	nodes: graph.data.nodes.length,
	segments: graph.data.edges.length,
	loadMs: Math.round(performance.now() - started),
	results: [],
};
for (const [area, start] of [
	['alexanderplatz', [52.5208, 13.4095]],
	['pankow', [52.5692, 13.4129]],
	['tiergarten', [52.5145, 13.35]],
]) {
	for (const shape of ['organic', 'tangent', 'orbit-same', 'orbit-near', 'spaghetti'])
		for (const search of ['astar', 'dijkstra']) {
			const request = {
				start,
				target: { mode: 'distance', value: 4 },
				pace: 5,
				shape,
				search,
				spots: [],
				bearing: 25,
			};
			const budget = { remaining: 2_000_000, expanded: 0, deadline: performance.now() + 10_000 };
			const began = performance.now();
			let result;
			try {
				const { route, debug } = generateLoop(graph, request, budget);
				result = {
					area,
					shape,
					search,
					distance: route.distance,
					repeatRatio: route.repeatRatio,
					attempts: debug.candidates.length,
				};
			} catch (error) {
				result = { area, shape, search, error: error.code || error.message };
			}
			Object.assign(result, {
				expanded: budget.expanded,
				elapsedMs: Math.round(performance.now() - began),
			});
			report.results.push(result);
			console.log(JSON.stringify(result));
		}
}
report.rssMiB = Math.round(process.memoryUsage().rss / 1024 ** 2);
await mkdir('data/routing', { recursive: true });
await writeFile('data/routing/benchmark.json', JSON.stringify(report, null, 2) + '\n');
console.log(
	JSON.stringify({
		accepted: report.results.filter((r) => !r.error).length,
		total: report.results.length,
		loadMs: report.loadMs,
		rssMiB: report.rssMiB,
	}),
);
