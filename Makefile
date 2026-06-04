COMPOSE = docker compose

.PHONY: up down shell build crawl test typecheck lint format style merge logs

up:
	$(COMPOSE) up -d app

down:
	$(COMPOSE) down

shell:
	$(COMPOSE) exec app bash

build:
	$(COMPOSE) build app

crawl:
	$(COMPOSE) run --rm app npm run crawl -- $(ARGS)

test:
	$(COMPOSE) run --profile tools --rm test

typecheck:
	$(COMPOSE) run --profile tools --rm typecheck

lint:
	$(COMPOSE) run --rm app npm run lint

format:
	$(COMPOSE) run --rm app npm run format

style:
	$(COMPOSE) run --rm app npm run style

merge:
	$(COMPOSE) run --rm app npm run merge-to-jsonl

logs:
	$(COMPOSE) logs -f app
