Radiusly should be like a exploration-first walking app, not just another route planner.


One important Lynx-specific note up front: based on the current official Lynx docs, I’d plan this as a native host app with Lynx/ReactLynx-powered screens, rather than assuming a pure from-scratch standalone Lynx app shell. ReactLynx is the official React layer, and the standard start point is `npm create rspeedy@latest`.


Here’s a solid plan for Radiusly.


# 1. Product vision


Radiusly helps people rediscover their city by turning a desired walking distance and optional places of interest into enjoyable, varied walking routes.


Short positioning:
- “Tell Radiusly how far you want to walk.”
- “Optionally add cafés, parks, bookstores, bakeries, or pinned places.”
- “Get a walk that feels fresh, local, and worth taking.”


What makes it special:
- distance-first
- neighborhood variety
- optional POI-driven routing
- save and plan future walks


# 2. Core user promise


A user should be able to:
- choose a start point
- enter a target distance
- optionally select POIs or POI categories
- get 1 to 3 suitable walking routes
- save or schedule that walk for later


# 3. Ideal MVP


I’d keep the MVP very focused.


## Must-have features


### A. Walk planner
- select start location
  - current location
  - address search
  - pin on map
- enter target distance
  - presets like 2 km, 5 km, 8 km
  - custom input
- choose walk type
  - loop back to start
  - out-and-back
- optionally add POIs
  - categories: café, park, bakery, bookstore, viewpoint
  - or pin exact places on the map


### B. Route generation
- generate up to 3 candidate walks
- show:
  - route on map
  - exact distance
  - estimated walking time
  - POIs visited/passed
  - short label like:
    - Scenic
    - Quiet
    - Exploratory


### C. Save and plan
- save a generated walk
- add planned date/time
- show upcoming walks list


### D. Basic account or local persistence
For MVP, one of:
- local-only saved walks, or
- lightweight sign-in for sync across devices


If you want fastest MVP, I’d start with local persistence first.


# 4. Best product differentiator: “joy” and “variety”


This is the part that makes Radiusly memorable.


Instead of only optimizing for shortest path, Radiusly should optimize for:
- distance fit
- walkability
- novelty
- pleasantness
- POI relevance


Useful concepts to expose in the UI:
- New streets score
- Green route
- Quiet route
- Lively route
- Loop satisfaction
- POI match score


A really strong future feature:
- track previously walked street segments
- prefer routes with higher “new streets %”


That directly supports your goal of helping people enjoy varying neighborhoods.


# 5. User flows


## Flow 1: Create a walk
1. Open app
2. Tap “Plan a walk”
3. Set start location
4. Enter distance
5. Optionally add POIs
6. Tap “Generate”
7. Review 3 route options
8. Save one or start immediately


## Flow 2: Save and plan
1. Generate route
2. Tap “Save”
3. Optionally set:
   - title
   - date/time
   - reminder
4. Route appears in “Saved” and/or “Planned”


## Flow 3: Reuse saved walks
1. Open “Saved walks”
2. Tap saved route
3. View on map
4. Re-generate if conditions changed
5. Walk it again or reschedule


# 6. Suggested screens


## 1. Home
- quick CTA: “Plan a walk”
- saved walks preview
- upcoming planned walks
- quick distance presets


## 2. Planner
- map
- start location selector
- distance input
- loop/out-and-back toggle
- POI chips and map pin selector
- generate button


## 3. Route results
- map with route polylines
- bottom sheet with route cards
- distance/time/POIs
- save / plan buttons


## 4. Saved walks
- list/grid of saved routes
- filters by distance, area, tags


## 5. Planned walks
- calendar/list view
- reminder status


## 6. Settings/profile
- units
- walking speed
- accessibility preferences
- avoid hills / avoid busy roads
- privacy controls


# 7. Route generation logic


This is the core engine.


## Inputs
- start point
- target distance
- route type
- optional POIs or POI categories
- optional preferences:
  - quieter streets
  - greener areas
  - avoid stairs
  - avoid major roads


## Candidate generation
For MVP:
- generate several route candidates
- score them
- return best 3


## Scoring factors
Each candidate can be scored on:
- distance accuracy
- POI coverage
- route variety
- segment repetition penalty
- park/green area presence
- road pleasantness
- crossing complexity
- loop quality


A simple scoring model:
- 35% distance fit
- 25% POI fit
- 20% novelty/variety
- 10% pleasantness
- 10% simplicity/safety


## Output
Return 3 clearly differentiated options:
- Best match
- Most scenic
- Most varied


That gives the user choice without overwhelming them.


# 8. Recommended map and routing stack


Since you mentioned OpenStreetMap, this is a strong fit.


