# Radiusly next-iteration plan

## Goal

Validate that Radiusly can consistently create convenient, varied, enjoyable walking loops. Keep the current PWA stack until route quality or real usage proves it insufficient.

## Priority 1: Saved starting points

Let users manage reusable starting points instead of depending on geolocation every time.

- Add a starting-point list stored locally in the browser.
- Add points from the current location or a pin on the map.
- Let users name, select, rename, and delete points such as “Home” or “Office”.
- Restore the last selected point when the app reopens.
- Keep starting points separate from walk-by spots.
- Report whether geolocation failed because the page is insecure, permission was denied, or the position was unavailable.

Done when a user can create two starting points, switch between them, reload the app, and generate a route without using geolocation again.

## Priority 2: Reduce repeated and uninteresting routing

The current router connects synthetic waypoints by shortest walking paths. It does not understand route variety or pleasantness.

- Generate a small set of loop candidates with different waypoint bearings.
- Measure distance error and repeated route segments.
- Prefer the candidate closest to the requested distance with the least backtracking.
- Keep “Make another route” for choosing a different acceptable candidate.
- Save the reported station and repeated-path examples as manual regression cases.

Done when routes stay reasonably close to the requested distance and avoid obvious out-and-back sections when another connected path exists.

Pleasantness scoring using OSM road, park, and land-use data comes later; add it only if overlap reduction does not produce good-enough walks.

## Priority 3: Walk-by spots and POIs

The prototype already supports manually pinned walk-by spots, but the feature needs to be easier to find and use.

- Make the existing add action more prominent.
- Let users search for a place or pin it directly on the map.
- Keep a local list with select, rename, and delete controls.
- Include selected spots while still applying distance and overlap scoring.

Done when a user can add a café or favorite place, include it in a loop, and reuse it after reloading the app.

## Priority 4: Field validation

- Test several distances in at least three structurally different neighborhoods.
- Record requested versus routed distance and visible repeated sections.
- Walk representative routes and rate them for safety, interest, and variety.
- Ask test users whether they would use Radiusly again without prompting.

## Decision gate

Keep vanilla JavaScript, Leaflet, and local browser storage during this iteration. Reconsider the routing service when candidate scoring cannot produce good walks; add a backend, accounts, or a native client only when validated usage requires them.
