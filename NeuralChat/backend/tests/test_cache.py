import time

from fastapi.testclient import TestClient

from app.main import app
from app.services.cache import InMemoryCache, api_cache

client = TestClient(app)


def test_in_memory_cache_returns_value_before_expiry():
    cache = InMemoryCache(max_entries=2)
    cache.set("alpha", {"value": 1}, ttl_seconds=1)

    assert cache.get("alpha") == {"value": 1}


def test_in_memory_cache_expires_values():
    cache = InMemoryCache(max_entries=2)
    cache.set("alpha", "value", ttl_seconds=1)

    time.sleep(1.05)

    assert cache.get("alpha") is None


def test_in_memory_cache_evicts_oldest_entry_when_full():
    cache = InMemoryCache(max_entries=2)
    cache.set("alpha", 1, ttl_seconds=30)
    cache.set("beta", 2, ttl_seconds=30)
    cache.set("gamma", 3, ttl_seconds=30)

    assert cache.get("alpha") is None
    assert cache.get("beta") == 2
    assert cache.get("gamma") == 3


def test_project_templates_endpoint_returns_cache_headers():
    api_cache.invalidate_prefix("public::project-templates")

    first_response = client.get("/api/projects/templates")
    second_response = client.get("/api/projects/templates")

    assert first_response.status_code == 200
    assert first_response.headers["X-Cache"] == "MISS"
    assert second_response.status_code == 200
    assert second_response.headers["X-Cache"] == "HIT"


def test_keep_warm_endpoint_returns_fast_status_payload():
    response = client.get("/api/keep-warm")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "warm"
    assert isinstance(payload["timestamp"], int)
