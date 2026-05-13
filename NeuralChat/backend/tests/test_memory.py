from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.services import memory


async def run_immediately(function, *args, **kwargs):
    return function(*args, **kwargs)


@pytest.mark.asyncio
async def test_process_memory_update_ignores_untrusted_third_party_name():
    save_profile_mock = MagicMock()
    log_usage_mock = MagicMock()

    with (
        patch("app.services.memory.load_profile", return_value={}),
        patch(
            "app.services.memory.get_usage_status",
            return_value={
                "daily": {"spent_usd": 0.1, "limit_usd": 1.0, "remaining_usd": 0.9, "percentage_used": 10.0, "warning_triggered": False, "limit_exceeded": False},
                "monthly": {"spent_usd": 1.0, "limit_usd": 30.0, "remaining_usd": 29.0, "percentage_used": 3.33, "warning_triggered": False, "limit_exceeded": False},
                "blocked": False,
                "blocking_period": None,
                "blocking_message": "",
            },
        ),
        patch(
            "app.services.memory.extract_facts_with_usage",
            return_value=({"name": "Muhammad Taha Raja"}, {"input_tokens": 100, "output_tokens": 50}),
        ),
        patch("app.services.memory.save_profile", save_profile_mock),
        patch("app.services.memory.log_usage", log_usage_mock),
        patch("app.services.memory.asyncio.to_thread", side_effect=run_immediately),
    ):
        await memory.process_memory_update(
            "user_123",
            "tell me about taha raja",
            "Taha Raja is a public figure.",
            "Abdul Hanan",
        )

    save_profile_mock.assert_not_called()
    log_usage_mock.assert_called_once_with("user_123", "memory", 100, 50, "Abdul Hanan")


@pytest.mark.asyncio
async def test_process_memory_update_saves_explicit_user_name():
    save_profile_mock = MagicMock()

    with (
        patch("app.services.memory.load_profile", return_value={}),
        patch(
            "app.services.memory.get_usage_status",
            return_value={
                "daily": {"spent_usd": 0.1, "limit_usd": 1.0, "remaining_usd": 0.9, "percentage_used": 10.0, "warning_triggered": False, "limit_exceeded": False},
                "monthly": {"spent_usd": 1.0, "limit_usd": 30.0, "remaining_usd": 29.0, "percentage_used": 3.33, "warning_triggered": False, "limit_exceeded": False},
                "blocked": False,
                "blocking_period": None,
                "blocking_message": "",
            },
        ),
        patch(
            "app.services.memory.extract_facts_with_usage",
            return_value=({"name": "Abdul Hanan"}, {"input_tokens": 100, "output_tokens": 50}),
        ),
        patch("app.services.memory.save_profile", save_profile_mock),
        patch("app.services.memory.log_usage"),
        patch("app.services.memory.asyncio.to_thread", side_effect=run_immediately),
    ):
        await memory.process_memory_update(
            "user_123",
            "my name is Abdul Hanan",
            "Nice to meet you, Abdul Hanan.",
            "Abdul Hanan",
        )

    save_profile_mock.assert_called_once_with(
        "user_123",
        {"name": "Abdul Hanan", "name_verified": True},
        "Abdul Hanan",
    )


def test_build_memory_prompt_does_not_use_unverified_conflicting_name():
    with patch(
        "app.services.memory.load_profile",
        return_value={"name": "Muhammad Taha Raja", "job": "Engineer"},
    ):
        prompt = memory.build_memory_prompt("user_123", "Abdul Hanan")

    assert "Authenticated user display name: Abdul Hanan." in prompt
    assert "name=Muhammad Taha Raja" not in prompt
    assert "job=Engineer" in prompt


def test_build_memory_prompt_keeps_verified_preferred_name():
    with patch(
        "app.services.memory.load_profile",
        return_value={"name": "Ali", "name_verified": True, "job": "Engineer"},
    ):
        prompt = memory.build_memory_prompt("user_123", "Abdul Hanan")

    assert "name=Ali" in prompt
    assert "job=Engineer" in prompt


def test_upsert_profile_key_marks_manual_name_as_verified():
    with (
        patch("app.services.memory.load_profile", return_value={}),
        patch("app.services.memory._write_profile") as write_profile_mock,
    ):
        memory.upsert_profile_key("user_123", "name", "Ali", "Abdul Hanan")

    write_payload = write_profile_mock.call_args.args[1]
    assert write_payload["name"] == "Ali"
    assert write_payload["name_verified"] is True
