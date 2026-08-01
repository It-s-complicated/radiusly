# Route shape algorithms

Radiusly does not draw a route directly. A shape algorithm creates geographic waypoints, the walking router connects them using real paths, and the result is accepted or rejected by shared quality rules.

The implementation lives in [`route.mjs`](route.mjs). `loopPoints()` defines the shapes and `walkingLoop()` generates, scores, calibrates, and selects routed candidates.

## Shape summary

| Shape | Waypoint geometry | Focus |
| --- | --- | --- |
| Organic | Three evenly spaced points around the start | A simple, balanced neighborhood loop |
| Tangent | A circular loop whose rim passes through the start | Immediate circulation without an outbound stem |
| Orbit — same return | A loop around the start with the same outbound and inbound point | A clear stem and predictable orbit |
| Orbit — nearby return | An orbit with outbound and inbound points separated by 18° | Similar to Orbit, with less exact backtracking near home |
| Spaghetti | One of three four-detour crossing patterns around an offset center | Deliberately tangled routes with visibly different layouts |

## Shared inputs

Every shape receives:

- `start`: the loop's starting coordinate.
- `targetKm`: requested distance, or time converted with `minutes × pace / 60`.
- `bearing`: the direction in which the shape is oriented.
- `favorites`: selected walk-by points that must be included.
- `scale`: a candidate-specific radius multiplier.

Every radius has a minimum of `0.18 km`. This prevents very short requests from collapsing all waypoints onto the same streets.

Organic, Tangent, and Orbit mix favorites into their angular waypoint order. Spaghetti inserts favorites after its first detour so the requested visit becomes part of the crossing sequence.

After each generation the app advances the base bearing by `67°`. Because 67 and 360 have no common divisor, successive generations eventually cover every integer bearing before repeating.

## Organic

Organic places three detours around the start at offsets of `0°`, `120°`, and `240°`, then orders those detours and any favorites around the start before closing the loop.

```text
radius = max(0.18, targetKm / (2π) × 0.87 × scale)
```

Focus:

- balanced coverage around the starting point;
- few waypoints, so it remains routable in sparse street networks;
- no deliberately repeated stem or crossing.

Tune it with:

- `0.87`: increase it when routed Organic loops are consistently short; decrease it when they are long;
- `[0, 120, 240]`: change the offsets to make the shape more asymmetric;
- the number of detours: add one only if field tests show that three cannot produce enough variety, because every waypoint adds routing constraints and network requests.

If no acceptable Organic candidate is found and there are no favorites, Radiusly also tries Tangent candidates.

## Tangent

Tangent first moves the loop center one radius away from the start. It then places three more points around that center, making the start itself the fourth point on the perimeter.

```text
radius = max(0.18, targetKm / (2π) × 0.9 × scale)
```

Focus:

- the start lies on the rim instead of at the center;
- the route begins circulating immediately;
- useful as a fallback when Organic produces unavoidable backtracking.

Tune it with:

- `0.9`: the main routed-distance calibration;
- `[90, 180, 270]`: perimeter spacing relative to the start;
- the center bearing: changing it rotates the entire loop without changing its topology.

## Orbit — same return

Orbit starts at the center, travels to an outbound rim point, visits three other perimeter points, returns to the same rim point, and then follows the stem home.

```text
radius = max(0.18, targetKm / (2 + 2π) × 0.9 × scale)
outbound gap = 0°
inbound gap = 0°
```

Focus:

- a recognizable outbound stem followed by a loop;
- predictable direction and shape;
- explicitly permits the shared return stem.

Tune it with:

- `2 + 2π`: represents two stem lengths plus a circular perimeter; increasing the denominator shrinks the shape;
- `MAX_ORBIT_STEM_METERS` (`500 m`): candidates with a longer repeated stem cause another candidate batch to be generated;
- `[90, 180, 270]`: controls perimeter sampling.

The same-return variant is exempt from the normal repeated-path limit because repeating its stem is intentional. Station-area repetition is still limited.

## Orbit — nearby return

Nearby return uses the same construction as Orbit, but separates the outbound and inbound points:

```text
outbound bearing = bearing - 9°
inbound bearing  = bearing + 9°
```

Focus:

- retain the orbit character;
- encourage two nearby streets instead of exact out-and-back walking;
- remain more predictable than Organic or Spaghetti.

