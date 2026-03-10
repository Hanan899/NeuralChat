"""Azure Functions entrypoint.

Explain this code:
- Azure Functions hosts this app.
- We expose a FastAPI app through AsgiFunctionApp so local development is easy.
"""

import azure.functions as func

from app.main import app as fastapi_app

app = func.AsgiFunctionApp(app=fastapi_app, http_auth_level=func.AuthLevel.ANONYMOUS)
