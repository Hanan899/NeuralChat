"""Authentication helpers for Clerk JWT verification."""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

from fastapi import Header, HTTPException, status
import jwt
from jwt import InvalidTokenError, PyJWKClient


class AuthConfigError(RuntimeError):
    """Raised when required auth configuration is missing."""


@lru_cache(maxsize=8)
def get_jwks_client(jwks_url: str) -> PyJWKClient:
    return PyJWKClient(jwks_url)


def get_auth_config() -> dict[str, str | None]:
    jwks_url = os.getenv("CLERK_JWKS_URL", "").strip()
    if not jwks_url:
        raise AuthConfigError("CLERK_JWKS_URL is required for authenticated endpoints.")

    issuer = os.getenv("CLERK_ISSUER", "").strip() or None
    audience = os.getenv("CLERK_AUDIENCE", "").strip() or None

    return {
        "jwks_url": jwks_url,
        "issuer": issuer,
        "audience": audience,
    }


def extract_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Authorization header.")

    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Authorization header format.")

    return parts[1].strip()


def verify_clerk_token(token: str) -> dict[str, Any]:
    try:
        config = get_auth_config()
    except AuthConfigError as error:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(error)) from error

    try:
        signing_key = get_jwks_client(str(config["jwks_url"]))\
            .get_signing_key_from_jwt(token)\
            .key

        options = {
            "verify_aud": config["audience"] is not None,
            "verify_iss": config["issuer"] is not None,
        }

        payload = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            audience=config["audience"],
            issuer=config["issuer"],
            options=options,
        )
    except InvalidTokenError as error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication token.") from error

    return payload


def require_user_id(authorization: str | None = Header(default=None, alias="Authorization")) -> str:
    token = extract_bearer_token(authorization)
    claims = verify_clerk_token(token)
    user_id = str(claims.get("sub", "")).strip()
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing subject claim.")
    return user_id
