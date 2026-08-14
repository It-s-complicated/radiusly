# Planned Radiusly stack

**Status:** Implemented.

## Application

- **SvelteKit** with strict TypeScript
- SvelteKit server routes for external search, routing, and map-data APIs
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

Moving calls into SvelteKit does not grant permission to exceed upstream limits. Before public deployment, choose routing/geocoding providers with suitable quotas and add shared rate limiting, caching, and usage monitoring. Do not rely on the current public OSM routing endpoint for production traffic.
