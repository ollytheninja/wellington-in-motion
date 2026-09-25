# trains

A dark-mode, glowing-dots map of every Wellington train over a 24 hour period, with a scrubbable timeline. Simulated from Metlink's published timetables first. Live data and buses come later.

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
- **Coastline.** Land Information New Zealand (LINZ), [NZ Coastlines (Topo, 1:50k)](https://data.linz.govt.nz/layer/50258-nz-coastlines-topo-150k/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). We clip it to the Wellington region and simplify it to 4 m. The app shows this credit in the map's attribution control, taken from `public/data/coastline.json`, so it stays with the data.
- **Basemap (optional).** [CARTO](https://carto.com/about-carto/) dark matter style, using data from [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.

`make coastline` needs a free LINZ Data Service API key. Put it in `.env` (gitignored, copy `.env.example`) or export `LINZ_API_KEY`. The raw download is cached in `./cache`, also gitignored.
