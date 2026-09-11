# Local walking router

Radiusly routes inside its SvelteKit Node process. A worker thread owns the graph and runs our TypeScript A* or Dijkstra search. There is no routing daemon, subprocess or external routing API at request time. The frontend chooses the search independently from the five route shapes and persists the choice.

## Build regional data

Use Node 24+ and Python 3 with the offline OSM parser:

```bash
python -m venv .venv-routing
.venv-routing/bin/pip install -r scripts/requirements-routing.txt
mkdir -p data/routing
curl -fL https://download.geofabrik.de/europe/germany/brandenburg-latest.osm.pbf -o data/routing/brandenburg.osm.pbf
.venv-routing/bin/python scripts/build-walking-graph.py \
  data/routing/brandenburg.osm.pbf data/routing/graph.json \
  --region berlin --bounds 13.08 52.33 13.77 52.68
```

The Geofabrik Brandenburg extract includes Berlin. Bounds are **west, south, east, north** and specify allowed starting points. The importer retains ways in a further 25 km buffer, including their complete node sequences. Use an input extract large enough to contain that buffer. The server supports targets of 0.5–30 km and accepts up to 25% length error, so the buffer covers a closed walk of up to 37.5 km.

The graph contains coordinates, physical OSM segments, allowed directions, stations and source/policy hashes. The build replaces the output atomically. Restart the server after replacing a graph. Keep the prior file for rollback. PBF and compiled graph files are ignored by git. Source data: © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright); [Geofabrik source](https://download.geofabrik.de/europe/germany/brandenburg.html).

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

For Coolify, use the repository `compose.yml` with the Docker Compose build pack and expose port 3000 on the `app` service. The one-shot `graph` service compiles a dated Geofabrik snapshot into a shared named volume; it skips the build when the volume already holds the requested `OSM_DATE`, so compilation runs only on the first deploy or a date change and survives Docker cache pruning. To refresh the map data, change `OSM_DATE` (env or compose arg) to a dated snapshot available in Geofabrik's raw archive. Deleting the volume or restoring to a new server triggers one rebuild.

The first request loads the graph; missing or invalid graph data returns a structured 503 error. One worker admits at most four requests, including requests waiting for graph initialization. Requests have a 2,000,000-node search budget and a 10-second compute deadline. A shared cancellation flag stops work when a request is cancelled; its slot stays occupied until the worker acknowledges completion. The queue deadline is 30 seconds. This is an initial single-worker capacity policy, not autoscaling.

The real Berlin graph built during implementation contains approximately 2.01 million nodes and 2.21 million segments in 116 MB JSON. Observed standalone graph-process RSS was about 880 MiB after warm queries, excluding the rest of the SvelteKit app. Treat this as a regional prototype measurement, not a production memory ceiling.

## Search and loop behavior

A* and Dijkstra share costs, snapping, connectivity and path reconstruction. A* uses an admissible 3D chord-distance heuristic; Dijkstra uses zero. Both find minimum-cost paths for an individual leg. Previously used segments receive a 4× cost during loop construction to encourage alternatives. This does not make the whole loop globally optimal. Equal-cost alternatives and budget exhaustion can produce different loop outcomes between algorithms.

User starts/spots snap within 40 m. Movable shape anchors may snap farther, but must stay in the starting component. Spatial and connected-component indexes avoid whole-region scans. Shapes propose anchors, the router connects them, and up to twelve calibrated/rotated candidates are evaluated. Required spots are included as snapped endpoints. Repetition uses exact segment-fraction overlap, not rounded polyline vertices.

Same-return Orbit explicitly reverses its outbound stem. Only that return leg is exempt from accidental-repetition limits; the stem is bounded to 500 routed meters. Near stations, proposals use a shorter stem to retain the 100 m station-repetition limit. Debug output includes inputs, candidates, graph version, snapping and explored-node/time statistics.

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
pnpm routing:benchmark
```

The benchmark loads the real graph once and exercises all five shapes with both searches. It records successful routes and expected quality failures rather than treating every requested loop as guaranteed. `routing.test.ts` checks equal path costs, directionality, disconnected components, partial-edge overlap, required spots and search cancellation. Browser tests check that selecting Dijkstra survives reload and reaches the POST endpoint.

The implementation benchmark accepted 24 of 30 requests across Alexanderplatz, Pankow and Tiergarten (4 km, five shapes, both algorithms). Both searches succeeded for every shape at Alexanderplatz and Tiergarten; Organic, Orbit-near and Spaghetti failed quality limits at Pankow. This is a feasibility sample, not a comprehensive quality or latency evaluation.

### Profile the Python importer locally

Use the `.venv-routing` environment from the data-build instructions above (Python 3.13 matches the graph container). Python's built-in profiler needs no additional dependencies. Write a separate graph so profiling does not replace the server's data:

```bash
.venv-routing/bin/python scripts/test-walking-import.py
.venv-routing/bin/python -m cProfile -o data/routing/import.prof \
  scripts/build-walking-graph.py \
  data/routing/brandenburg.osm.pbf data/routing/graph-profile.json \
  --region berlin --bounds 13.08 52.33 13.77 52.68
.venv-routing/bin/python -c "import pstats; pstats.Stats('data/routing/import.prof').strip_dirs().sort_stats('cumulative').print_stats(25)"
```

Profiling adds overhead; compare elapsed build times without `cProfile` when measuring speedups. Keep the input, bounds, Python version and machine the same between runs. Importer source changes intentionally change `dataVersion`, even when graph contents are equivalent.

For phase timings and peak process RSS on Linux, use the benchmark harness. It refuses to overwrite an existing output:

```bash
.venv-routing/bin/python scripts/benchmark-import.py \
  data/routing/brandenburg.osm.pbf data/routing/benchmark-import-new.json
# Optional: --profile data/routing/benchmark-import-new.prof
# Compare a saved importer: --importer data/routing/build-before.py
# Compare the old streaming JSON encoder: --json dump (default: dumps)
```

It measures hashing, the station-relation pass, the main entity pass (including native parsing/location indexing and Python callbacks), graph assembly, and JSON encoding/writing. Use unprofiled runs for end-to-end comparisons; `cProfile` helps identify Python call hotspots but does not fully attribute native work. Run variants sequentially against the same source, and repeat close results. JSON timings include file close but not `fsync`, so they measure buffered writes, not durable disk throughput. Compare full output content, allowing only the intentional `dataVersion` difference; counts alone do not establish correctness.

Local measurement on 2026-09-11 with Python 3.13.13, osmium 4.3.1 and source hash `706dc3b68a41c23b`: the optimized build took **244.54 seconds (4m 4.5s)** versus **275.16 seconds (4m 35.2s)** before the changes, about **11% less elapsed time**. These are single sequential runs without profiling, including hashing, import, graph construction and JSON output, excluding download. Peak RSS was approximately 1.35 GiB for both. The graphs matched exactly except for `dataVersion`: 2,008,219 nodes, 2,205,005 segments and 525 stations. Treat these as local measurements, not deployment guarantees.

### Native-filter and JSON measurements

A subsequent controlled comparison on 2026-09-11, using the same Python, osmium and input versions, identified entity import as the main bottleneck. These are single sequential, unprofiled builds; the JSON-only comparison below used three runs per encoder.

| Variant | Entity pass | Graph assembly | JSON output | Total | Peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| Starting importer (`90999bd9ca65`) | 231.04 s | 4.45 s | 5.21 s | 241.48 s | 1.36 GiB |
| Python early return for irrelevant untagged nodes | 97.21 s | 4.55 s | 5.14 s | 107.67 s | 1.36 GiB |
| Native empty-tag node filter | 65.42 s | 4.62 s | 5.14 s | 75.95 s | 1.36 GiB |
| Native relevant-key node filter + `json.dumps` (`b312fe99d1a2`) | 49.19 s | 4.55 s | 1.29 s | **55.79 s** | 1.50 GiB |

Hashing took about 0.17 s and the station-relation pass about 0.60 s in each run. The final build used **77% less elapsed time (4.3× faster)**. All three candidate artifacts matched the starting artifact byte-for-byte after replacing only `dataVersion`; counts remained 2,008,219 nodes, 2,205,005 segments and 525 stations. Measurements exclude download, interpreter startup and shutdown, and do not predict deployment-host timing.

The native location handler still sees every node before filtering. Only nodes with access, barrier or railway keys cross into the Python callback. Station-relation node members, including untagged members, are recovered from the same native location index. Fixture checks cover every access-filter key, untagged way geometry, untagged/name-only station members, missing members, and mixed node/way station relations.

On the same in-memory graph, alternating `dump` and `dumps` for three writes each gave medians of **4.84 s** and **1.23 s**, with identical SHA-256 output hashes. Python 3.13's `dumps` uses its C encoder; `dump` uses the Python streaming encoder. The whole-string encoding increases full-build peak RSS by approximately **139 MiB**. No additional dependency is required; strict finite-number encoding and atomic production-file replacement are retained.

The updated profile (`data/routing/perf-final.prof`, ignored by git) reduced `access()` calls from 28,072,411 to 1,435,726 and tag-iteration calls from 31,592,834 to 4,956,149. There are still 4,483,001 way-policy evaluations. The next investigation should focus on the remaining entity pass (49.19 s unprofiled), separating way/tag processing from native decoding/indexing before choosing another optimization. The profiled run took 84.31 s and produced the exact same file as the unprofiled final run; that slower timing illustrates why profiler timings are not speedup measurements.
