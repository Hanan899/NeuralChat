from __future__ import annotations

import base64
import json
import os
from functools import lru_cache
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import get_platform_settings


def _decode_master_key(raw_key: str) -> bytes:
    padded = raw_key.encode("utf-8") + b"=" * (-len(raw_key) % 4)
    decoded = base64.urlsafe_b64decode(padded)
    if len(decoded) != 32:
        raise RuntimeError("PLATFORM_MASTER_KEY must decode to exactly 32 bytes.")
    return decoded


@lru_cache(maxsize=1)
def _get_aesgcm() -> AESGCM:
    settings = get_platform_settings()
    if not settings.master_key:
        raise RuntimeError("PLATFORM_MASTER_KEY is required for platform secret encryption.")
    return AESGCM(_decode_master_key(settings.master_key))


def encrypt_secret(plaintext: str) -> str:
    if not plaintext:
        return ""
    nonce = os.urandom(12)
    ciphertext = _get_aesgcm().encrypt(nonce, plaintext.encode("utf-8"), None)
    payload = {
        "nonce": base64.urlsafe_b64encode(nonce).decode("utf-8"),
        "ciphertext": base64.urlsafe_b64encode(ciphertext).decode("utf-8"),
    }
    return json.dumps(payload, ensure_ascii=True)


def decrypt_secret(payload: str | None) -> str:
    if not payload:
        return ""
    parsed = json.loads(payload)
    nonce = base64.urlsafe_b64decode(str(parsed["nonce"]).encode("utf-8"))
    ciphertext = base64.urlsafe_b64decode(str(parsed["ciphertext"]).encode("utf-8"))
    plaintext = _get_aesgcm().decrypt(nonce, ciphertext, None)
    return plaintext.decode("utf-8")


def redact_secret(value: str | None) -> str | None:
    if not value:
        return None
    return "********"


def dump_secret_json(data: dict[str, Any] | None) -> str:
    if not data:
        return ""
    return encrypt_secret(json.dumps(data, ensure_ascii=True))


def load_secret_json(data: str | None) -> dict[str, Any]:
    if not data:
        return {}
    raw_text = decrypt_secret(data)
    parsed = json.loads(raw_text)
    return parsed if isinstance(parsed, dict) else {}
