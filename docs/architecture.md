# Architecture

## Goal

A static single-page app. No backend. It shows every Wellington train moving on a dark map over a day, with a timeline you can scrub.

End state: the same thing for buses, driven by recorded real-time data as well as timetables, on a map built from our own LINZ extract.

## Phases

### MVP: timetable simulation, trains only

- Wellington trains only (Kapiti, Hutt Valley, Johnsonville, Melling, Wairarapa).
- One service date at a time, chosen from a date picker. Default is today.
- Map is a dark background with rail lines and a coastline. A ready-made dark basemap is acceptable here.
- Glowing dots, trails, play/pause, speed control, scrubber, clock.
- Hosted as static files. Works from `vite preview` on a laptop.

### Phase 2: our own map

- Extract from LINZ Data Service: coastline and water polygons, main roads, rail. Build vector tiles into a single PMTiles file. Style them ourselves.
- Drop the third-party basemap.

### Phase 3: buses

- Same pipeline, much more data. About two orders of magnitude more trips than trains.
- Needs the packed binary format and GPU-side animation described below.

### Phase 4: real data

- A small poller records Metlink real-time vehicle positions all day and writes one file per day.
- The app plays back a recorded day instead of a simulated one. The renderer does not change, only the data source.
- This is the only phase that needs a server or scheduled job. It still produces static files.

## Data sources

| Data | Source | Notes |
| --- | --- | --- |
| Timetables | Metlink GTFS static feed | Needs `stops`, `routes`, `trips`, `stop_times`, `shapes`, `calendar`, `calendar_dates`. Confirm the download URL and licence on the Metlink open data page before building. |
| Live positions | Metlink real-time API (GTFS-RT vehicle positions) | Needs an API key. Phase 4 only. |
| Map features | LINZ Data Service | Phase 2. Licence is CC BY 4.0, so attribution is required. |

## System overview

```
             build time (Node scripts)                         run time (browser)
 ┌───────────┐   ┌──────────────┐   ┌────────────────┐    ┌──────────────────────────┐
 │ GTFS zip  ├──►│ filter to    ├──►│ per-day packed ├───►│ loader ► sim clock ►     │
 │           │   │ trains, pick │   │ trip files +   │    │ position sampler ►       │
 └───────────┘   │ services,    │   │ routes.json    │    │ deck.gl layers on MapLibre│
                 │ build paths  │   └────────────────┘    └──────────────────────────┘
 ┌───────────┐   ┌──────────────┐   ┌────────────────┐
 │ LINZ data ├──►│ tippecanoe   ├──►│ map.pmtiles    │  (phase 2)
 └───────────┘   └──────────────┘   └────────────────┘
```

Two rules keep this simple:

1. All heavy work happens at build time. The browser never parses GTFS.
2. The runtime is a pure function of time. Given `t`, the app can compute every vehicle position with no history. That is what makes scrubbing free.

## Data pipeline

Node scripts in `pipeline/`, run by hand and later in CI. Output goes to `public/data/`.

Facts from the feed we downloaded (version dated 2026-09-10):

- Rail is `route_type` 2 and has 5 routes: Kapiti (2), Melling (3), Wairarapa (4), Hutt Valley (5), Johnsonville (6). Route colours are in `routes.txt`, though Melling and Hutt Valley share the same orange.
- 1,168 rail trips in the feed, 387 running on a normal Friday. All buses together are 4,554 that day, so about 12 times more.
- Every rail trip has a shape, and there are only 48 distinct rail shapes. No stop-to-stop fallback needed for trains.
- `stop_times.txt` has no `shape_dist_traveled` for rail, so we must project stops onto shapes ourselves. `shapes.txt` does have cumulative distances.
- Times go up to 26:14:00, so the overnight tail is real.
- Route types 4 (ferry) and 5 (cable car) exist, one route each. Cheap to add later.
- `shapes.txt` and `stop_times.txt` are about 45 MB each, mostly buses. Filter early.

1. **Filter.** Keep routes where `route_type` is rail (2). Drop everything else.
2. **Resolve service days.** For each date we ship, work out which `service_id`s run, using `calendar` plus `calendar_dates` exceptions. Do not assume weekday patterns.
3. **Handle GTFS times.** `stop_times` can exceed 24:00:00 for trips running past midnight. Keep these as seconds since the start of the service day. Convert to wall-clock only at the UI edge, using the `Pacific/Auckland` timezone. Daylight saving days are 23 or 25 hours long. Use a real timezone library, never a fixed offset.
4. **Build trip paths.** For each trip, take its `shape_id` polyline and project each stop onto it to get a distance along the shape. The result is a list of `(seconds, distanceAlongShape)` control points, one per stop. If a trip has no shape, fall back to straight lines between stops.
5. **Emit.**
   - `routes.json`: id, name, colour, ordered shape geometry (for drawing the dim base lines).
   - `stops.json`: id, name, lon, lat.
   - `day-YYYY-MM-DD.bin` or `.json`: the trips for that date. Start with JSON. Move to a packed typed-array layout when size or parse time hurts.

