# Stacked PR plan for route-generation service adoption

## Decision

Split the current route-generation work into two stacked PRs:

1. **PR 1: route-generation service foundation** — add a complete, executable Valhalla generator, comparison harness, and deployment tooling without changing the running application or requiring new production infrastructure.
2. **PR 2: product cutover** — build on PR 1, connect the application to the new server endpoint, add runtime hardening, and remove the public OSRM and user-facing legacy route-shape stack.

PR 1 must be independently safe to merge. Existing route generation, UI, persisted preferences, Netlify deployment, and required environment variables remain unchanged until PR 2.

PR 2 should use PR 1 as its base branch. After PR 1 merges, retarget PR 2 to `main`.

## Why this boundary

The generator, Valhalla adapter, edge scorer, validation CLI, and container deployment form one executable vertical slice: the CLI consumes the new generator against a configured Valhalla service. This is meaningful groundwork without introducing dormant production code.

The endpoint, browser migration, Redis runtime controls, UI cleanup, and old-router deletion form the second vertical slice. They change production behavior and therefore belong behind the infrastructure and validation delivered by PR 1.

Do not split the current work only by file. Several files currently mix foundation and cutover concerns, especially `src/lib/types.ts`, `src/lib/route/scoring.ts`, `package.json`, `README.md`, tests, and this plan. Reconstruct PR 1 from the pre-work base, then create PR 2 from PR 1.

---

# PR 1: Route-generation service foundation

## Suggested title

`Add a validated route-generation service foundation`

## Goal

Introduce and validate the new network-aware generator, Valhalla adapter, graph-edge scoring, comparison harness, and private-service operations without changing the current browser flow or production route provider.

The validation CLI is the first real consumer of the new implementation. The application continues using its existing route generation until PR 2.

## Contracts

Add a focused contract module instead of replacing the current product types:

- `src/lib/route/contracts.ts`
- `RouteGenerationRequest`
- `RouteGenerationResponse`
- `RouteResult`
- `RouteDebug`
- `RouteCandidateMetadata`
- `RouteScoreComponents`
- `CandidateDebug`
- `RoutedEdge`
- required-spot and route-preference types

The durable request contains:

- start coordinates
- distance or duration target
- walking pace
- required walk-by spots
- route preferences
- reproducible seed

The response records:

- selected route and geometry
- seed
- generator version
- Valhalla graph-data version
- candidate metadata
- separate score components
- rejection reasons
- Valhalla request-budget usage

Keep the existing `Algorithm`, `InternalAlgorithm`, legacy `RouteResult`, and related product types intact in PR 1.

## New generator and scorer

Add:

- `src/lib/server/valhalla.ts`
- `src/lib/server/route-generation.ts`
- `src/lib/route/edge-scoring.ts`
- `src/lib/server/legacy-baseline.ts`

The Valhalla adapter must:

- remain server-only
- normalize `/isochrone`, `/route`, `/trace_attributes`, and `/status`
- send intermediate locations as `through`
- request OSRM-compatible GeoJSON route output
- use `walk_or_snap` for tracing routed shapes
- normalize graph edges using edge IDs, OSM way IDs, OSM node IDs, length, and traversal direction
- keep Valhalla wire formats out of generator and UI code
- apply per-call timeouts, maximum concurrency, and a total call budget supplied by its caller

The network-aware generator must:

- request pedestrian isodistance contours around the start
- sample anchors from distinct contour sectors
- generate deterministic two- and three-anchor candidates
- vary contour distance, angular separation, direction, and seed
- include required spots in traversal order
- route anchors and required spots as `through` locations
- adapt contour distance from actual routed-distance feedback
- produce candidate rejection reasons and separate scoring components
- stay within twelve Valhalla calls for a normal generation run

The edge scorer must record and enforce:

- target-distance error
- total repeated edge distance
- repeat ratio
- longest repeated run
- immediate reversal distance
- required-spot coverage
- unsuitable pedestrian access

It must also record, but not weight without field evidence:

