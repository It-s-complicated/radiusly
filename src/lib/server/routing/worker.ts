import { readFile } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';
import { WalkingGraph, RoutingError } from './graph.js';
import { generateLoop } from './generate.js';
import type { WalkingRequest } from '../../types.js';

const port = parentPort!;
try {
	const graph = new WalkingGraph(JSON.parse(await readFile(workerData.graphPath, 'utf8')));
	port.on(
		'message',
		({
			id,
			request,
			cancellation,
		}: {
			id: number;
			request: WalkingRequest;
			cancellation: SharedArrayBuffer;
		}) => {
			try {
				const result = generateLoop(graph, request, {
					remaining: 2_000_000,
					expanded: 0,
					deadline: performance.now() + 10_000,
					cancelled: new Int32Array(cancellation),
				});
				port.postMessage({ id, result });
			} catch (error) {
				port.postMessage({
					id,
					error: {
						code: error instanceof RoutingError ? error.code : 'ROUTING_FAILED',
						details: error instanceof RoutingError ? error.details : undefined,
						message: error instanceof RoutingError ? error.message : 'Route generation failed.',
					},
				});
			}
		},
	);
	port.postMessage({ ready: true });
} catch (error) {
	console.error('Walking graph initialization failed:', error);
	port.postMessage({ initializationError: true });
	port.close();
}
