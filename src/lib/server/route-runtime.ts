import { createHash } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { createClient, type RedisClientType } from 'redis';
import type { RouteGenerationRequest, RouteGenerationResponse } from '$lib/route/contracts';

const RATE_WINDOW_SECONDS = 60;
const RATE_LIMIT = 10;
const CACHE_TTL_SECONDS = 300;
const MAX_ACTIVE_GENERATIONS = 2;

let redisPromise: Promise<RedisClientType | undefined> | undefined;
let activeGenerations = 0;
const localRateLimits = new Map<string, { count: number; expiresAt: number }>();
const localCache = new Map<string, { value: string; expiresAt: number }>();

export class RouteCapacityError extends Error {}
export class RouteConfigurationError extends Error {}
export class RouteRateLimitError extends Error {
	constructor(readonly retryAfterSeconds: number) {
		super('Route generation rate limit exceeded');
	}
}

export async function enforceRouteRateLimit(identity: string): Promise<void> {
	const redis = await getRedis();
	if (redis) {
		const key = `radiusly:route-rate:${identity}:${Math.floor(Date.now() / (RATE_WINDOW_SECONDS * 1000))}`;
		const count = await redis.eval(
			"local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return count",
			{ keys: [key], arguments: [String(RATE_WINDOW_SECONDS + 1)] },
		);
		if (Number(count) > RATE_LIMIT) throw new RouteRateLimitError(RATE_WINDOW_SECONDS);
		return;
	}

	const now = Date.now();
	const current = localRateLimits.get(identity);
	const next = !current || current.expiresAt <= now
		? { count: 1, expiresAt: now + RATE_WINDOW_SECONDS * 1000 }
		: { count: current.count + 1, expiresAt: current.expiresAt };
	localRateLimits.set(identity, next);
	if (next.count > RATE_LIMIT) {
		throw new RouteRateLimitError(Math.max(1, Math.ceil((next.expiresAt - now) / 1000)));
	}
}

export async function withGenerationSlot<T>(work: () => Promise<T>): Promise<T> {
	if (activeGenerations >= MAX_ACTIVE_GENERATIONS) {
		throw new RouteCapacityError('Route generation is at capacity');
	}
	activeGenerations += 1;
	try {
		return await work();
	} finally {
		activeGenerations -= 1;
	}
}

export async function getCachedRoute(
	request: RouteGenerationRequest,
	graphDataVersion: string,
): Promise<RouteGenerationResponse | undefined> {
	const key = routeCacheKey(request, graphDataVersion);
	const redis = await getRedis();
	const value = redis ? await redis.get(key) : localCacheValue(key);
	if (!value) return undefined;
	return JSON.parse(value) as RouteGenerationResponse;
}

export async function cacheRoute(
	request: RouteGenerationRequest,
	graphDataVersion: string,
	response: RouteGenerationResponse,
): Promise<void> {
	const key = routeCacheKey(request, graphDataVersion);
	const value = JSON.stringify(response);
	const redis = await getRedis();
	if (redis) {
		await redis.set(key, value, { EX: CACHE_TTL_SECONDS });
		return;
	}
	localCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000 });
}

export async function redisHealth(): Promise<'ok' | 'development-memory'> {
	const redis = await getRedis();
	if (!redis) return 'development-memory';
	return await redis.ping() === 'PONG' ? 'ok' : 'development-memory';
}

function routeCacheKey(request: RouteGenerationRequest, graphDataVersion: string): string {
	const digest = createHash('sha256')
		.update(graphDataVersion)
		.update('\0')
		.update(JSON.stringify(request))
		.digest('hex');
	return `radiusly:route-cache:${digest}`;
}

function localCacheValue(key: string): string | undefined {
	const entry = localCache.get(key);
	if (!entry) return undefined;
	if (entry.expiresAt <= Date.now()) {
		localCache.delete(key);
		return undefined;
	}
	return entry.value;
}

async function getRedis(): Promise<RedisClientType | undefined> {
	if (!redisPromise) {
		redisPromise = connectRedis();
	}
	return redisPromise;
}

async function connectRedis(): Promise<RedisClientType | undefined> {
	if (!env.REDIS_URL) {
		if (env.NODE_ENV === 'production') {
			throw new RouteConfigurationError('REDIS_URL is required for shared production route limits and caching');
		}
		return undefined;
	}
	const client = createClient({ url: env.REDIS_URL });
	client.on('error', (error) => console.error(JSON.stringify({ event: 'redis_error', message: error.message })));
	await client.connect();
	return client as RedisClientType;
}
