import { distance } from '../../route/scoring.js';
import type { LatLng, SearchAlgorithm } from '../../types.js';

/** Each segment is an original OSM node pair. Flags: 1 forward, 2 backward. */
export interface GraphData {
	version: 1;
	bounds?: [west: number, south: number, east: number, north: number];
	region: string;
	dataVersion: string;
	nodes: LatLng[];
	edges: [from: number, to: number, wayId: string, flags: number][];
	stations: LatLng[];
}

export class RoutingError extends Error {
	constructor(
		public code: string,
		message: string,
		public details?: unknown,
	) {
		super(message);
	}
}

export interface Snap {
	edge: number;
	fraction: number;
	point: LatLng;
	distance: number;
}

export interface Traversal {
	edge: number;
	from: number;
	to: number;
}

export interface SearchBudget {
	remaining: number;
	expanded: number;
	deadline: number;
	cancelled?: Int32Array;
}

export function checkBudget(budget: SearchBudget): void {
	if (budget.cancelled && Atomics.load(budget.cancelled, 0))
		throw new RoutingError('CANCELLED', 'Route generation cancelled.');
	if (budget.remaining <= 0 || performance.now() > budget.deadline)
		throw new RoutingError(
			'SEARCH_LIMIT',
			'Search budget reached. Try a shorter walk or fewer spots.',
		);
}

export function meters(a: LatLng, b: LatLng): number {
	return distance([a[1], a[0]], [b[1], b[0]]);
}

/** Shared priority queue for both searches. The only algorithm difference is the heuristic. */
class MinHeap {
	private values: [priority: number, node: number, cost: number][] = [];
	push(value: [number, number, number]): void {
		let i = this.values.length;
		this.values.push(value);
		while (i > 0) {
			const parent = (i - 1) >>> 1;
			if (this.values[parent]![0] <= value[0]) break;
			this.values[i] = this.values[parent]!;
			i = parent;
		}
		this.values[i] = value;
	}
	pop(): [number, number, number] | undefined {
		const first = this.values[0];
		const last = this.values.pop();
		if (!last || this.values.length === 0) return first;
		let i = 0;
		while (i * 2 + 1 < this.values.length) {
			let child = i * 2 + 1;
			if (child + 1 < this.values.length && this.values[child + 1]![0] < this.values[child]![0])
				child++;
			if (last[0] <= this.values[child]![0]) break;
			this.values[i] = this.values[child]!;
			i = child;
		}
		this.values[i] = last;
		return first;
	}
}

export class WalkingGraph {
	readonly lengths: Float64Array;
	private readonly components: Uint32Array;
	private readonly offsets: Uint32Array;
	private readonly arcs: Int32Array;
	private readonly cells = new Map<string, number[]>();
	private readonly cellSize = 0.005;

