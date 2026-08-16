# Radiusly

An installable web app for generating pedestrian walking loops by distance or time.

## Route generation

The browser sends one durable request to `/api/routing`: start, distance or duration, walking pace, required walk-by spots, backtracking preference, and seed. The Netlify Function owns the complete generation run.

Radiusly requests pedestrian isodistance contours from a private Valhalla service, samples seeded two- and three-anchor candidates from distinct contour sectors, and routes every intermediate anchor as a Valhalla `through` location. Each routed shape is mapped back to graph edges with `trace_attributes`. Selection uses target error, repeated edge distance, longest repeated run, immediate reversal, required-spot coverage, and pedestrian access. Major-road, steps, tunnel, and rough-surface exposure are recorded but deliberately not weighted until field evidence supports a product preference.

Each response includes the seed, generator version, graph-data version, bounded Valhalla-call usage, every candidate score component, and rejection reasons. “Make another route” changes only the seed. Copyable debugging information is sufficient to repeat the same request while the configured graph version remains available.

## Run locally

```bash
npm install
cp .env.example .env
# Fill in GitHub OAuth and private Valhalla settings.
# Generate secrets with: openssl rand -base64 32
npm run dev
```

Configure the GitHub OAuth callback as `http://localhost:5173/api/auth/callback/github` or `${BETTER_AUTH_URL}/api/auth/callback/github` in production. HTTPS is required for hosted authentication, installation, and geolocation.

Development may omit `REDIS_URL`; route limits and the five-minute graph-versioned route cache then remain in process. Production requires a Redis endpoint shared by all Netlify Function instances.

## Netlify deployment

Radiusly continues to use `@sveltejs/adapter-netlify`. Set these server-only environment variables in Netlify:

- `VALHALLA_URL`: HTTPS origin of the private Valhalla gateway.
- `VALHALLA_API_TOKEN`: bearer token shared with the gateway.
- `VALHALLA_GRAPH_VERSION`: immutable identifier written by the graph update job.
- `REDIS_URL`: managed Redis connection URL reachable from Netlify.
- Better Auth and GitHub OAuth variables from `.env.example`.

Never expose the Valhalla token through `PUBLIC_` environment variables. `/api/health` checks Valhalla, Redis, and the configured graph version without requiring an application session. Netlify latency and failure monitoring can alert on non-200 health responses and the structured `route_generation` function logs.

## Private Valhalla service

The long-lived graph service is deployed separately from Netlify on a container host:

```bash
cd ops/valhalla
cp .env.example .env
# Set a DNS name, a strong API token, the supported-region PBF URL, and capacity.
./update-graph.sh 2026-08-16-berlin
```

`update-graph.sh` builds into `data/releases/<version>`, verifies the tile archive, atomically switches `data/current`, restarts Valhalla, and waits for `/status`. A failed health check restores the previous symlink and service. Successful releases remain on disk for explicit rollback. After activation, set the printed `VALHALLA_GRAPH_VERSION` value in Netlify and redeploy the web application.

`docker compose up -d` runs only Valhalla and its Caddy gateway. Valhalla has no host port. Caddy terminates HTTPS and returns 404 unless the bearer token matches. Persistent preprocessed tiles remain under `ops/valhalla/data`, outside the container lifecycle.

For every update:

1. Choose an immutable version containing the OSM extract date and region.
2. Run the update script with the new Geofabrik PBF URL configured in `.env`.
3. Confirm `docker compose ps` reports Valhalla healthy.
4. Update `VALHALLA_GRAPH_VERSION` in Netlify and deploy.
5. Check `/api/health` and reproduce the stored regression requests.
6. Keep the prior release until representative routes pass; point `data/current` back to it and restart Valhalla for a manual rollback.

## External-service boundary

Route generation and station-specific heuristics no longer call public routing or Overpass services. Valhalla owns only graph/pathfinding operations; Radiusly owns loop generation and scoring. Leaflet map tiles and place search remain external and independently replaceable because they are not part of route generation. The web application remains on Netlify; persistent Valhalla graph tiles remain on the dedicated container host.

## Verification

```bash
npm run check
npm test
npm run build
npm run test:e2e
```

With Valhalla environment variables exported, compare the network generator and migration baseline over the checked-in nine-case matrix:

```bash
npm run validate:routes -- validation/cases.json validation/results-local.json
```

The recorded one-off benchmark in `validation/benchmark-2026-08-16.json` accepted all nine network-generator cases across dense-center, residential-grid, and park-heavy starts at 2–8 km. Selected distance error was 0.4–6.4%. The benchmark used a public Valhalla graph only for validation; production remains configured exclusively through the private server-only URL and token.

The route endpoint is limited to twelve Valhalla calls, three concurrent upstream calls, two active generation runs per warm Function instance, an 18-second total budget, and ten requests per authenticated user per minute through shared Redis. Successful responses are cached for five minutes with the graph version in the key.

## Manual regression routes

Captured debugging information must preserve these cases as exact start, target, required spots, preference, seed, generator version, graph version, scores, and rejection reasons:

- Pankow–Blankenburg ponds: avoid the southeastern dead-end spur and prefer the left-hand arc after the path end.
- Pankow station area: reject the long southbound station spur that returns over the same path.
- Shared-stem loops: use the shortest practical shared stem before beginning the loop.
- Near-zero-backtracking requests: reject a long dead end even when total distance is close to target.

Field ratings cover safety, interest, variety, and willingness to use Radiusly again. They must be gathered by walking representative accepted routes; automated routing output is not a substitute for those observations.

## Stack

- SvelteKit with the Netlify adapter and server-side route orchestration
- private Valhalla pedestrian routing and graph-edge tracing
- managed Redis for shared rate limits and graph-versioned caching
- Leaflet, Better Auth with GitHub OAuth, Vitest, Playwright, and Vite PWA
- localStorage for reusable user points and planner preferences
