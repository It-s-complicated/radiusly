# Local walking router

Radiusly routes inside its SvelteKit Node process. A worker thread owns the graph and runs our TypeScript A* or Dijkstra search. There is no routing daemon, subprocess or external routing API at request time. The frontend chooses the search independently from the five route shapes and persists the choice.

## Build regional data

Use Node 24+ and Rust for the local PBF graph builder (the Docker graph image builds its own Rust toolchain):

```bash
mkdir -p data/routing
curl -fL https://download.geofabrik.de/europe/germany/brandenburg-latest.osm.pbf -o data/routing/brandenburg.osm.pbf
cargo build --locked --release --manifest-path routing-graph-rs/Cargo.toml
routing-graph-rs/target/release/routing-graph \
  data/routing/brandenburg.osm.pbf data/routing/graph.json \
  --region berlin --bounds 13.08 52.33 13.77 52.68
```

The Geofabrik Brandenburg extract includes Berlin. Bounds are **west, south, east, north** and specify allowed starting points. The importer retains ways in a further 25 km buffer, including their complete node sequences. Use an input extract large enough to contain that buffer. The server supports targets of 0.5–30 km and accepts up to 25% length error, so the buffer covers a closed walk of up to 37.5 km.

The graph contains coordinates, physical OSM segments, allowed directions, stations and source/policy hashes. The builder rejects input/output aliases and empty region names. Before publication it checks the router's coordinate and segment limits (latitude within ±85°, segments at most 20 km); invalid data fails the build without replacing the prior graph. Each build uses an exclusively created sibling temporary file, so concurrent builds safely publish complete files; the last rename wins. Failed writes or renames clean up their temporary file. The build replaces the output atomically. Restart the server after replacing a graph. Keep the prior file for rollback. PBF and compiled graph files are ignored by git. Source data: © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright); [Geofabrik source](https://download.geofabrik.de/europe/germany/brandenburg.html).

Building the graph is a one-time job, not part of `pnpm build` or route requests. The production graph container now uses the Rust PBF importer, which makes three streaming scans (relations, ways, then nodes) and retains coordinates only for referenced nodes. The Python PBF/XML importer remains available for comparison or XML fixtures:

```bash
python -m venv .venv-routing
.venv-routing/bin/pip install -r scripts/requirements-routing.txt
.venv-routing/bin/python scripts/build-walking-graph-python.py \
  data/routing/brandenburg.osm.pbf data/routing/graph-python.json \
  --region berlin --bounds 13.08 52.33 13.77 52.68
```

On this machine (Ryzen 7 7800X3D), two sequential runs of each importer against the same local Brandenburg PBF, with a warm filesystem cache, measured graph preparation **excluding** Rust compilation and the PBF download:

| Importer | Wall time (runs) | Mean wall time | Peak RSS (runs) |
| --- | --- | --- | --- |
| Python 3.13 + osmium 4.3.1 | 36.630 s, 36.679 s | 36.655 s | 1533, 1535 MiB |
| Rust release + osmpbf 0.3.8 | 14.267 s, 14.200 s | 14.234 s | 502, 502 MiB |

The Rust importer was **2.58× faster** and used about **one-third the peak memory** here. The complete 115,982,337-byte JSON outputs matched byte-for-byte except for `dataVersion`'s importer-source hash. Rust compilation, Docker image build and network download were not part of this comparison; the J4105 may differ.

### Safety-fix performance regression check

Compared the pre-fix and fixed release binaries on the same Brandenburg PBF and Berlin bounds above, using Rust 1.98.1 on the Ryzen 7 7800X3D. Each binary received a warm-up followed by five measured runs, alternating which ran first in each pair. Measurements include source hashing, import, graph validation and JSON publication, but exclude compilation and download. Both wrote separate artifacts to `/tmp` (tmpfs); the deployed graph was not replaced. Peak RSS comes from `wait4`.

| Metric (median of 5 runs) | Before fixes | After fixes | Change |
| --- | --- | --- | --- |
| Wall time | 14.724 s | 14.657 s | −0.46% |
| CPU time | 14.667 s | 14.601 s | −0.45% |
| Peak RSS | 501.090 MiB | 501.246 MiB | +0.156 MiB |

Wall-time runs were **14.732, 14.696, 15.211, 14.709, 14.724 s** before and **14.590, 14.710, 14.814, 14.657, 14.487 s** after. No measurable performance regression was observed; the small timing difference is within run-to-run variation, not evidence of a speedup. Outputs matched byte-for-byte after normalizing `dataVersion`: 2,008,219 nodes, 2,205,005 segments, 525 stations and 115,982,337 bytes.

## Run and deploy

```bash
pnpm install
cp .env.example .env
# Configure the existing GitHub authentication variables.
pnpm dev
# Production:
pnpm build
pnpm start
```

