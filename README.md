# Radiusly

A small installable web app for planning neighborhood walking loops by distance or time.

## Run locally

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173`. Use HTTPS when hosting it so installation and geolocation work on phones.

Starting points and walk-by spots are stored only in the browser. The map, place search, and pedestrian routing need an internet connection.

Planner mode, distance, time, and pace are also remembered locally. Route scoring uses nearby OpenStreetMap railway stations when that lookup is available.

Route shapes include an organic loop, a circle tangent to the start, and centered orbits with either a shared or nearby return path.

## Field checks

For each neighborhood, try several distances and record the requested/routed distance, repeated sections, and a walked rating for safety, interest, and variety. Test at least a dense center, a residential grid, and a disconnected or park-heavy area, then ask testers unprompted whether they would use Radiusly again.

Manual regression: a Pankow–Blankenburg ponds loop must not use the southeastern dead-end spur. At the ponds, prefer continuing to the path end and taking the left-hand arc instead of turning back.

The same loop must reject a long southbound spur through the S-Bahn station area that returns along the same path.
