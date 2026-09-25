# trains

A dark-mode, glowing-dots map of every Wellington train over a 24 hour period, with a scrubbable timeline. Simulated from Metlink's published timetables first. Live data and buses come later.

Inspiration: https://lnkd.in/p/ey5qq6ds (an animation of every train in the Netherlands over 24 hours, in a Gource-like style).

Docs:

- [docs/architecture.md](docs/architecture.md) covers the end goal, the MVP, the data pipeline, the runtime and the tech choices.
- [docs/inspiration.md](docs/inspiration.md) covers the visual target.

## Run it

```
# put the Metlink GTFS files in ./gtfs (see docs/architecture.md), then:
make dev          # installs, builds the data if needed, serves http://localhost:5173
make test
make build        # static site in ./dist
make help         # everything else
```

Space toggles play/pause. Drag the slider to scrub. The date picker covers the days the feed covers.
