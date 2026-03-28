import httpx
from fastapi.testclient import TestClient

from app import access
from app.access import AppFeature, AppRole, AccessContext, get_effective_access_payload, resolve_access_context_from_claims
from app.main import app
from app.services.cache import api_cache

client = TestClient(app)


def test_resolve_access_context_defaults_missing_role_to_user(monkeypatch):
    monkeypatch.delenv("OWNER_USER_IDS", raising=False)
    monkeypatch.delenv("OWNER_EMAILS", raising=False)

    patched_payloads: list[tuple[str, dict[str, object]]] = []

    def fake_fetch_clerk_user(user_id: str):
        assert user_id == "user_123"
        return {
            "id": user_id,
            "public_metadata": {},
            "email_addresses": [{"id": "primary", "email_address": "person@example.com"}],
            "primary_email_address_id": "primary",
        }

    def fake_patch_clerk_public_metadata(user_id: str, payload: dict[str, object]):
        patched_payloads.append((user_id, payload))
        return {
            "id": user_id,
            "public_metadata": {"role": "user"},
            "email_addresses": [{"id": "primary", "email_address": "person@example.com"}],
            "primary_email_address_id": "primary",
        }

    monkeypatch.setattr(access, "_fetch_clerk_user_sync", fake_fetch_clerk_user)
    monkeypatch.setattr(access, "_patch_clerk_public_metadata_sync", fake_patch_clerk_public_metadata)

    context = resolve_access_context_from_claims({"sub": "user_123"})

    assert context.role == AppRole.USER
    assert patched_payloads == [("user_123", {"role": "user"})]


def test_resolve_access_context_uses_seeded_owner(monkeypatch):
    monkeypatch.setenv("OWNER_EMAILS", "owner@example.com")
    monkeypatch.delenv("OWNER_USER_IDS", raising=False)
    monkeypatch.setattr(
        access,
        "_fetch_clerk_user_sync",
        lambda user_id: {
            "id": user_id,
            "public_metadata": {"role": "member"},
            "email_addresses": [{"id": "primary", "email_address": "owner@example.com"}],
            "primary_email_address_id": "primary",
        },
    )

    context = resolve_access_context_from_claims({"sub": "user_owner"}, initialize_defaults=False)

    assert context.role == AppRole.OWNER
    assert context.seeded_owner is True
    assert context.has_feature(AppFeature.BILLING_MANAGE) is True


def test_access_context_feature_overrides_take_priority():
    context = AccessContext(
        user_id="user_1",
        role=AppRole.USER,
        feature_overrides={
            AppFeature.PROJECT_CREATE: True,
            AppFeature.CHAT_CREATE: False,
        },
    )

    assert context.has_feature(AppFeature.PROJECT_CREATE) is True
    assert context.has_feature(AppFeature.CHAT_CREATE) is False
    assert context.has_feature(AppFeature.AGENT_RUN) is False


def test_patch_clerk_public_metadata_merges_nested_usage_limits(monkeypatch):
    api_cache.invalidate_prefix("access::user::")
    monkeypatch.setattr(access, "_get_clerk_secret_key", lambda required=False: "secret")
    monkeypatch.setattr(
        access,
        "_fetch_clerk_user_sync",
        lambda user_id: {
            "id": user_id,
            "public_metadata": {
                "role": "member",
                "usage_limits": {"monthly_limit_usd": 40},
            },
        },
    )

    captured_json: dict[str, object] = {}

    class FakeClient:
        def __init__(self, timeout: float):
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def patch(self, url: str, headers: dict[str, str], json: dict[str, object]):
            captured_json.update(json)
            return httpx.Response(200, json={"id": "user_1", "public_metadata": json["public_metadata"]})

    monkeypatch.setattr(access.httpx, "Client", FakeClient)

    updated_user = access._patch_clerk_public_metadata_sync("user_1", {"usage_limits": {"daily_limit_usd": 2.5}})

    assert captured_json == {
        "public_metadata": {
            "role": "member",
            "usage_limits": {"monthly_limit_usd": 40, "daily_limit_usd": 2.5},
        }
    }
    assert updated_user["public_metadata"]["usage_limits"] == {"monthly_limit_usd": 40, "daily_limit_usd": 2.5}


def test_usage_users_requires_owner(monkeypatch):
    monkeypatch.delenv("OWNER_EMAILS", raising=False)
    monkeypatch.delenv("OWNER_USER_IDS", raising=False)
    monkeypatch.setattr(access, "verify_clerk_token", lambda token: {"sub": "user_member"})
    monkeypatch.setattr(
        access,
        "_fetch_clerk_user_sync",
        lambda user_id: {
            "id": user_id,
            "public_metadata": {"role": "member"},
            "email_addresses": [{"id": "primary", "email_address": "member@example.com"}],
            "primary_email_address_id": "primary",
        },
    )

    response = client.get("/api/usage/users", headers={"Authorization": "Bearer token"})

    assert response.status_code == 403
    assert response.json()["detail"] == "This action requires owner access."


def test_usage_users_returns_data_for_owner(monkeypatch):
    monkeypatch.setenv("OWNER_USER_IDS", "user_owner")
    monkeypatch.delenv("OWNER_EMAILS", raising=False)
    monkeypatch.setattr(access, "verify_clerk_token", lambda token: {"sub": "user_owner"})
    monkeypatch.setattr(
        access,
        "_fetch_clerk_user_sync",
        lambda user_id: {
            "id": user_id,
            "public_metadata": {},
            "email_addresses": [{"id": "primary", "email_address": "owner@example.com"}],
            "primary_email_address_id": "primary",
        },
    )
    monkeypatch.setattr(
        access,
        "list_member_profiles",
        lambda include_usage=True: [
            access.MemberAccessProfile(
                user_id="user_owner",
                display_name="Owner",
                email="owner@example.com",
                role=AppRole.OWNER,
                role_label="Owner",
                feature_overrides={},
                effective_features=[feature.value for feature in AppFeature],
                usage_limits={"daily_limit_usd": 1.0, "monthly_limit_usd": 30.0},
                usage=None,
                seeded_owner=True,
            )
        ],
    )
    api_cache.invalidate_prefix("usage::users")

    response = client.get("/api/usage/users", headers={"Authorization": "Bearer token"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["users"][0]["role"] == "owner"
    assert payload["users"][0]["seeded_owner"] is True


def test_effective_access_payload_includes_effective_features():
    context = AccessContext(
        user_id="user_1",
        role=AppRole.MEMBER,
        feature_overrides={AppFeature.AGENT_RUN: False},
    )

    payload = get_effective_access_payload(context, profile={})

    assert payload["role"] == "member"
    assert "chat:create" in payload["effective_features"]
    assert "agent:run" not in payload["effective_features"]