- major-road exposure
- steps
- tunnels
- rough surfaces

The legacy baseline must:

- remain server-only
- preserve Organic, Tangent, both Orbit variants, and Spaghetti only for comparison
- derive its bearing deterministically from the same seed
- route every legacy candidate through the same Valhalla graph
- score legacy and network candidates with the same edge scorer
- never appear in the durable server contract or UI

## Validation tooling

Add:

- `scripts/validate-routes.ts`
- `validation/cases.json`
- `validation/benchmark-2026-08-16.json`
- `validate:routes` package script
- `tsx` as a development dependency

The validation command should be:

```bash
npm run validate:routes -- validation/cases.json validation/results-local.json
```

It requires:

- `VALHALLA_URL`
- `VALHALLA_API_TOKEN`
- `VALHALLA_GRAPH_VERSION`

The checked-in matrix covers several distances in:

- a dense center
- a residential grid
- a disconnected or park-heavy area

For every case, record:

- requested target
- routed distance
- repeated edges
- longest repeated run
- generator version
- graph-data version
- seed
- candidate rejection reasons
- accepted legacy candidate count

The existing one-off public-Valhalla benchmark is validation evidence only. Production must never depend on that public service.

## Private Valhalla operations

Add:

- `ops/valhalla/compose.yaml`
- `ops/valhalla/Caddyfile`
- `ops/valhalla/update-graph.sh`
- `ops/valhalla/.env.example`
- graph-data ignore rules

The deployment must provide:

- a digest-pinned Valhalla container image
- persistent graph releases outside the container lifecycle
- no direct public Valhalla port
- a Caddy HTTPS gateway protected by a bearer token
- a configurable supported-region PBF URL
- graph building into `data/releases/<version>`
- atomic `data/current` activation
- `/status` health verification
- automatic rollback to the prior graph if the new release fails health checks
- preservation of prior releases for explicit rollback

Keep the SvelteKit Netlify adapter. Valhalla is deployed separately on a long-lived container host.

## Supporting improvements

Include:

- a Netlify-compatible Playwright preview command using `vite preview`
- optional Valhalla variables in environment documentation
- generator, adapter, scoring, determinism, calibration, and request-budget tests
- operational documentation for graph imports and updates
- validation documentation

Do not require Valhalla or Redis for the existing application in PR 1.

## Explicit exclusions

PR 1 must not:

- replace the existing `/api/routing` behavior
- remove the public OSRM route provider
- remove the station proxy
- change `src/routes/+page.svelte`
- change the browser route orchestration
- remove route-shape controls
- remove the persisted algorithm preference
- remove approximate fallback behavior
- delete `src/lib/route/shapes.ts`
- delete old coordinate-based scoring
- require Valhalla for development, Netlify previews, or production
- add Redis as a production dependency
- change the production health contract

## Acceptance criteria

- [ ] Existing route behavior and UI are unchanged.
- [ ] Existing deployments require no new environment variables.
- [ ] The validation CLI exercises the complete network generator against a configured Valhalla instance.
- [ ] Legacy and network candidates use identical starts, targets, preferences, seeds, graph data, and scoring.
- [ ] The same request, seed, generator version, and graph version reproduce the same candidate anchors.
- [ ] Valhalla wire formats remain confined to the server adapter.
- [ ] A normal network generation run stays within twelve Valhalla calls.
- [ ] Unit tests cover tracing, scoring, hard rejection, through locations, calibration, and determinism.
- [ ] `npm test` passes.
- [ ] `npm run check` passes without errors or warnings.
- [ ] `npm run build` passes with `@sveltejs/adapter-netlify`.
- [ ] Existing Playwright tests pass.
- [ ] `docker compose config --quiet` passes in `ops/valhalla`.
- [ ] `sh -n ops/valhalla/update-graph.sh` passes.

## Suggested commits

1. `Add route-generation contracts and edge scoring`
2. `Add Valhalla adapter and network-aware generator`
3. `Add legacy comparison and validation matrix`
4. `Add private Valhalla deployment tooling`
5. `Document and verify the route-service foundation`

