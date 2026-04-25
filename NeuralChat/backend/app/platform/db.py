from __future__ import annotations

from collections.abc import Generator
from functools import lru_cache

from fastapi import HTTPException, status
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_platform_settings, platform_is_configured, validate_platform_configuration


class Base(DeclarativeBase):
    pass


@lru_cache(maxsize=1)
def get_platform_engine():
    validate_platform_configuration()
    settings = get_platform_settings()
    return create_engine(settings.database_url, future=True, pool_pre_ping=True)


@lru_cache(maxsize=1)
def get_platform_session_factory():
    return sessionmaker(bind=get_platform_engine(), autoflush=False, autocommit=False, expire_on_commit=False, class_=Session)


def create_platform_schema() -> None:
    if not platform_is_configured():
        return
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=get_platform_engine())


def platform_dependency_guard() -> None:
    if not platform_is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Platform features are not configured. Set PLATFORM_DATABASE_URL and PLATFORM_MASTER_KEY.",
        )


def get_platform_session() -> Generator[Session, None, None]:
    platform_dependency_guard()
    session = get_platform_session_factory()()
    try:
        yield session
    finally:
        session.close()
