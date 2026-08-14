# Radiusly

A small installable web app for planning neighborhood walking loops by distance or time.

## Prototype status

Radiusly is a working prototype, not a production navigation or safety tool.

Currently implemented:

- Reusable starting points from geolocation or a map pin, stored locally in the browser.
- Routes planned by distance or time at 4, 5, or 6 km/h.
- Five route shapes: Organic, Tangent, Orbit with the same return, Orbit with a nearby return, and Spaghetti.
- Reusable walk-by spots added through place search or directly on the map.
- Multiple route candidates scored by target-distance error, total repeated path, longest repeated section, and repeated walking near railway stations.
- Rejection of routes that exceed the configured backtracking limits, with additional candidate generation when needed.
- Remembered planner mode, distance, time, pace, route shape, starting point, and saved spots.
- Route summaries, "Make another route", and copyable debugging information for reporting poor routes.
- Installable PWA behavior.

Known limitations:

- Route quality is based on geometric heuristics. It does not yet score scenery, traffic, lighting, accessibility, construction, or personal safety.
- Railway-station penalties depend on an optional OpenStreetMap lookup and are skipped when that lookup is unavailable.
- Maps, place search, station lookup, and pedestrian routing use public third-party services and require an internet connection.
- There is no cross-device sync, saved-route backend, or offline routing.
- Representative routes still need systematic field testing in different neighborhood types.

## Run locally

```bash
npm install
cp .env.example .env
# Fill in the GitHub OAuth credentials and generate BETTER_AUTH_SECRET:
# openssl rand -base64 32
npm run dev
```

Configure the GitHub OAuth callback as `http://localhost:5173/api/auth/callback/github` (or `${BETTER_AUTH_URL}/api/auth/callback/github` in production). Open `http://localhost:5173`. Use HTTPS when hosting it so authentication, installation, and geolocation work securely.

### Production build

```bash
npm run build
PORT=4173 npm run preview
```

The node adapter serves the page and the `/api` proxy routes from `build/`.
Open `http://localhost:4173`.

### Tests

```bash
# Unit and integration tests
npm test

# E2E tests (requires production build)
npm run test:e2e
```

## Stack

- **SvelteKit** with strict TypeScript, node adapter (server routes at runtime)
- Server routes proxy external search, routing, and map-data APIs
- **Leaflet** for maps (client-side)
- **Vitest** with Playwright-backed browser mode for component tests
- **Playwright** for critical browser flows
- **@vite-pwa/sveltekit** for PWA manifest and service worker (shell-only precaching)
- **Better Auth** with GitHub OAuth and database-less JWE cookie sessions
- localStorage for client-side persistence

See [TECH_STACK.md](TECH_STACK.md) for the stack reference.

## Route algorithms

See [ROUTE_ALGORITHMS.md](ROUTE_ALGORITHMS.md) for shape behavior and tuning, and [PLAN.md](PLAN.md) for validation and product decisions.

## Manual regression routes

- A Pankow–Blankenburg ponds loop must not use the southeastern dead-end spur. At the ponds, prefer continuing to the path end and taking the left-hand arc instead of turning back.
- The same loop must reject a long southbound spur through the S-Bahn station area that returns along the same path.
