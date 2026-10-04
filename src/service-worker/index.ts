import { self } from '$app/service-worker';
import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';

const CACHE_PREFIX = 'radiusly-assets-';
const CACHE = `${CACHE_PREFIX}${version}`;
const ASSETS = new Set(
	[...immutable, ...assets].map(({ path }) => new URL(path, self.registration.scope).pathname),
);

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await self.caches.open(CACHE);
			await cache.addAll([...ASSETS]);
			await self.skipWaiting();
		})(),
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await self.caches.keys()) {
				if (key.startsWith(CACHE_PREFIX) && key !== CACHE) await self.caches.delete(key);
			}
			await self.clients.claim();
		})(),
	);
});

self.addEventListener('fetch', (event) => {
	// Session-dependent pages and API responses must always reach the server.
	if (event.request.method !== 'GET' || event.request.mode === 'navigate') return;
	const url = new URL(event.request.url);
	if (url.origin !== self.location.origin || !ASSETS.has(url.pathname)) return;

	event.respondWith(
		(async () => {
			const cache = await self.caches.open(CACHE);
			return (await cache.match(event.request, { ignoreSearch: true })) ?? fetch(event.request);
		})(),
	);
});
