"""Azure Functions entrypoint for FastAPI HTTP traffic and platform queue workers."""

from __future__ import annotations

import asyncio
import json
import logging

import azure.functions as func

from app.main import app as fastapi_app
from app.platform.config import get_platform_settings, platform_is_configured
from app.platform.db import get_platform_session_factory
from app.platform.documents import process_document_index

LOGGER = logging.getLogger(__name__)
APP = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)


@APP.function_name(name="http_app")
@APP.route(route="{*route}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def http_app(req: func.HttpRequest, context: func.Context) -> func.HttpResponse:
    return await func.AsgiMiddleware(fastapi_app).handle_async(req, context)


if platform_is_configured():
    @APP.function_name(name="platform_document_index_worker")
    @APP.queue_trigger(arg_name="msg", queue_name=get_platform_settings().index_queue_name, connection="AzureWebJobsStorage")
    def platform_document_index_worker(msg: func.QueueMessage) -> None:
        payload = json.loads(msg.get_body().decode("utf-8"))
        document_id = str(payload.get("document_id") or "").strip()
        if not document_id:
            LOGGER.warning("Skipping platform document indexing message without document_id.")
            return
        session_factory = get_platform_session_factory()
        with session_factory() as session:
            result = asyncio.run(process_document_index(document_id, session))
        LOGGER.info("Platform document indexing result for %s: %s", document_id, result)