## Prototype stack
- map data/tiles: OpenStreetMap-based
- geocoding: Nominatim or Photon
- POI search: Overpass API
- walking routes: GraphHopper, Valhalla, or OSRM
- backend DB: PostgreSQL + PostGIS


## Production-minded note
For production, don’t depend heavily on public community endpoints for tiles/geocoding/Overpass traffic. Plan to self-host or use managed providers.


# 9. Recommended architecture with Lynx


This is where I’d be opinionated.


## Best setup
### Native host app
Handles:
- device permissions
- geolocation
- notifications/reminders
- deep links
- secure/local storage
- possibly the map surface itself


### Lynx / ReactLynx layer
Handles:
- planner UI
- result cards
- bottom sheets
- saved/planned walk screens
- animations and interaction-heavy UI


### Backend
Handles:
- route generation
- POI matching
- scoring
- persistence/sync
- reminders scheduling


## Why this setup
Current Lynx docs are strongest around embedding/integration, and Radiusly has a map-heavy use case. So the safest architecture is:


- native shell for platform features and map integration
- Lynx for fast, polished cross-platform product UI


# 10. Lynx-specific implementation notes


Based on current docs, I’d plan around these realities:


- use ReactLynx
- ReactLynx is aligned with React 17 compatibility, so avoid assuming React 18-only patterns
- business logic and networking should live on the background thread
- use main-thread scripting for ultra-responsive UI interactions
- native modules are the escape hatch for platform-specific capabilities


## Where Lynx shines in Radiusly
Use Lynx for:
- draggable planner sheet
- route cards carousel
- smooth transitions between map states
- onboarding
- saved/planned lists
- animated distance controls


## Where native host likely helps most
Use native integration for:
- location permissions
- notifications
- calendar hooks
- persistent storage
- map SDK or advanced map embedding if needed


# 11. Proposed data model


Keep it simple.


## User
- id
- name
- units
- preferences


## WalkPreference
- preferred_distance_range
- preferred_poi_types
- avoid_busy_roads
- avoid_hills
- accessibility_mode


## SavedWalk
- id
- user_id
- title
- start_location
- target_distance
- actual_distance
- route_geometry
- pois
- created_at


## PlannedWalk
- id
- saved_walk_id or generated_route_id
- planned_for
- reminder_at
- status


## RouteCandidate
- id
- input_hash
- geometry
- score
- distance
- estimated_duration
- labels
- poi_hits


## WalkHistory
Optional but valuable later:
- completed_walk_id
- traversed_segment_ids
- completion time
- rating


That `traversed_segment_ids` idea is what enables “show me new streets.”


# 12. MVP roadmap


## Phase 1: clickable prototype
- planner screen
- fake route results
- saved walks UI
- test interaction model and UX


## Phase 2: functional MVP
- real map
- real route generation
- POI selection
- save walks
- plan walks
- local persistence


## Phase 3: beta polish
- reminders
- profile/preferences
- improved scoring
- route labels
- route regeneration
- analytics


## Phase 4: differentiation
- new streets score
- neighborhood themes
- completion tracking
- weather-aware suggestions
- social sharing


# 13. Key product risks


## 1. Route quality
If route quality is weak, the app loses its magic fast.


Mitigation:
- return 3 options
- optimize for joy, not just shortest path
- test in real neighborhoods early


## 2. POI quality
OSM POI quality varies by city.


Mitigation:
- start in cities/regions with strong OSM coverage
- support category fallback if exact POI matching is poor


## 3. Over-complex MVP
Too many options can make planning feel like work.


Mitigation:
- start with:
  - distance
  - optional POIs
  - loop toggle
  - generate


## 4. Lynx integration complexity
Map-heavy experiences can need native help.


Mitigation:
- design Radiusly as native host + Lynx feature surfaces from day one


# 14. A crisp MVP definition


If I had to reduce Radiusly to one sentence:


“Radiusly generates enjoyable walking loops of a chosen distance, optionally passing through places you care about, and lets you save or schedule them.”


And the MVP success criteria would be:
- user can generate a useful walk in under 30 seconds
- route distance is close to requested target
- routes feel pleasantly different from each other
- saved/planned walks are easy to revisit


# 15. My recommendation


If you want to build this well with Lynx, I would start with:


- native host shell
- ReactLynx UI for planner/results/saved/planned screens
- OSM-based backend route engine
- loop walks as the default
- 3 generated route styles
- local save first, account sync later


If you want, I can turn this into either:
1. a proper PRD,
2. a technical architecture doc,
3. a screen-by-screen wireframe plan, or
4. a first project folder structure for a Lynx/ReactLynx implementation.
