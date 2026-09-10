# Self-hosted routing for Radiusly — decision

## 1. TL;DR recommendation

Switch the dynamic SvelteKit deployment to `@sveltejs/adapter-node` on a 4-vCPU/4-GB VPS and run native Valhalla beside it over a private Docker network, using a persistent graph built from a buffered city-region Geofabrik extract. Keep `src/lib/server/valhalla.ts`, point it at `http://valhalla:8002`, make authentication optional, and preserve the current request budget and bounded concurrency. Start with a one-time graph build, then add weekly or monthly blue/green rebuilds after the routing cutover is proven.

## 2. Comparison

Latency estimates are for a warm, city-scale deployment and one generate click involving 5–30 routing operations. Approaches without a production-quality contour or edge-attribute implementation are marked incomplete rather than credited with artificially low latency.

| Approach | Latency per generate click | Ops burden | Fits current Netlify serverless deploy? | Data freshness | Engineering effort |
|---|---|---:|---|---|---:|
| **Native Valhalla sidecar — recommended** | Usually **subsecond to ~2 s** with bounded parallelism; representative routes ~59 ms and isodistance ~0.37–0.72 s | Medium: Node service, Valhalla container, graph volume, monitoring | **No.** Move dynamic SvelteKit backend to `adapter-node`; static assets may still use a CDN | As fresh as graph rebuild; weekly/monthly is straightforward | **2–4 days MVP**, another 2–4 for hardening |
| **Other native sidecars** | OSRM routes can be <100 ms per batch but contour support is missing; GraphHopper roughly **1.5–several seconds**; BRouter roughly **2–13+ seconds** and no contours | Medium–high | **No.** Requires persistent engine and graph | Weekly/monthly rebuild | GraphHopper 5–10 days; BRouter 7–14; OSRM contours could add weeks |
| **In-process Node: WASM, JS libraries, or custom TS graph** | WASM unbenchmarked; Osmix Berlin route-only workload roughly **1–6 s serially** with bad tails; custom typed-array target **0.1–3 s route-only**, plus contour and edge work | High engineering ownership; medium runtime ops | **No for production.** A tiny graph is theoretically packageable, but cold starts and duplicated memory make Functions the wrong architecture | Weekly/monthly custom rebuild | **15–30+ days production-quality** |
| **pgRouting/PostGIS** | Plausibly **subsecond to low-single-digit seconds** only after snapping, routes, and distance searches are batched | High: stateful DB, pools, backups, vacuuming, topology rebuilds | **No.** Remote DB access from ephemeral Functions is possible but operationally poor | Weekly/monthly blue/green import | **8–15 days** |
| **Precomputed contours + contracted graph** | Potentially **0.1–0.5 s** warm; contour lookup usually <10 ms | High offline-pipeline and artifact burden | **No** for backend routing. Browser execution could retain Netlify but violates the requirement | Entire graph and contour grid become stale until rebuilt | **16–28 days** |

