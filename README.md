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
- Route summaries, “Make another route”, and copyable debugging information for reporting poor routes.
- Installable PWA behavior.

Known limitations:

- Route quality is based on geometric heuristics. It does not yet score scenery, traffic, lighting, accessibility, construction, or personal safety.
- Railway-station penalties depend on an optional OpenStreetMap lookup and are skipped when that lookup is unavailable.
- Maps, place search, station lookup, and pedestrian routing use public third-party services and require an internet connection.
- There are no accounts, cross-device sync, backend, or offline routing.
- Representative routes still need systematic field testing in different neighborhood types.

See [ROUTE_ALGORITHMS.md](ROUTE_ALGORITHMS.md) for shape behavior and tuning, and [PLAN.md](PLAN.md) for the remaining validation and product decisions.

## Run locally

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173`. Use HTTPS when hosting it so installation and geolocation work on phones.

Run the route-scoring checks with:

```bash
node test-route.mjs
```

## Manual regression routes

- A Pankow–Blankenburg ponds loop must not use the southeastern dead-end spur. At the ponds, prefer continuing to the path end and taking the left-hand arc instead of turning back.
- The same loop must reject a long southbound spur through the S-Bahn station area that returns along the same path.
