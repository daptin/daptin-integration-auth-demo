DAPTIN_BASE_URL ?= http://localhost:7336

.PHONY: install compile-site run-daptin-release up down logs setup publish restart verify clean

install:
	npm install

compile-site:
	npm run compile

run-daptin-release:
	./scripts/run-release.sh

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f daptin

setup:
	./scripts/setup.sh

publish: compile-site
	./scripts/publish-site.sh

restart:
	docker compose restart daptin
	sleep 15

verify:
	./scripts/verify-manual-state.sh

clean:
	rm -rf dist node_modules daptin-data .demo-state.env