Train volume is small (hundreds of trips a day), so JSON is fine for the MVP. Buses will not fit that way. Design the loader interface so the format can change without touching the renderer.

## Runtime

### Modules

| Module | Responsibility |
| --- | --- |
| `data/` | Fetch and decode day files. Exposes a `Day` object with trips and routes. |
| `clock/` | Simulation time in seconds since service-day start. Play, pause, speed, seek. Pure state, no rendering. |
| `sim/` | Turns `(Day, t)` into vehicle positions and trail paths. |
| `render/` | MapLibre map plus deck.gl layers. Reads from `sim/`, never mutates it. |
| `ui/` | Scrubber, speed control, date picker, clock display. Talks to `clock/` only. |

`clock/` and `sim/` have no DOM or WebGL dependencies. They can be unit tested in Node and reused if we ever render elsewhere.

### Position sampling

For trip `T` at time `t`, find the two control points either side of `t`, interpolate distance along the shape, and look up the coordinate on the polyline. Trips outside their start and end times are not drawn. Vehicles dwell at stops, which falls out naturally when two control points share the same distance.

Trails do not need history. Sample the same function at `t - k*dt` for a handful of `k`, or precompute each trip as a timestamped path and let the renderer clip it to `[t - trailLength, t]`.

### Scrubbing and performance

Recomputing every position on the CPU each frame is fine for trains. For buses it will not be, so the target design is:

- Upload each trip as a timestamped path once.
- Let the GPU pick the visible slice from a single `currentTime` uniform each frame.
- Scrubbing then costs one uniform update, whatever the data size.

deck.gl's `TripsLayer` already works this way, which is a main reason to choose it.

## Tech choices

| Concern | Choice | Why |
| --- | --- | --- |
| Build | Vite, TypeScript | Static output, fast dev loop. |
| Map | MapLibre GL JS | Open source, vector tiles, custom styling, no API key. |
| Animation | deck.gl (`TripsLayer` for trails, `ScatterplotLayer` for dots) | Trails and time-uniform animation are built in. Additive blending gives the glow. |
| UI | Plain TypeScript with a small framework only if needed | The UI is a few controls. Decide when it hurts. |
| Map tiles (phase 2) | PMTiles built with tippecanoe | A single file on any static host, read by range requests. |
| Hosting | Any static host (GitHub Pages, Cloudflare Pages, S3) | No server. |

Alternative considered: a hand-written canvas or WebGL renderer. It gives full control over the look, but we would rebuild trails, picking and map sync. Revisit only if deck.gl blocks the visual style.

## Basemap decision

For the MVP, use a free dark raster or vector basemap, or none at all. With none, the coastline and rail lines alone probably look good, because the Gource style depends on emptiness. Start there and see. Avoid anything needing an API key so the app stays static.

LINZ basemaps are an option, but they are not styled for dark mode and their terms need checking. The phase 2 extract from the LINZ Data Service gives us full control over what is drawn.

## Repo layout

```
docs/               this file and friends
pipeline/           GTFS and LINZ processing scripts
public/data/        generated data, gitignored or committed, decide later
src/
  data/  clock/  sim/  render/  ui/
```

## MVP milestones

1. **Data.** Script turns Metlink GTFS into `routes.json`, `stops.json` and one day file. Check by eye in a GeoJSON viewer.
2. **Static map.** Vite app with MapLibre showing rail lines on a dark background.
3. **Moving dots.** Clock plus sampler plus `ScatterplotLayer`. Check dot positions against the Metlink journey planner for a few trips.
4. **Trails and glow.** Add `TripsLayer` and additive blending. This is where we tune the look.
5. **Controls.** Scrubber, play/pause, speed, date picker, clock in local time.
6. **Deploy.** Static build published somewhere.

## Open questions

- The feed is at https://www.metlink.org.nz/legal/general-transit-feed-specification. Its terms are a liability disclaimer and a note that GWRC may change the URL without notice. They grant no explicit licence, so redistribution of derived data is unclear. Until that is settled, keep `gtfs/` and `public/data/` out of git and have the build read a local copy.
- The feed only covers a window (currently 2026-08-23 to 2026-10-10). Days outside it cannot be simulated, and the URL can change, so the pipeline should record the feed version it used.
- How far ahead and back do we ship days? One day per build is enough to start.
- Colour by line, by direction, or by delay once we have real data?
- Which basemap for the MVP: none, a third-party dark style, or wait for our own?
