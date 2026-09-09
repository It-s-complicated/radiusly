import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { env } from '$env/dynamic/private';
import type { RouteDebug, RouteResult, WalkingRequest } from '$lib/types';
import { RoutingError } from './graph';

type Result = { route: RouteResult; debug: RouteDebug };
let worker: Worker | undefined;
let ready: Promise<void> | undefined;
let nextId = 0;
let admitted = 0;
const pending = new Map<
	number,
	{ resolve: (result: Result) => void; reject: (error: Error) => void; cleanup: () => void }
>();

function startWorker(): Promise<void> {
	if (ready) return ready;
	ready = new Promise<void>((resolveReady, rejectReady) => {
		const instance = new Worker(resolve('.routing/lib/server/routing/worker.js'), {
			workerData: { graphPath: resolve(env.ROUTING_GRAPH_PATH || 'data/routing/graph.json') },
		});
		worker = instance;
		const fail = () => {
			if (worker !== instance) return;
			const error = new RoutingError(
				'GRAPH_UNAVAILABLE',
				'Local walking data is unavailable. Build the regional graph and restart the server.',
			);
			clearTimeout(startupTimer);
			rejectReady(error);
			for (const task of pending.values()) {
				task.cleanup();
				task.reject(error);
			}
			pending.clear();
			worker = undefined;
			ready = undefined;
			void instance.terminate();
		};
		const startupTimer = setTimeout(fail, 30_000);
		instance.on('error', fail);
		instance.on('exit', fail);
		instance.on('message', (message) => {
			if (message.initializationError) return fail();
			if (message.ready) {
				clearTimeout(startupTimer);
				return resolveReady();
			}
			const task = pending.get(message.id);
			if (!task) return;
			pending.delete(message.id);
			task.cleanup();
			if (message.error)
				task.reject(
					new RoutingError(message.error.code, message.error.message, message.error.details),
				);
			else task.resolve(message.result);
		});
		instance.unref();
	});
	return ready;
}

/** ponytail: one worker/graph copy, four admitted requests; add workers after measuring contention. */
export async function routeOnServer(request: WalkingRequest, signal: AbortSignal): Promise<Result> {
	if (admitted >= 4)
		throw new RoutingError('BUSY', 'The route planner is busy. Please try again shortly.');
	admitted++;
	try {
		await startWorker();
		if (signal.aborted) throw new RoutingError('CANCELLED', 'Route generation cancelled.');
	} catch (error) {
		admitted--;
		throw error;
	}
	return new Promise((resolveResult, reject) => {
		const id = ++nextId;
		const cancellation = new SharedArrayBuffer(4);
		const cancel = () => {
			Atomics.store(new Int32Array(cancellation), 0, 1);
			reject(new RoutingError('CANCELLED', 'Route generation cancelled.'));
		};
		// Keep the admission slot until the worker acknowledges completion/cancellation.
		const timer = setTimeout(cancel, 30_000);
		signal.addEventListener('abort', cancel, { once: true });
		pending.set(id, {
			resolve: resolveResult,
			reject,
			cleanup: () => {
				admitted--;
				clearTimeout(timer);
				signal.removeEventListener('abort', cancel);
			},
		});
		worker!.postMessage({ id, request, cancellation });
	});
}
