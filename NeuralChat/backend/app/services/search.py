"""Web search helpers for Tavily decisions, retrieval, and cache."""

from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from azure.core.exceptions import ResourceNotFoundError
from azure.storage.blob import BlobServiceClient, ContainerClient

from app.services.memory_blob import get_memory_blob_container

CACHE_MAX_AGE_HOURS = 24
MAX_SEARCH_RESULTS = 5
BASE_INSTRUCTIONS = (
    "You are NeuralChat. Give accurate, concise, user-first answers. "
    "When web search results are provided, cite supporting claims with inline numeric citations "
    "like [1], [2] that map to the provided Sources list order."
)

LOGGER = logging.getLogger(__name__)


# This helper normalizes user queries so cache keys stay stable across casing and spacing differences.
def _normalize_query(query: str) -> str:
    return " ".join(query.strip().lower().split())


# This helper creates a deterministic blob path for cached search results.
def _cache_blob_name(query: str) -> str:
    normalized_query = _normalize_query(query)
    query_hash = hashlib.sha256(normalized_query.encode("utf-8")).hexdigest()
    return f"search-cache/{query_hash}.json"


# This helper opens the memory container where search cache blobs are stored.
def _get_memory_container() -> ContainerClient:
    container_name = os.getenv("AZURE_BLOB_MEMORY_CONTAINER", "neurarchat-memory").strip() or "neurarchat-memory"
    if os.getenv("NEURALCHAT_STORAGE_MODE", "").strip().lower() == "memory":
        return get_memory_blob_container(container_name)  # type: ignore[return-value]

    connection_string = (
        os.getenv("AZURE_STORAGE_CONNECTION_STRING", "").strip()
        or os.getenv("AzureWebJobsStorage", "").strip()
    )
    if not connection_string:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING or AzureWebJobsStorage is required.")

    blob_service_client = BlobServiceClient.from_connection_string(connection_string)
    return blob_service_client.get_container_client(container_name)


# This function calls Tavily for web results and returns normalized title/url/snippet items.
def search_web(query: str) -> list[dict[str, str]]:
    tavily_api_key = os.getenv("TAVILY_API_KEY", "").strip()
    if not tavily_api_key:
        raise ValueError("TAVILY_API_KEY is required to enable web search.")

    payload = {
        "api_key": tavily_api_key,
        "query": query,
        "max_results": MAX_SEARCH_RESULTS,
        "search_depth": "basic",
        "include_answer": False,
    }

    try:
        with httpx.Client(timeout=15.0) as http_client:
            response = http_client.post("https://api.tavily.com/search", json=payload)
            response.raise_for_status()
            response_data = response.json()
    except Exception as tavily_error:
        raise RuntimeError(f"Tavily search request failed: {tavily_error}") from tavily_error

    raw_results = response_data.get("results", [])
    normalized_results: list[dict[str, str]] = []
    for result_item in raw_results[:MAX_SEARCH_RESULTS]:
        if not isinstance(result_item, dict):
            continue
        title = str(result_item.get("title", "")).strip()
        url = str(result_item.get("url", "")).strip()
        snippet = str(result_item.get("content", "") or result_item.get("snippet", "")).strip()
        if not title and not url and not snippet:
            continue
        normalized_results.append({"source_type": "web", "title": title, "url": url, "snippet": snippet})

    return normalized_results


# This function saves search results in blob cache with a timestamp to prevent duplicate Tavily calls.
def cache_search_results(query: str, results: list[dict[str, str]]) -> None:
    cache_container = _get_memory_container()
    blob_name = _cache_blob_name(query)
    blob_client = cache_container.get_blob_client(blob=blob_name)
    payload = {
        "query": _normalize_query(query),
        "timestamp": datetime.now(UTC).isoformat(),
        "results": results,
    }

    # COST NOTE: Cache writes reduce repeat Tavily calls and protect monthly free-tier quota.
    blob_client.upload_blob(
        json.dumps(payload, ensure_ascii=True, indent=2),
        overwrite=True,
        content_type="application/json",
    )


# This function reads cached results and returns None when cache is missing or older than 24 hours.
def load_cached_results(query: str) -> list[dict[str, str]] | None:
    cache_container = _get_memory_container()
    blob_name = _cache_blob_name(query)
    blob_client = cache_container.get_blob_client(blob=blob_name)

    try:
        raw_payload = blob_client.download_blob().readall().decode("utf-8")
    except ResourceNotFoundError:
        return None

    try:
        parsed_payload = json.loads(raw_payload)
    except json.JSONDecodeError:
        return None

    if not isinstance(parsed_payload, dict):
        return None

    timestamp_value = parsed_payload.get("timestamp", "")
    if not isinstance(timestamp_value, str) or not timestamp_value.strip():
        return None

    try:
        cached_time = datetime.fromisoformat(timestamp_value)
        if cached_time.tzinfo is None:
            cached_time = cached_time.replace(tzinfo=UTC)
    except ValueError:
        return None

    now_time = datetime.now(UTC)
    if now_time - cached_time > timedelta(hours=CACHE_MAX_AGE_HOURS):
        return None

    results = parsed_payload.get("results", [])
    if not isinstance(results, list):
        return None

    normalized_results: list[dict[str, str]] = []
    for result_item in results[:MAX_SEARCH_RESULTS]:
        if not isinstance(result_item, dict):
            continue
        title = str(result_item.get("title", "")).strip()
        url = str(result_item.get("url", "")).strip()
        snippet = str(result_item.get("snippet", "")).strip()
        normalized_results.append({"source_type": "web", "title": title, "url": url, "snippet": snippet})

    return normalized_results


# This function formats web results into a compact prompt block for GPT context injection.
def format_search_context(results: list[dict[str, str]]) -> str:
    if not results:
        return ""

    lines: list[str] = ["Web search results:"]
    for index, result_item in enumerate(results[:MAX_SEARCH_RESULTS], start=1):
        title = result_item.get("title", "")
        url = result_item.get("url", "")
        snippet = result_item.get("snippet", "")
        lines.append(f"{index}. [{title}]({url})")
        if snippet:
            lines.append(f"   {snippet}")

    return "\n".join(lines)
