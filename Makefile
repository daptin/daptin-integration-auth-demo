DAPTIN_BASE_URL ?= http://localhost:7336

.PHONY: install compile-site run-daptin-release up down logs setup publish restart verify clean

install:
	npm install

compile-site:
	npm run compile

run-daptin-release:
	npm run daptin:release

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f daptin

setup:
	npm run setup

publish: compile-site
	node scripts/publish-site.mjs

restart:
	docker compose restart daptin
	sleep 15

verify:
	npm run verify

clean:
	rm -rf dist node_modules daptin-data .demo-state.env
