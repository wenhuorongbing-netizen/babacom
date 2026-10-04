from datetime import datetime, timedelta

import jwt
import pytest
from livekit.api import TokenVerifier
from tokens.local_service import running_service


def test_authenticated_member_prepares_normalized_name(http_service):
    response = http_service.post(display_name="  e\u0301 玩家 🎮  ")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert set(body) == {
        "livekitUrl",
        "roomName",
        "participantIdentity",
        "displayName",
        "accessToken",
        "expiresAt",
    }
    assert body["displayName"] == "é 玩家 🎮"
    assert body["participantIdentity"] == http_service.subject
    assert body["roomName"] == "t1-room"
    claims = jwt.decode(
        body["accessToken"],
        http_service.secret,
        algorithms=["HS256"],
        issuer=http_service.api_key,
    )
    assert claims["sub"] == http_service.subject
    assert claims["exp"] - claims["nbf"] == 120
    assert datetime.fromisoformat(body["expiresAt"]).timestamp() == claims["exp"]
    assert body["expiresAt"].endswith("Z")
    assert claims["video"] == {
        "room": "t1-room",
        "roomJoin": True,
        "canSubscribe": True,
        "canPublish": True,
        "canPublishSources": ["microphone"],
        "canPublishData": False,
    }
    verified = TokenVerifier(
        http_service.api_key, http_service.secret, leeway=timedelta(0)
    ).verify(body["accessToken"])
    assert verified.identity == http_service.subject
    assert verified.video.room == "t1-room"
    assert verified.video.can_publish_sources == ["microphone"]
    assert verified.video.can_publish_data is False


@pytest.mark.parametrize(
    "name",
    [
        "",
        " " * 32,
        "界" * 33,
        "x" * 257,
        "\t名",
        "\u200b名",
        "\ufeff名",
        "\u061c名",
        "\u202e名",
        "\u2066名",
        "\ud800",
        "\u2003",
    ],
)
def test_invalid_names_have_filtered_failures(http_service, name):
    response = http_service.post(display_name=name)
    assert response.status_code == 422
    assert response.json() == {
        "code": "INVALID_REQUEST",
        "message": "Admission could not be prepared",
    }
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("name", ["名", "🎮" * 32, "A<B>", "  e\u0301  "])
def test_valid_names_keep_authenticated_identity(http_service, name):
    first = http_service.post(display_name=name)
    second = http_service.post(display_name="另一昵称")
    assert first.status_code == second.status_code == 200
    assert first.json()["participantIdentity"] == second.json()["participantIdentity"]


def test_missing_session_and_unapproved_room_cannot_prepare(http_service):
    assert http_service.post(authenticated=False).status_code == 401
    assert http_service.post(room_name="other-room").status_code == 403
    response = http_service.client.post(
        "/api/v1/tokens/media",
        headers={"Authorization": "Bearer invalid"},
        json={"roomName": "t1-room", "displayName": "名"},
    )
    assert response.status_code == 401
    assert "accessToken" not in response.text


def test_each_required_permission_is_enforced():
    actions = {"room.join", "media.subscribe", "media.publish.microphone"}
    for missing in actions:
        with running_service(actions=actions - {missing}) as service:
            response = service.post()
            assert response.status_code == 403
            assert "accessToken" not in response.text


def test_client_identity_and_extra_fields_are_rejected(http_service):
    response = http_service.client.post(
        "/api/v1/tokens/media",
        headers={"Authorization": "Bearer " + http_service.session},
        json={"roomName": "t1-room", "displayName": "名", "identity": "forged"},
    )
    assert response.status_code == 422
    response = http_service.client.post(
        "/api/v1/tokens/media",
        headers={
            "Authorization": "Bearer " + http_service.session,
            "X-Subject-Id": "forged",
        },
        json={"roomName": "t1-room", "displayName": "名"},
    )
    assert response.status_code == 200
    assert response.json()["participantIdentity"] == http_service.subject


@pytest.mark.parametrize(
    ("content", "status"),
    [
        (b"{", 400),
        (b"\xff", 400),
        (b'{"roomName":"t1-room","roomName":"forged","displayName":"A"}', 400),
        (b"x" * 4097, 413),
        (b"[]", 422),
    ],
    ids=[
        "broken-json",
        "invalid-utf8",
        "duplicate-field",
        "oversized-body",
        "wrong-shape",
    ],
)
def test_body_errors_do_not_echo_content_or_credentials(http_service, content, status):
    response = http_service.client.post(
        "/api/v1/tokens/media",
        headers={
            "Authorization": "Bearer " + http_service.session,
            "Content-Type": "application/json",
        },
        content=content,
    )
    assert response.status_code == status
    assert set(response.json()) == {"code", "message"}
    assert response.headers["cache-control"] == "no-store"
    for secret in (http_service.secret, http_service.session):
        assert secret not in response.text


def test_normal_entry_refuses_missing_providers():
    import subprocess
    import sys

    result = subprocess.run(
        [sys.executable, "-m", "app.main"], capture_output=True, text=True, timeout=10
    )
    assert result.returncode != 0
    assert "Authentication and authorization providers are required" in result.stderr
    assert "Traceback" not in result.stderr


@pytest.mark.parametrize("settings", [{"host": "0.0.0.0"}, {"workers": 2}])
def test_fixture_rejects_external_binding_and_multiple_workers(settings):
    with pytest.raises(ValueError, match="loopback and one worker"):
        with running_service(**settings):
            pytest.fail("Unsafe fixture started")
