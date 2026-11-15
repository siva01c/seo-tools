COMPOSE = docker compose

.PHONY: up down shell build crawl test typecheck lint format style merge logs mcp-deploy mcp-check

# The `mcp` container runs the image it was created from: after a change in src/ it keeps serving
# the old code until the image is rebuilt and the container recreated. Run this after every pull.
# Plain `docker compose` (no -f) also picks up a docker-compose.override.yml next to this file, so
# a deployment overlay kept there is applied on every redeploy.
mcp-deploy:
	$(COMPOSE) build mcp
	$(COMPOSE) up -d mcp
	$(MAKE) mcp-check

# Fails when the running MCP server does not offer exactly the tools defined in src/mcpTools.ts.
mcp-check:
	$(COMPOSE) run --rm --no-deps app npx tsx scripts/check-mcp-tools.ts

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
	$(COMPOSE) --profile tools run --rm test

typecheck:
	$(COMPOSE) --profile tools run --rm typecheck

lint:
	$(COMPOSE) run --rm app npm run lint

format:
	$(COMPOSE) run --rm -u 0 app npm run format

style:
	$(COMPOSE) run --rm app npm run style

merge:
	$(COMPOSE) run --rm app npm run merge-to-jsonl

logs:
	$(COMPOSE) logs -f app
