# Radiusly stack

**Status:** Implemented.

## Application

- **SvelteKit** with strict TypeScript
- Node adapter with custom TypeScript A*/Dijkstra routing in a worker thread
- Offline OSM graph importer; see [ROUTING.md](ROUTING.md)
- SvelteKit server routes for external place search and optional map-data queries
- **Vitest**, using browser mode for component tests
- **Playwright** for critical browser flows

## PWA

- **Vite PWA** through `@vite-pwa/sveltekit`
- Generated manifest and service worker
- Precache only the application shell and static assets
- Do not cache authentication or personalized API responses

## Authentication

- **Better Auth** with database-less, stateless sessions
- Signed/encrypted `HttpOnly`, `Secure`, `SameSite` cookies; prefer JWE
- No session database or JWT integration

Stateless sessions cannot revoke one session immediately; invalidate all sessions by changing the cookie version. Add persistent storage only when synchronized user data, email/password accounts, durable roles, or individual session revocation is required.

## External services

Map tiles and place search remain external. Walking-route generation and station scoring use the local graph and do not call a routing provider.
