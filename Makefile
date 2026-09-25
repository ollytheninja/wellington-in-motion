.PHONY: help install data dev build preview test check clean

help:
	@echo "make install   install dependencies"
	@echo "make data      build public/data/network.json from ./gtfs"
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
