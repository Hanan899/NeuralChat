import os

import pytest


os.environ.setdefault("NEURALCHAT_STORAGE_MODE", "memory")
os.environ.setdefault("NEURALCHAT_DISABLE_CLERK_API", "1")


@pytest.fixture(autouse=True)
def default_access_context_for_feature_routes(request):
    from app.services.cache import api_cache

    api_cache.invalidate_prefix("")

    if request.module.__name__.endswith("test_access"):
        yield
        return

    from app.access import AccessContext, AppRole, get_access_context
    from app.auth import require_user_id
    from app.main import app

    previous_override = app.dependency_overrides.get(get_access_context)

    def _current_user_id() -> str:
        override = app.dependency_overrides.get(require_user_id)
        if override is None:
            return "user_123"
        try:
            return str(override())
        except TypeError:
            return "user_123"

    def _get_test_access_context() -> AccessContext:
        user_id = _current_user_id()
        return AccessContext(
            user_id=user_id,
            role=AppRole.OWNER,
            display_name="Test User",
            email="test@example.com",
        )

    app.dependency_overrides[get_access_context] = _get_test_access_context
    yield

    if previous_override is None:
        app.dependency_overrides.pop(get_access_context, None)
    else:
        app.dependency_overrides[get_access_context] = previous_override