	constructor(readonly data: GraphData) {
		if (
			data.version !== 1 ||
			!data.region ||
			!data.dataVersion ||
			!Array.isArray(data.nodes) ||
			!Array.isArray(data.edges) ||
			!Array.isArray(data.stations) ||
			!data.edges.length
		)
			throw new Error('Invalid walking graph. Rebuild the regional graph.');
		for (const point of data.nodes.concat(data.stations)) {
			if (
				!Array.isArray(point) ||
				point.length !== 2 ||
				!point.every(Number.isFinite) ||
				Math.abs(point[0]) > 85 ||
				Math.abs(point[1]) > 180
			)
				throw new Error('Invalid graph coordinate.');
		}
		this.components = Uint32Array.from({ length: data.nodes.length }, (_, i) => i);
		const root = (node: number): number => {
			while (this.components[node] !== node) {
				this.components[node] = this.components[this.components[node]!]!;
				node = this.components[node]!;
			}
			return node;
		};
		this.lengths = new Float64Array(data.edges.length);
		this.offsets = new Uint32Array(data.nodes.length + 1);
		data.edges.forEach(([from, to, way, flags], id) => {
			if (
				!Number.isInteger(from) ||
				!Number.isInteger(to) ||
				!data.nodes[from] ||
				!data.nodes[to] ||
				from === to ||
				typeof way !== 'string' ||
				![1, 2, 3].includes(flags)
			)
				throw new Error('Invalid graph edge.');
			const a = data.nodes[from]!;
			const b = data.nodes[to]!;
			const length = meters(a, b);
			if (!(length > 0) || length > 20_000) throw new Error('Invalid graph segment length.');
			this.lengths[id] = length;
			this.components[root(from)] = root(to);
			if (flags & 1) this.offsets[from + 1]!++;
			if (flags & 2) this.offsets[to + 1]!++;
			const minY = Math.floor(Math.min(a[0], b[0]) / this.cellSize);
			const maxY = Math.floor(Math.max(a[0], b[0]) / this.cellSize);
			const minX = Math.floor(Math.min(a[1], b[1]) / this.cellSize);
			const maxX = Math.floor(Math.max(a[1], b[1]) / this.cellSize);
			for (let y = minY; y <= maxY; y++)
				for (let x = minX; x <= maxX; x++) {
					const key = `${y},${x}`;
					const bucket = this.cells.get(key);
					if (bucket) bucket.push(id);
					else this.cells.set(key, [id]);
				}
		});
		for (let i = 0; i < data.nodes.length; i++) this.components[i] = root(i);
		for (let i = 1; i < this.offsets.length; i++) this.offsets[i]! += this.offsets[i - 1]!;
		this.arcs = new Int32Array(this.offsets.at(-1)!);
		const cursors = this.offsets.slice();
		data.edges.forEach(([from, to, , flags], id) => {
			if (flags & 1) this.arcs[cursors[from]!++] = id + 1;
			if (flags & 2) this.arcs[cursors[to]!++] = -(id + 1);
		});
	}

