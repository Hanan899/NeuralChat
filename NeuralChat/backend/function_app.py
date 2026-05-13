"""Azure Functions entrypoint for FastAPI HTTP traffic."""

from __future__ import annotations

import azure.functions as func

from app.main import app as fastapi_app
APP = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)


@APP.function_name(name="http_app")
@APP.route(route="{*route}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def http_app(req: func.HttpRequest, context: func.Context) -> func.HttpResponse:
    return await func.AsgiMiddleware(fastapi_app).handle_async(req, context)