---

# Operational prerequisite between PRs

PR 2 can be developed as a stacked branch immediately, but it must not merge until the infrastructure exists.

Before merging PR 2:

1. Deploy the private Valhalla service.
2. Point the configured DNS name at the container host.
3. Build and activate the supported-region graph.
4. Provision managed Redis reachable from Netlify.
5. Run the nine-case comparison against the private graph.
6. Confirm representative regression requests remain reproducible.
7. Configure branch-scoped Netlify environment variables:
   - `VALHALLA_URL`
   - `VALHALLA_API_TOKEN`
   - `VALHALLA_GRAPH_VERSION`
   - `REDIS_URL`
8. Confirm the PR 2 Netlify deploy preview can reach Valhalla and Redis.

---

# PR 2: Product cutover to Valhalla

## Suggested title

`Move Radiusly route generation behind the Valhalla service`

## Base branch

Use PR 1 as the base until PR 1 merges. Retarget PR 2 to `main` afterward.

## Goal

Connect the validated generator to the application, make one browser request own a bounded server-side generation run, add production runtime controls, and remove the public OSRM and user-facing legacy shape stack in one clean cutover.

## Server endpoint

Replace `/api/routing` with authenticated `POST /api/routing`.

The endpoint must:

- accept only the durable request contract
- validate coordinates, target, pace, required-spot count, preference, and seed
- derive target kilometers server-side
- create a total request timeout
- create a Valhalla client with a maximum call count and upstream concurrency
- own all candidate orchestration
- return the selected route and complete debug record
- return structured error codes for invalid input, capacity, rate limits, quality rejection, upstream failure, timeout, and server configuration
- never expose the Valhalla token or raw wire format

## Runtime hardening

Add:

- `src/lib/server/route-runtime.ts`
- shared Redis rate limiting
- graph-versioned route caching
- bounded active generation runs per warm Netlify Function instance
- structured route-generation logs
- public `/api/health`

Runtime requirements:

- ten route requests per authenticated user per minute
- atomic Redis rate-window updates
- five-minute successful-route cache
- graph version included in every cache key
- two active generation runs per warm function instance
- three concurrent Valhalla calls per generation
- twelve maximum Valhalla calls per generation
- explicit total and per-call timeouts
- production requires `REDIS_URL`
- development may use in-memory rate limiting and caching

The health endpoint checks:

- Valhalla configuration
- token-authenticated Valhalla `/status`
- configured graph-data version
- Redis connectivity

It remains unauthenticated so Netlify and external monitors can call it.

## Browser integration

Replace browser-side orchestration in `src/lib/route/api.ts` with one JSON POST.

Update `src/routes/+page.svelte` to send:

- start
- entered distance or duration target
- walking pace
- selected walk-by spots
- backtracking preference
- a new reproducible seed

The browser must:

- draw only the server-selected route
- store the server-provided debug record
- generate a new seed for “Make another route”
- show actionable messages for quality rejection, rate limiting, and upstream failure
- never call Valhalla directly
- never orchestrate candidates
- never draw a geometric fallback as if it were a routed walk

## UI and persistence cleanup

Update:

- `src/lib/components/RouteOptions.svelte`
- `src/lib/components/RouteSummary.svelte`
- `src/lib/stores/preferences.ts`
- `src/routes/+page.svelte`
- `src/app.css`

Remove:

- route-shape controls
- algorithm imports and store values
- persisted algorithm identifiers and migrations
- shape preview generation
- shape-specific copy and error messages
- obsolete shape CSS

Display route duration and repeat ratio from the structured server response.

## Clean production cutover

Delete or replace:

- `src/lib/route/shapes.ts`
- old browser candidate orchestration
- coordinate-bucket repetition scoring
- public OSRM proxy behavior
- `/api/stations`
- public station penalties in route generation
- obsolete shape documentation
- obsolete shape and proxy tests
- algorithm types from the permanent product contract

