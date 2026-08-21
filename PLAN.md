# Radiusly prototype status and roadmap

## Goal

Validate that Radiusly can consistently create convenient, varied, enjoyable walking loops. Keep the current SvelteKit PWA until route quality or real usage proves it insufficient.

## Implemented

- [x] Save, select, rename, and delete reusable starting points.
- [x] Add starting points from geolocation or a map pin and restore the last selection.
- [x] Report actionable geolocation failures.
- [x] Plan by distance or time and remember the selected target and walking pace.
- [x] Save, search, select, rename, and delete walk-by spots.
- [x] Generate multiple candidates with different bearings and distance scales.
- [x] Score candidates by distance error and repeated route sections.
- [x] Penalize long continuous out-and-back sections and repetition near railway stations.
- [x] Reject candidates that exceed the configured backtracking limits.
- [x] Offer Organic, Tangent, two Orbit variants, and Spaghetti route shapes.
- [x] Provide “Make another route” and copyable route-debugging information.

## Priority 1: Field validation

- [ ] Test several distances in a dense center, a residential grid, and a disconnected or park-heavy area.
- [ ] Record requested distance, routed distance, repeated sections, route shape, and debugging information.
- [ ] Walk representative routes and rate safety, interest, variety, and willingness to use Radiusly again.
- [ ] Preserve confirmed failures as manual regression cases or automated geometry tests where practical.

Done when the current scoring limits produce consistently acceptable routes across the test areas, or the collected failures identify a specific next routing change.

## Priority 2: Pleasantness scoring, if needed

Do not add more scoring inputs until field results show that low-backtracking routes are still unpleasant.

Possible next signals are parks and green space, road class, crossings, surface, lighting, and land use. Add only the smallest set that explains observed failures.

## Priority 3: Production hardening, if validated

Consider dedicated routing infrastructure, caching, monitoring, accounts, sync, or a native client only after repeated use justifies their cost. Public map, search, routing, and Overpass services are acceptable for prototype validation but are not a production service guarantee.

## Regression cases

- Pankow–Blankenburg ponds: avoid the southeastern dead-end spur and prefer the left-hand arc after reaching the path end.
- Pankow station area: reject a long southbound station spur that returns over the same path.
- Orbit with the same return: prefer the shortest practical shared stem before beginning the orbit.
- Near-zero-backtracking settings: do not accept a route with a long dead end merely because its total distance is close to the target.

## Decision gate

Keep SvelteKit, Leaflet, local browser storage, and the current public data services during validation. Reconsider the stack only when measured route-quality failures or validated usage require it.