Tune it with the `9°` gap. A larger gap separates departure and return more strongly but consumes more of the target distance near the start. A smaller gap makes exact backtracking more likely.

Unlike same-return Orbit, this variant must pass the normal repeated-path limits.

## Spaghetti

Spaghetti moves a virtual center away from the start and places four irregular detours around it. It does not sort them geographically: their deliberate order creates crossings.

The base radius is:

```text
radius = max(0.18, targetKm / 11.5 × 0.9 × scale)
```

One of these offset sequences is selected from the rounded bearing modulo three:

```text
[168,  48, 228, 108]
[144, 288,  72, 216]
[108, 276,  72, 228]
```

All primary candidates in one generation use the same pattern. Advancing the base bearing by `67°` selects the next pattern for the next generation while also rotating it to another part of the map.

Each detour is made irregular with deterministic jitter:

- radius varies from `72%` to `128%` of the base radius;
- angle varies by up to `±18°`;
- the virtual center direction varies by up to `±14°`;
- the center distance varies from `80%` to `115%` of the base radius.

Focus:

- visibly different crossing layouts, not just small perturbations of one loop;
- deterministic output for a given bearing, which keeps bugs reproducible;
- the original four-detour budget, which remains workable for shorter routes.

Tune it with:

- the three offset arrays: change topology here; keep four offsets unless shorter-distance regression tests support more;
- `11.5` and `0.9`: distance calibration; a larger denominator makes the waypoint shape smaller;
- `0.72`, `0.56`, and `36`: radial spread and angular jitter in `irregularPoint()`;
- center direction and distance ranges: increase them for broader geographic variation, but watch target-distance error;
- the app's `67°` bearing step: change this only to alter the sequence of generated regions. Keep it coprime with 360 to avoid a short cycle.

### Spaghetti fallbacks

If primary Spaghetti candidates remain unacceptable, Radiusly tries:

1. `spaghetti-cross`: three irregular detours with a simpler crossing layout and a slightly higher allowed repeated run (`260 m`).
2. `spaghetti-safe`: the same three-detour budget without jitter, used only when no prior Spaghetti route is acceptable.

These are internal fallbacks, not user-selectable shapes. Tune them when Spaghetti frequently returns no route, before weakening global quality thresholds.

## Candidate generation and calibration

The first batch contains four bearings and four scales. Spaghetti uses bearing offsets divisible by three so every candidate keeps the selected topology.

| Batch | Normal bearing offsets | Spaghetti bearing offsets |
| --- | --- | --- |
| First | `0, 53, 127, 211` | `0, 54, 126, 210` |
| Extra | `29, 91, 169, 257` | `30, 90, 168, 258` |

Without favorites, scales are `0.75, 0.9, 1.05, 1.2`. With favorites they are `0.35, 0.55, 0.75, 0.95`, because fixed walk-by points already contribute distance and geographic spread.

If the best backtracking-safe candidate misses the target by more than `10%`, one more candidate is generated with a corrected scale:

```text
corrected scale = min(1.4, old scale × target distance / routed distance)
```

Tune candidate counts only when route-debug data shows that good candidates exist but are rarely sampled. Each additional candidate is another external routing request.

## Quality rules

A candidate is acceptable when:

- routed distance is within `25%` of the target;
- repeated path is at most `5%` of the route;
- the longest repeated run is at most `210 m` (`260 m` for Spaghetti fallbacks);
- repeated walking within `250 m` of a railway station is at most `100 m`.

Acceptable candidates are ranked using meter-based penalties:

```text
distance error
+ repeated distance
+ 2 × longest repeated run
+ 4 × station-area repeated distance
```

Tune these limits last. A failure isolated to one shape usually means its waypoints are too dense, too numerous, or poorly ordered. Relaxing the shared limits can hide that problem by returning unpleasant out-and-back routes.

## Practical tuning workflow

1. Copy the route debugging information and identify whether failures come from distance error, total repetition, the longest repeated run, or station repetition.
2. Change one shape constant or offset sequence at a time.
3. Run `node test-route.mjs`.
4. Manually test short, medium, and long targets in dense, sparse, barrier-heavy, and station-adjacent neighborhoods.
5. Compare several consecutive generations, not only the first successful route.

For distance errors, tune the shape's radius formula first. For repeated paths, change waypoint count, spacing, or order. For insufficient variety, change bearing offsets or topology patterns. Change shared acceptance thresholds only when field testing shows the current definition of an acceptable walk is itself wrong.