`pnpm dev` and `pnpm build` compile the worker into `.routing/`. Restart development after changing worker code. Run commands from the project root. Deploy `build/`, `.routing/`, `package.json`, production dependencies and the regional graph together. Set `ROUTING_GRAPH_PATH` for a graph outside `data/routing/graph.json`. `pnpm start` loads `.env` if present. Set `ORIGIN` to the public HTTPS origin when deploying adapter-node behind a reverse proxy.

For Coolify, use the repository `compose.yml` with the Docker Compose build pack and expose port 3000 on the `app` service. The one-shot `graph` service compiles a dated Geofabrik snapshot into a shared named volume. It skips the build only when the volume holds both the requested `OSM_DATE` and the current Rust builder binary's hash; the first Rust deployment rebuilds an existing Python graph even with the same date. The graph volume survives Docker cache pruning. The default `OSM_DATE=260901` is an archived monthly snapshot; if you previously set `OSM_DATE=260909`, replace it with an available date (`260909` returns 404). Change `OSM_DATE` (env or compose arg) to a dated snapshot available in Geofabrik's raw archive to refresh data. A cold Docker image build also compiles the Rust binary; cached dependency layers avoid recompiling dependencies when only importer source changes.

The first request loads the graph; missing or invalid graph data returns a structured 503 error. One worker admits at most four requests, including requests waiting for graph initialization. Requests have a 2,000,000-node search budget and a 10-second compute deadline. A shared cancellation flag stops work when a request is cancelled; its slot stays occupied until the worker acknowledges completion. The queue deadline is 30 seconds. This is an initial single-worker capacity policy, not autoscaling.

The real Berlin graph built during implementation contains approximately 2.01 million nodes and 2.21 million segments in 116 MB JSON. Observed standalone graph-process RSS was about 880 MiB after warm queries, excluding the rest of the SvelteKit app. Treat this as a regional prototype measurement, not a production memory ceiling.

## Search and loop behavior

A* and Dijkstra share costs, snapping, connectivity and path reconstruction. A* uses an admissible 3D chord-distance heuristic; Dijkstra uses zero. Both find minimum-cost paths for an individual leg. Previously used segments receive a 4× cost during loop construction to encourage alternatives. This does not make the whole loop globally optimal. Equal-cost alternatives and budget exhaustion can produce different loop outcomes between algorithms.

User starts/spots snap within 40 m. Movable shape anchors may snap farther, but must stay in the starting component. Spatial and connected-component indexes avoid whole-region scans. Shapes propose anchors, the router connects them, and up to twelve calibrated/rotated candidates are evaluated. Required spots are included as snapped endpoints. Repetition uses exact segment-fraction overlap, not rounded polyline vertices.

Same-return Orbit loops around the start and explicitly reverses its outbound stem. Only that return leg is exempt from repetition limits, including the station limit; the stem is bounded to 500 routed meters or a fifth of the route, whichever is larger. Debug output includes inputs, candidates, graph version, snapping and explored-node/time statistics.

## Deliberate first-version limits

- Conservative outdoor pedestrian profile. Private/unknown access, conditional access, time-controlled entrances, ambiguous pedestrian directionality and unsupported indoor/conveying links are excluded. Explicit `foot` access overrides generic access. Ordinary road `oneway` does not force pedestrians one way.
- Pedestrian restriction relations conservatively remove member ways instead of modelling turn transitions. Barrier nodes without recognized or explicit walking permission are blocked.
- No routing across pedestrian-area interiors, inferred sidewalk connections, elevation, live closures or scenery scoring. Mapped linear paths remain usable. Snapping is proximity-based and does not prove that a user standing off-network can cross an intervening fence or reach a particular entrance.
- Shape guidance is heuristic. A requested shape is not guaranteed feasible at every start/distance. Failure produces an error, never a fake completed route. The map still shows an explicitly separate geometric preview.
- Raw graph objects and a JSON artifact favor inspectability over compact storage. Larger regions need measured memory work before deployment. Weak components reject disconnected fragments but do not replace directional reachability checks.
- Map tiles and place search still use external services. Station positions used for route scoring come from the local graph.

## Checks

```bash
pnpm check
pnpm test
pnpm test:e2e
.venv-routing/bin/python scripts/test-walking-import.py
cargo test --locked --release --manifest-path routing-graph-rs/Cargo.toml
cargo build --locked --release --manifest-path routing-graph-rs/Cargo.toml
.venv-routing/bin/python scripts/test-rust-import.py
pnpm routing:benchmark
```

`test-rust-import.py` reuses the Python fixture through PBF ingestion and checks graph parity, same-file/symlink/hard-link rejection, empty regions, coordinate and segment limits, preservation of the prior graph on failure, temporary-file cleanup and concurrent CLI publication.

The benchmark loads the real graph once and exercises all five shapes with both searches. It records successful routes and expected quality failures rather than treating every requested loop as guaranteed. `routing.test.ts` checks equal path costs, directionality, disconnected components, partial-edge overlap, required spots and search cancellation. Browser tests check that selecting Dijkstra survives reload and reaches the POST endpoint.