Keep `src/lib/server/legacy-baseline.ts` temporarily. It is an internal validation tool, not a fallback, product option, public API, persisted identifier, or scoring exception.

## Dependencies and configuration

- Add `redis` as a production dependency.
- Keep `@sveltejs/adapter-netlify` unchanged.
- Make these server-only variables required for route generation:
  - `VALHALLA_URL`
  - `VALHALLA_API_TOKEN`
  - `VALHALLA_GRAPH_VERSION`
  - `REDIS_URL` in production
- Never use `PUBLIC_` prefixes for routing credentials.
- Update README deployment and health-check instructions.

## Tests

Update unit, component, and E2E coverage for:

- the durable browser request body
- one browser request per generated route
- new seed generation
- selected route rendering
- structured debugging information
- removal of route-shape controls
- absence of fake fallback routes
- upstream and quality failures
- graph-edge scoring
- hard rejection rules
- route request budgets
- health endpoint authentication exception
- API authentication for route generation

The Playwright server command must remain compatible with the Netlify adapter:

```text
npm run build && npm run preview -- --host 127.0.0.1 --port 4173
```

A non-authenticated local-development bypass is unnecessary while the Better Auth test setup works. If a bypass is added later, it must require an explicit development-only environment flag and must be impossible to enable in production accidentally.

## Acceptance criteria

- [ ] One browser request triggers one bounded server-side generation run.
- [ ] The browser never communicates directly with Valhalla.
- [ ] No public OSRM or Overpass station request occurs during route generation.
- [ ] Intermediate anchors and required spots use Valhalla `through` locations.
- [ ] Debugging output contains the seed, generator version, graph version, candidate scores, rejection reasons, and request-budget use.
- [ ] The same request can be reproduced while its graph version remains available.
- [ ] Rejected candidates retain explicit reasons.
- [ ] Cached routes include the graph version in the key.
- [ ] Missing production Redis or Valhalla configuration fails explicitly.
- [ ] Upstream failures do not draw fake routes.
- [ ] Route-shape controls and persisted identifiers are absent.
- [ ] The Netlify adapter remains installed and configured.
- [ ] The private Valhalla graph works end to end from a Netlify deploy preview.
- [ ] `/api/health` returns `status: "ok"` in the configured deployment.
- [ ] `npm test` passes.
- [ ] `npm run check` passes without errors or warnings.
- [ ] `npm run build` passes.
- [ ] `npm run test:e2e` passes.

## Suggested commits

1. `Add bounded route-generation endpoint and runtime guards`
2. `Move the browser to the durable route contract`
3. `Remove the public OSRM and product-shape stack`
4. `Add health checks and deployment configuration`
5. `Update route generation tests and documentation`

---

# Evidence-gated work after PR 2

Do not force these items into either PR:

- physically walk representative accepted routes
- rate safety, interest, variety, and willingness to use Radiusly again
- delete `src/lib/server/legacy-baseline.ts`
- introduce balanced, easier, greener, or exploratory preferences
- add soft scoring penalties based only on plausible OSM attributes

Delete the internal legacy baseline only after walked-route evidence confirms that the network generator is better. Add user-facing preferences only when captured failures and available OSM attributes justify concrete behavior.

# Restacking procedure

1. Identify the commit immediately before the current Valhalla work.
2. Create the PR 1 branch from that commit.
3. Reconstruct PR 1 using only the foundation scope above.
4. Verify PR 1 independently with no Valhalla or Redis requirement for the application.
5. Create the PR 2 branch from the completed PR 1 branch.
6. Apply the endpoint, runtime, browser, UI, persistence, dependency, and deletion changes to PR 2.
7. Open PR 1 against `main`.
8. Open PR 2 against the PR 1 branch.
9. After PR 1 merges, rebase or retarget PR 2 to `main`.
10. Merge PR 2 only after the private Valhalla, Redis, Netlify variables, health check, and private-graph validation are ready.
