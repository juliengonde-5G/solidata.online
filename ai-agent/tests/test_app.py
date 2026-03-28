"""
Tests SolidataBot — pytest + mocks Claude API & DB
Usage : cd ai-agent && pytest tests/ -v
"""

import json
import os
import sys
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import jwt as pyjwt
import pytest

# Patch env before importing app
os.environ["ANTHROPIC_API_KEY"] = "sk-test-key"
os.environ["JWT_SECRET"] = "test-secret"
os.environ["REDIS_URL"] = "redis://localhost:6379/1"
os.environ["DATABASE_URL"] = "postgresql://test:test@localhost:5432/test"

# Mock redis and sqlalchemy before import
mock_redis = MagicMock()
mock_redis.get.return_value = None
mock_redis.incr.return_value = 1
mock_redis.ping.return_value = True

with patch("redis.from_url", return_value=mock_redis), \
     patch("sqlalchemy.create_engine") as mock_engine:
    mock_conn = MagicMock()
    mock_engine.return_value.connect.return_value.__enter__ = lambda s: mock_conn
    mock_engine.return_value.connect.return_value.__exit__ = MagicMock()
    from app import app, TOOLS, SYSTEM_PROMPT


# ── Fixtures ─────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


@pytest.fixture
def auth_token():
    payload = {
        "userId": 1,
        "role": "ADMIN",
        "username": "testuser",
        "exp": datetime.utcnow() + timedelta(hours=1),
    }
    return pyjwt.encode(payload, "test-secret", algorithm="HS256")


@pytest.fixture
def collab_token():
    payload = {
        "userId": 42,
        "role": "COLLABORATEUR",
        "username": "collab",
        "exp": datetime.utcnow() + timedelta(hours=1),
    }
    return pyjwt.encode(payload, "test-secret", algorithm="HS256")


# ── Test Health ──────────────────────────────────────────────────────────

def test_health_endpoint(client):
    with patch("app.engine") as mock_eng, \
         patch("app.redis_client") as mock_r:
        mock_r.ping.return_value = True
        mock_ctx = MagicMock()
        mock_eng.connect.return_value.__enter__ = lambda s: mock_ctx
        mock_eng.connect.return_value.__exit__ = MagicMock()
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "ok"


# ── Test Auth ────────────────────────────────────────────────────────────

def test_chat_no_token(client):
    resp = client.post("/chat", json={"message": "Salut"})
    assert resp.status_code == 401


def test_chat_invalid_token(client):
    resp = client.post(
        "/chat",
        json={"message": "Salut"},
        headers={"Authorization": "Bearer invalid-token"},
    )
    assert resp.status_code == 401


def test_chat_expired_token(client):
    payload = {
        "userId": 1,
        "role": "ADMIN",
        "exp": datetime.utcnow() - timedelta(hours=1),
    }
    token = pyjwt.encode(payload, "test-secret", algorithm="HS256")
    resp = client.post(
        "/chat",
        json={"message": "Salut"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 401


# ── Test Chat ────────────────────────────────────────────────────────────

def test_chat_empty_message(client, auth_token):
    resp = client.post(
        "/chat",
        json={"message": ""},
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert resp.status_code == 400


def test_chat_missing_message(client, auth_token):
    resp = client.post(
        "/chat",
        json={},
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert resp.status_code == 400


def test_chat_success(client, auth_token):
    """Test successful chat with mocked Claude API (no tool use)."""
    mock_text_block = MagicMock()
    mock_text_block.type = "text"
    mock_text_block.text = "Salut ! Comment je peux t'aider ? 👋"

    mock_response = MagicMock()
    mock_response.content = [mock_text_block]

    with patch("app.claude") as mock_claude, \
         patch("app.redis_client") as mock_r:
        mock_r.get.return_value = None
        mock_r.incr.return_value = 1
        mock_claude.messages.create.return_value = mock_response

        resp = client.post(
            "/chat",
            json={"message": "Salut !"},
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert "reply" in data
        assert "session_id" in data
        assert "Salut" in data["reply"]


def test_chat_with_tool_use(client, auth_token):
    """Test chat where Claude calls a tool (query_stock)."""
    # First response: tool use
    mock_tool_block = MagicMock()
    mock_tool_block.type = "tool_use"
    mock_tool_block.name = "query_stock"
    mock_tool_block.input = {"categorie": "crème"}
    mock_tool_block.id = "tool_123"

    mock_response_1 = MagicMock()
    mock_response_1.content = [mock_tool_block]

    # Second response: text after tool result
    mock_text_block = MagicMock()
    mock_text_block.type = "text"
    mock_text_block.text = "Stock crème : 250 kg 📦"

    mock_response_2 = MagicMock()
    mock_response_2.content = [mock_text_block]

    mock_row = MagicMock()
    mock_row._mapping = {"categorie": "crème", "stock_kg": 250.0}

    with patch("app.claude") as mock_claude, \
         patch("app.redis_client") as mock_r, \
         patch("app.engine") as mock_eng:
        mock_r.get.return_value = None
        mock_r.incr.return_value = 1
        mock_claude.messages.create.side_effect = [mock_response_1, mock_response_2]

        mock_conn = MagicMock()
        mock_conn.execute.return_value = [mock_row]
        mock_eng.connect.return_value.__enter__ = lambda s: mock_conn
        mock_eng.connect.return_value.__exit__ = MagicMock(return_value=False)

        resp = client.post(
            "/chat",
            json={"message": "Stock crème ?"},
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert "250" in data["reply"]


# ── Test Rate Limiting ───────────────────────────────────────────────────

def test_rate_limit(client, auth_token):
    mock_text_block = MagicMock()
    mock_text_block.type = "text"
    mock_text_block.text = "OK"

    mock_response = MagicMock()
    mock_response.content = [mock_text_block]

    with patch("app.claude") as mock_claude, \
         patch("app.redis_client") as mock_r:
        mock_r.get.return_value = None
        mock_r.incr.return_value = 25  # Over limit
        mock_claude.messages.create.return_value = mock_response

        resp = client.post(
            "/chat",
            json={"message": "Test rate limit"},
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert resp.status_code == 429


# ── Test Tools Definition ────────────────────────────────────────────────

def test_tools_valid():
    """Verify all tools have required fields."""
    assert len(TOOLS) >= 4
    for tool in TOOLS:
        assert "name" in tool
        assert "description" in tool
        assert "input_schema" in tool
        assert tool["input_schema"]["type"] == "object"


def test_system_prompt_french():
    """System prompt must be in French and mention SolidataBot."""
    assert "SolidataBot" in SYSTEM_PROMPT
    assert "français" in SYSTEM_PROMPT.lower() or "Réponds" in SYSTEM_PROMPT


# ── Test Index Page ──────────────────────────────────────────────────────

def test_index_page(client):
    resp = client.get("/")
    assert resp.status_code == 200
    assert b"SolidataBot" in resp.data


# ── Test Dev Token (non-production) ──────────────────────────────────────

def test_dev_token(client):
    resp = client.post("/dev/token", json={"user_id": 1, "role": "ADMIN"})
    assert resp.status_code == 200
    data = resp.get_json()
    assert "token" in data
