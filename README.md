# Wellington in motion

A dark-mode, glowing-dots map of every Wellington train, ferry and bus over a day, with a scrubbable timeline. Simulated from Metlink's published timetables. Live data is a later phase.

Inspiration: https://lnkd.in/p/ey5qq6ds (an animation of every train in the Netherlands over 24 hours, in a Gource-like style).

Docs:

- [docs/architecture.md](docs/architecture.md) covers the end goal, the MVP, the data pipeline, the runtime and the tech choices.
- [docs/inspiration.md](docs/inspiration.md) covers the visual target.

## Run it

```
make coastline    # download the LINZ coastline (needs LINZ_API_KEY, see .env.example)
make refresh      # download the latest Metlink GTFS into ./gtfs and build the data
make dev          # installs, builds the data if needed, serves http://localhost:5173
make test
make build        # static site in ./dist
make help         # everything else
```

Space toggles play/pause. Drag the slider to scrub. The date picker covers the days the feed covers.

## Data and credits

- **Timetables.** Metlink General Transit Feed Specification, Greater Wellington Regional Council. https://www.metlink.org.nz/legal/general-transit-feed-specification
- **Coastline.** Land Information New Zealand (LINZ), [NZ Coastlines (Topo, 1:50k)](https://data.linz.govt.nz/layer/50258-nz-coastlines-topo-150k/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). We clip it to the Wellington region and simplify it to 4 m. The app shows this credit in its credits box, taken from `public/data/coastline.json`, so it stays with the data.
- **Hillshade basemap.** LINZ Basemaps, [hillshade-igor-dsm](https://basemaps.linz.govt.nz/), "Sourced from LINZ", licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). We only change its brightness. The credit shows in the credits box.

`make coastline` needs a free LINZ Data Service API key. Put it in `.env` (gitignored, copy `.env.example`) or export `LINZ_API_KEY`. The raw download is cached in `./cache`, also gitignored.

The hillshade needs a LINZ Basemaps API key in `VITE_LINZ_BASEMAPS_KEY` (in `.env`, see `.env.example`). Vite bakes it into the built site, so anyone loading the page can see it. Restrict the key to your domain when you deploy. Without a key the app still runs, on a plain dark background.

## Deploying to GitHub Pages

`.github/workflows/pages.yml` builds and publishes the site. It runs on every push to `main`, daily at 04:00 NZ time, and on demand from the Actions tab. Each run downloads the latest Metlink feed and the LINZ coastline, builds the data, then builds and deploys the site, so nothing generated is committed.

One-off setup:

1. In the repo, go to Settings > Pages and set Source to **GitHub Actions**.
2. Under Settings > Secrets and variables > Actions, add two repository secrets: `LINZ_API_KEY` (the LINZ Data Service key used by `make coastline`) and `VITE_LINZ_BASEMAPS_KEY` (the LINZ Basemaps key).
3. In your LINZ Basemaps account, restrict that key to your Pages domain (`<user>.github.io`). It ends up in the published JavaScript.

The workflow fails early if either secret is missing, instead of publishing a map with no basemap. Scheduled workflows are switched off by GitHub after 60 days without repo activity, so push something now and then, or the daily refresh stops.