**Serverless conclusion:** nominal Lambda memory limits do not make these designs suitable for Netlify. Ephemeral execution, uncertain instance reuse, graph cold loads, duplicated RAM, filesystem packaging, and synchronous CPU work are fundamental mismatches ([Netlify Functions](https://docs.netlify.com/build/functions/overview/), [adapter-netlify](https://svelte.dev/docs/kit/adapter-netlify)). The honest deployment answer is **adapter-node on a VPS**.

## 3. Per-approach summary

### A. Native routing-engine sidecar

- **Valhalla matches the application rather than merely supplying shortest-path primitives.** It supports pedestrian multipoint [`/route`](https://valhalla.github.io/valhalla/api/route/api-reference/) and distance-based polygon [`/isochrone`](https://valhalla.github.io/valhalla/api/isochrone/) requests, and preserves the edge tracing used by Radiusly’s quality scoring.
- It can run privately beside SvelteKit under Docker Compose or systemd. `adapter-node` provides the necessary persistent Node process; spawning Valhalla from Node would only create brittle lifecycle coupling ([adapter-node](https://svelte.dev/docs/kit/adapter-node), [Valhalla Docker deployment](https://github.com/valhalla/valhalla/blob/master/docker/README.md)).
- City-scale operation is realistic: the reported Berlin graph was about 163 MB; four Valhalla workers used roughly 428 MB idle and up to around 0.9 GB under stress. Provision **2 vCPU/2 GB minimum**, preferably **4 vCPU/4 GB**.
- OSRM has exceptional route throughput but [no isochrone API](https://project-osrm.org/docs/v5.24.0/api/). GraphHopper provides distance isochrones but needs substantially more JVM memory and performed worse under contour bursts; BRouter lacks contour polygons and queues badly with its default worker setup.
- A Geofabrik PBF can be acquired once and processed locally, eliminating all runtime external routing dependencies. Valhalla is MIT licensed; OSM attribution and ODbL obligations still apply ([OSM attribution guidance](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)).

**Verdict: 9/10.** Lowest application change, best functional match, and lowest technical risk.

### B. In-process Node routing — merged assessment

- There is no mature official WASM build of OSRM, GraphHopper, or BRouter. The two Valhalla WASM packages are pre-1.0 prototypes; the better one is browser-worker/OPFS-oriented and exposes only `route()`, not Radiusly’s isodistance or trace-attribute operations ([OSRM WASM decision](https://github.com/Project-OSRM/osrm-backend/issues/6525), [valhalla-wasm](https://github.com/ecc521/valhalla-wasm)).
- Pure JS/TS libraries do not close the gap: [Osmix routing is experimental](https://github.com/conveyal/osmix/tree/main/packages/router), Planner.js is stale and defaults to external tile/profile services, and [geojson-path-finder](https://github.com/perliedman/geojson-path-finder) is a graph primitive for smaller prebuilt networks rather than an OSM pedestrian engine.
- The Osmix Berlin experiment reached roughly **1.73 GB RSS**, 206 ms median A*, and 959 ms p95. For 5–30 synchronous searches, promises do not provide CPU parallelism; worker threads either require shared typed arrays or duplicate significant memory.
- The only credible same-process design is a custom pedestrian-only binary graph: offline OSM compiler, typed-array CSR graph, spatial edge snapping, A*, bounded Dijkstra, and grid-derived contours. A Hamburg-sized graph was estimated at 25–80 MB on disk and 100–250 MB process RSS, but Radiusly would own pedestrian access semantics, barriers, restrictions, contour correctness, and edge metadata.
- Expect **15–25 days** for a defensible custom implementation and more for parity testing. A WASM fork would also require C++/Emscripten maintenance, isochrone and trace bindings, Node filesystem support, worker pooling, and repeated upgrade work.

**Verdict:** custom TS graph **6/10 if same-process execution is mandatory**; existing WASM and npm-library options **2–3/10**. None is preferable to native Valhalla.

### C. pgRouting/PostGIS

- [`pgr_withPoints`](https://docs.pgrouting.org/latest/en/pgr_withPoints.html) can snap arbitrary waypoints into a graph and batch candidate legs; [`pgr_withPointsDD`](https://docs.pgrouting.org/latest/en/pgr_withPointsDD.html) can perform the distance search.
- It does not produce a Valhalla-equivalent contour directly. `ST_ConcaveHull` over reachable nodes is approximate and can behave incorrectly around rivers, holes, sparse networks, and disconnected components.
- `osm2pgrouting` is not pedestrian-correct out of the box: its pedestrian configuration is mainly a highway-class filter, while relevant access logic is disabled and generic vehicle `oneway` handling remains active ([configuration](https://github.com/pgRouting/osm2pgrouting/blob/main/mapconfig_for_pedestrian.xml), [implementation](https://github.com/pgRouting/osm2pgrouting/blob/main/src/osm_elements/Way.cpp)).
- Performance depends on spatially restricted Edge SQL and batching. The intended shape is one snapping query, one combinations route query, and one maximum-distance query—not 5–30 database round trips ([performance guidance](https://docs.pgrouting.org/latest/en/pgRouting-concepts.html#performance-tips)).
- It introduces PostgreSQL, PostGIS, connection management, backups, topology consistency, and update operations solely for routing.

**Verdict: 5/10.** Sound technology, but a heavier and less pedestrian-complete replacement for an engine Radiusly already speaks.

### D. Precomputed contours and contracted graph

- A contracted graph can serve route legs extremely quickly; [`contraction-hierarchy-js`](https://github.com/royhobbstn/contraction-hierarchy-js) reports sub-millisecond core searches, though snapping and geometry reconstruction make **1–10 ms per leg** a safer prototype target.
- Precomputed contour lookup is cheap, but nearest-grid approximation can be materially wrong around bridges, waterways, railways, and limited crossings. A 250 m grid can displace the effective origin by as much as about 177 m.
- Fine grids grow storage and preprocessing rapidly: a city’s compressed contour set could occupy hundreds of megabytes. Every OSM or cost-model change requires rebuilding the graph and contour set.
- It still needs a custom pedestrian importer and correctness suite. The small CH JavaScript ecosystem supplies an algorithm, not Valhalla-grade walking semantics.
- Browser routing would align well with the PWA, but it would move routing outside the SvelteKit backend and therefore does not satisfy the stated constraint.

**Verdict: 6/10.** Attractive only if measured latency later proves Valhalla insufficient and approximate prechecks are acceptable.

## 4. What the current code already gives us

### `src/lib/server/valhalla.ts`

`ValhallaClient` is already almost the desired local-engine adapter:

- `route()` sends pedestrian, multipoint routes with intermediate `through` locations and requests OSRM-shaped GeoJSON output.
- `isodistance()` deduplicates and batches several distance contours into one `/isochrone` call.
- `traceEdges()` obtains way IDs, node pairs, lengths, surface, road class, tunnels, and pedestrian access for route scoring. This is an important requirement that most proposed replacements omitted.
- It already has a total call budget, bounded concurrency, per-call timeout, request cancellation, and health checking.
- Migration can initially be limited to changing `baseUrl` to the private sidecar and making `apiToken` optional. The returned application contracts do not need to change.

`src/lib/server/route-generation.ts` currently performs one contour call, four concurrent candidate route-plus-trace pairs, and optionally one adjusted contour/route/trace cycle: normally **9 internal Valhalla calls, up to 12**. That exact workload should become the deployment benchmark, followed by a 30-operation stress case.

### `src/lib/route/shapes.ts`

- `loopPoints()` and its algorithms generate geographic waypoint sets independently of any routing provider.
- `targetKilometers()` and `pointAt()` contain no Valhalla dependency, so frontend previews and legacy shape generation remain unchanged.
- The newer server generator derives anchors from network contours rather than directly calling `loopPoints()`, but both paths terminate in the same multipoint routing contract.
- This separation means deployment should change before route-generation algorithms: first replace the engine location, then optimize candidate batching only if measurements require it.

## 5. Recommended migration path

1. **Freeze the current contract.** Add integration fixtures covering `/status`, one pedestrian multipoint route, one multi-distance isodistance request, and `trace_attributes`. Record expected geometry validity, distance tolerances, and required edge fields.
2. **Run Valhalla locally first.** Download the smallest representative buffered city PBF and build pedestrian graph tiles with the official native tooling/container. Ensure the extract extends beyond the maximum loop radius.
3. **Point the existing client at localhost.** Make `apiToken` optional and configure `VALHALLA_BASE_URL=http://127.0.0.1:8002` or `http://valhalla:8002`. Do not expose Valhalla’s port publicly and do not retain an external fallback.
4. **Benchmark before changing hosting.** Replay the current 9–12-call generation sequence, a 30-operation stress sequence, and simultaneous users. Measure route, trace, and isochrone latency separately; begin with four Valhalla workers and application concurrency of 4–8.
5. **Move dynamic SvelteKit to `adapter-node`.** Deploy SvelteKit and Valhalla together with Docker Compose or systemd on a local-SSD VPS. Start at 4 vCPU/4 GB unless measurements justify less.
6. **Add production controls.** Gate SvelteKit readiness on Valhalla health, preserve timeout/cancellation logic, add queue-depth and latency metrics, and return an explicit out-of-coverage error.
7. **Cut over without algorithm changes.** Keep the current route-generation and scoring behavior until route parity is established; then remove external API credentials and provider-specific deployment configuration.
8. **Harden graph updates.** Initially use the one-time graph. Later add weekly or monthly staging builds, smoke tests, immutable version metadata, atomic container/volume promotion, and rollback to the previous graph.
9. **Complete licensing work.** Show “© OpenStreetMap contributors” adjacent to the Leaflet map, link the OSM copyright/licence page, and document how the derived graph is offered or reproduced under ODbL where required.

## 6. Open questions before committing

1. Does “part of SvelteKit in the backend” allow a private, same-host Valhalla process? If it literally requires the Node process, the fallback is a custom TS graph with substantially higher cost and risk.
2. What city/region is required, what is the maximum loop distance, and how much boundary buffer is needed?
3. What are the target p95 generation latency and expected number of simultaneous users?
4. Are `trace_attributes` and the current edge-based scoring mandatory? Removing them could materially reduce each click’s call count.
5. How exact must isodistance contours be? Are they user-visible results or only approximate candidate prechecks?
6. Is a one-time frozen graph sufficient, or are weekly/monthly updates required?
7. Is operating a 4-vCPU/4-GB VPS, persistent volume, monitoring, and graph-build job acceptable?
8. Should the complete SvelteKit app move off Netlify, or should only static assets remain on its CDN?
9. What is the desired behavior outside coverage: hard error, disabled generation, or installation of another regional graph pack?
10. Who will own ODbL compliance and any public distribution/source offer for the derived routing graph?
