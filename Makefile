.PHONY: help setup dev dev-frontend dev-backend check test lint typecheck build format

PYTHON ?= $(shell command -v python3.13 || command -v python3.12)
VENV := backend/.venv
BIN := $(CURDIR)/$(VENV)/bin

help: ## Show available commands
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  %-14s %s\n", $$1, $$2}'

setup: ## Install all dependencies and create local env files
	@test -n "$(PYTHON)" || (echo "Python 3.12 or 3.13 is required." && exit 1)
	test -d $(VENV) || $(PYTHON) -m venv $(VENV)
	$(BIN)/pip install -q -e "backend[dev]"
	cd frontend && npm install --no-audit --no-fund
	test -f backend/.env || cp backend/.env.example backend/.env
	test -f frontend/.env.local || cp frontend/.env.example frontend/.env.local

dev: ## Run frontend (port 3000) and backend (port 8000) together
	./scripts/dev.sh

dev-frontend: ## Run only the frontend. Demo mode works without the backend
	cd frontend && npm run dev

dev-backend: ## Run only the backend
	cd backend && $(BIN)/uvicorn app.main:app --reload --port 8000

test: ## Run all tests
	cd backend && $(BIN)/pytest
	cd frontend && npm test

lint: ## Lint and check formatting
	cd backend && $(BIN)/ruff check . && $(BIN)/ruff format --check .
	cd frontend && npm run lint

typecheck: ## Type-check both projects
	cd backend && $(BIN)/mypy
	cd frontend && npm run typecheck

build: ## Build the frontend for production
	cd frontend && npm run build

check: lint typecheck test build ## Run everything CI should run

format: ## Auto-format backend code
	cd backend && $(BIN)/ruff format . && $(BIN)/ruff check --fix .
