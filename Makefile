DAPTIN_BASE_URL ?= http://localhost:7336

.PHONY: install build run-daptin-source up down logs setup publish restart verify clean

install:
	npm install

build:
	npm run build

run-daptin-source:
	mkdir -p "$(CURDIR)/daptin-data/storage" "$(CURDIR)/daptin-data/cache"
	cd $${DAPTIN_SOURCE_DIR:-../daptin} && \
		DAPTIN_DB_CONNECTION_STRING="$(CURDIR)/daptin-data/daptin.db" \
		DAPTIN_LOCAL_STORAGE_PATH="$(CURDIR)/daptin-data/storage" \
		DAPTIN_CACHE_FOLDER="$(CURDIR)/daptin-data/cache" \
		go run . -runtime release -port :7336

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f daptin

setup:
	./scripts/setup.sh

publish: build
	./scripts/publish-site.sh

restart:
	docker compose restart daptin
	sleep 15

verify:
	./scripts/verify-manual-state.sh

clean:
	rm -rf dist node_modules daptin-data .demo-state.env
