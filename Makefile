.PHONY: up down logs seed backend frontend test fmt

up:            ## Build & start the full stack
	docker compose up --build

down:          ## Stop the stack
	docker compose down

logs:          ## Tail backend logs
	docker compose logs -f backend

seed:          ## Load synthetic data
	docker compose exec backend python -m seed.load_seed

embed:         ## Populate narratives.embedding + build the HNSW index (required for RAG)
	docker compose exec backend python -m seed.embed_narratives

backend:       ## Run backend locally (needs local Postgres/Redis)
	cd backend && uvicorn app.main:app --reload

frontend:      ## Run frontend locally
	cd frontend && bun run dev

test:          ## Run backend tests
	cd backend && pytest -q

fmt:           ## Format frontend
	cd frontend && bun run format
