.PHONY: dev frontend-start publish-backend backend-bootstrap backend-test frontend-test test

PYTHON ?= python3

dev:
	@echo "Run these in separate terminals:"
	@echo "make backend-start"
	@echo "make frontend-start"

frontend-start:
	./start-frontend.sh

publish-backend:
	./publish-backend.sh

backend/.venv/bin/python:
	cd backend && $(PYTHON) -m venv .venv

backend-bootstrap: backend/.venv/bin/python
	backend/.venv/bin/python -m pip install --upgrade pip
	backend/.venv/bin/python -m pip install -r backend/requirements.txt

backend-test: backend-bootstrap
	cd backend && NEURALCHAT_STORAGE_MODE=memory NEURALCHAT_DISABLE_CLERK_API=1 ./.venv/bin/pytest -q

frontend-test:
	cd frontend && npm test

test: backend-test frontend-test
