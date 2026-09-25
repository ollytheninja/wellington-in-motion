GTFS_URL ?= https://static.opendata.metlink.org.nz/v1/gtfs/full.zip

.PHONY: help install refresh data dev build preview test check clean

help:
	@echo "make install   install dependencies"
	@echo "make refresh   download the latest Metlink GTFS into ./gtfs and rebuild the data"
	@echo "make data      build public/data from ./gtfs, if it changed"
	@echo "make dev       run the dev server on http://localhost:5173"
	@echo "make build     typecheck and build the static site into ./dist"
	@echo "make preview   serve the built site"
	@echo "make test      run unit tests"
	@echo "make check     typecheck and test"
	@echo "make clean     remove dist and generated data"

node_modules: package.json package-lock.json
	npm install
	@touch node_modules

install: node_modules

public/data/network.json: pipeline/build.ts pipeline/project.ts src/types.ts $(wildcard gtfs/*.txt) | node_modules
	@test -d gtfs || { echo "gtfs/ not found. Download the Metlink GTFS feed into ./gtfs first."; exit 1; }
	npm run data

# Downloads into a temp dir and only replaces ./gtfs once the zip has unpacked and looks right.
# ./gtfs and public/data are gitignored. Runs the pipeline directly because unpacked files keep
# their old timestamps, so make would think the data was up to date.
refresh: node_modules
	@set -e; tmp=$$(mktemp -d); trap 'rm -rf "$$tmp"' EXIT; \
	echo "Downloading $(GTFS_URL)"; \
	curl -fL --progress-bar -o "$$tmp/gtfs.zip" "$(GTFS_URL)"; \
	unzip -q "$$tmp/gtfs.zip" -d "$$tmp/gtfs"; \
	test -f "$$tmp/gtfs/stop_times.txt" || { echo "Zip does not look like a GTFS feed"; exit 1; }; \
	rm -rf gtfs; mv "$$tmp/gtfs" gtfs; \
	echo "Unpacked $$(ls gtfs | wc -l | tr -d ' ') files into ./gtfs"
	npm run data

data: public/data/network.json

dev: public/data/network.json
	npm run dev

build: public/data/network.json
	npm run build

preview: build
	npm run preview

test: node_modules
	npm test

check: node_modules
	npx tsc --noEmit
	npm test

clean:
	rm -rf dist public/data
