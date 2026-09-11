# Radiusly

A small installable web app for planning neighborhood walking loops by distance or time.

## Prototype status

Radiusly is a working prototype, not a production navigation or safety tool.

Currently implemented:

- Reusable starting points from geolocation or a map pin, stored locally in the browser.
- Routes planned by distance or time at 4, 5, or 6 km/h.
- Five route shapes: Organic, Tangent, Orbit with the same return, Orbit with a nearby return, and Spaghetti.
- Reusable walk-by spots added through place search or directly on the map.
- Multiple server-generated candidates scored by target-distance error, repeated physical path segments, longest repeated section, and repeated walking near railway stations.
- Frontend-selectable A* and Dijkstra path searches, remembered locally.
- Rejection of routes that exceed the configured backtracking limits, with additional candidate generation when needed.
- Remembered planner mode, distance, time, pace, route shape, starting point, and saved spots.
- Route summaries, "Make another route", and copyable debugging information for reporting poor routes.
- Installable PWA behavior.

Known limitations:

- Route quality is based on geometric heuristics. It does not yet score scenery, traffic, lighting, accessibility, construction, or personal safety.
- Railway-station penalties use station locations included in the local graph.
- Maps and place search use public third-party services. Route generation uses locally prepared OSM data.
- There is no cross-device sync, saved-route backend, or browser-offline routing. The routing server itself works without external routing access.
- Representative routes still need systematic field testing in different neighborhood types.

## Run locally

```bash
pnpm install
cp .env.example .env
# Fill in the GitHub OAuth credentials and generate BETTER_AUTH_SECRET:
# openssl rand -base64 32
pnpm dev
```

Configure the GitHub OAuth callback as `http://localhost:5173/api/auth/callback/github` (or `${BETTER_AUTH_URL}/api/auth/callback/github` in production). Open `http://localhost:5173`. Use HTTPS when hosting it so authentication, installation, and geolocation work securely.

### Production build

```bash
pnpm build
pnpm start
```

The Node adapter produces a persistent application server. Deploy the compiled worker and regional graph alongside the server; see [ROUTING.md](ROUTING.md).

### Tests

```bash
# Unit and integration tests
pnpm test

# E2E tests (requires production build)
pnpm test:e2e
```

### Custom in-process routing

The application uses our TypeScript walking graph with frontend-selectable A* and Dijkstra searches. Build regional OSM data before generating routes. See [ROUTING.md](ROUTING.md) for data preparation, supported access rules, runtime limits and deployment.

Routing runs in a worker thread inside the SvelteKit Node server using a local walking graph.

## Stack

- **SvelteKit** with strict TypeScript and the Node adapter
- Custom TypeScript routing in a server worker; server proxies for place search and optional map-data queries
- **Leaflet** for maps (client-side)
- **Vitest** with Playwright-backed browser mode for component tests
- **Playwright** for critical browser flows
- **@vite-pwa/sveltekit** for PWA manifest and service worker (shell-only precaching)
- **Better Auth** with GitHub OAuth and database-less JWE cookie sessions
- localStorage for client-side persistence

## Manual regression routes

- A Pankow–Blankenburg ponds loop must not use the southeastern dead-end spur. At the ponds, prefer continuing to the path end and taking the left-hand arc instead of turning back.
- The same loop must reject a long southbound spur through the S-Bahn station area that returns along the same path.
- Orbit with the same return should use the shortest practical shared stem before beginning the orbit.
- Near-zero-backtracking settings must reject long dead ends even when the total distance is close to the target.