	point(edge: number, fraction: number): LatLng {
		const [from, to] = this.data.edges[edge]!;
		const a = this.data.nodes[from]!;
		const b = this.data.nodes[to]!;
		return [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
	}

	component(snap: Snap): number {
		return this.components[this.data.edges[snap.edge]![0]]!;
	}

	snap(point: LatLng, maxMeters: number, component?: number): Snap {
		const latRadius = maxMeters / 110_000;
		const lonScale = Math.cos((point[0] * Math.PI) / 180);
		const lonRadius = latRadius / lonScale;
		let best: Snap | undefined;
		const visited = new Set<number>();
		for (
			let y = Math.floor((point[0] - latRadius) / this.cellSize);
			y <= Math.floor((point[0] + latRadius) / this.cellSize);
			y++
		) {
			for (
				let x = Math.floor((point[1] - lonRadius) / this.cellSize);
				x <= Math.floor((point[1] + lonRadius) / this.cellSize);
				x++
			) {
				for (const edge of this.cells.get(`${y},${x}`) ?? []) {
					if (
						visited.has(edge) ||
						(component !== undefined && this.components[this.data.edges[edge]![0]] !== component)
					)
						continue;
					visited.add(edge);
					const [from, to] = this.data.edges[edge]!;
					const a = this.data.nodes[from]!;
					const b = this.data.nodes[to]!;
					const dx = (b[1] - a[1]) * lonScale,
						dy = b[0] - a[0];
					const fraction = Math.max(
						0,
						Math.min(
							1,
							((point[1] - a[1]) * lonScale * dx + (point[0] - a[0]) * dy) / (dx * dx + dy * dy),
						),
					);
					const snapped = this.point(edge, fraction);
					const distance = meters(point, snapped);
					if (distance <= maxMeters && (!best || distance < best.distance))
						best = { edge, fraction, point: snapped, distance };
				}
			}
		}
		if (!best)
			throw new RoutingError(
				'NO_NEARBY_PATH',
				'No walking path near this point in the loaded region. Move the pin onto a path.',
			);
		return best;
	}

	search(
		start: Snap,
		end: Snap,
		algorithm: SearchAlgorithm,
		budget: SearchBudget,
		used = new Set<number>(),
	): Traversal[] {
		checkBudget(budget);
		const source = this.data.nodes.length,
			target = source + 1;
		if (this.component(start) !== this.component(end))
			throw new RoutingError(
				'DISCONNECTED',
				'These points are not connected by the supported walking network.',
			);
		const costs = new Map<number, number>();
		const previous = new Map<number, { node: number; step: Traversal }>();
		const heap = new MinHeap();
		// Chord distance is a lower bound on arc length. Interpolate snapped endpoints
		// in this same 3D space so partial-edge costs keep the heuristic admissible.
		const xyz = ([lat, lon]: LatLng) => {
			const phi = (lat * Math.PI) / 180,
				lambda = (lon * Math.PI) / 180;
			return [
				6371000 * Math.cos(phi) * Math.cos(lambda),
				6371000 * Math.cos(phi) * Math.sin(lambda),
				6371000 * Math.sin(phi),
			];
		};
		const snapXYZ = (snap: Snap) => {
			const [from, to] = this.data.edges[snap.edge]!;
			const a = xyz(this.data.nodes[from]!),
				b = xyz(this.data.nodes[to]!);
			return a.map((v, i) => v + (b[i]! - v) * snap.fraction);
		};
		const destination = snapXYZ(end),
			origin = snapXYZ(start);
		const heuristic = (node: number) => {
			if (algorithm === 'dijkstra' || node === target) return 0;
			const point = node === source ? origin : xyz(this.data.nodes[node]!);
			return Math.hypot(...point.map((v, i) => v - destination[i]!));
		};
		const relax = (node: number, next: number, step: Traversal) => {
			const cost =
				costs.get(node)! +
				Math.abs(step.to - step.from) * this.lengths[step.edge]! * (used.has(step.edge) ? 4 : 1);
			if (cost >= (costs.get(next) ?? Infinity)) return;
			costs.set(next, cost);
			previous.set(next, { node, step });
			heap.push([cost + heuristic(next), next, cost]);
		};
		costs.set(source, 0);
		heap.push([heuristic(source), source, 0]);
		let current: ReturnType<MinHeap['pop']>;
		while ((current = heap.pop())) {
			const [, node, cost] = current;
			if (cost !== costs.get(node)) continue;
			budget.remaining--;
			budget.expanded++;
			if (budget.remaining <= 0 || budget.expanded % 256 === 0) checkBudget(budget);
			if (node === target) {
				const path: Traversal[] = [];
				let cursor = target;
				while (cursor !== source) {
					const p = previous.get(cursor)!;
					if (Math.abs(p.step.to - p.step.from) > 1e-10) path.push(p.step);
					cursor = p.node;
				}
				return path.reverse();
			}
			if (node === source) {
				const [a, b, , flags] = this.data.edges[start.edge]!;
				if (flags & 1 || start.fraction === 1)
					relax(node, b, { edge: start.edge, from: start.fraction, to: 1 });
				if (flags & 2 || start.fraction === 0)
					relax(node, a, { edge: start.edge, from: start.fraction, to: 0 });
				if (
					start.edge === end.edge &&
					(start.fraction === end.fraction ||
						(start.fraction < end.fraction ? flags & 1 : flags & 2))
				)
					relax(node, target, { edge: start.edge, from: start.fraction, to: end.fraction });
				continue;
			}
			const [a, b, , flags] = this.data.edges[end.edge]!;
			if (node === a && (flags & 1 || end.fraction === 0))
				relax(node, target, { edge: end.edge, from: 0, to: end.fraction });
			if (node === b && (flags & 2 || end.fraction === 1))
				relax(node, target, { edge: end.edge, from: 1, to: end.fraction });
			for (let i = this.offsets[node]!; i < this.offsets[node + 1]!; i++) {
				const arc = this.arcs[i]!,
					edge = Math.abs(arc) - 1;
				const [from, to] = this.data.edges[edge]!;
				relax(node, arc > 0 ? to : from, { edge, from: arc > 0 ? 0 : 1, to: arc > 0 ? 1 : 0 });
			}
		}
		throw new RoutingError(
			'DISCONNECTED',
			'These points are not connected by the supported walking network.',
		);
	}
}
