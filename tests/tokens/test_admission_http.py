import logging
from datetime import datetime, timedelta

import jwt
import pytest
from livekit.api import TokenVerifier
from tokens.local_service import FixtureInputs, running_service


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
        "\u200e名",
        "\u200f名",
        "\u202a名",
        "\u202b名",
        "\u202c名",
        "\u202d名",
        "\u2067名",
        "\u2068名",
        "\u2069名",
        "名\x00",
        "名\x7f",
        " " * 256 + "名",
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


@pytest.mark.parametrize(
    ("name", "normalized"),
    [
        ("名", "名"),
        ("🎮" * 32, "🎮" * 32),
        ("A<B>", "A<B>"),
        ("<img src=x onerror=alert(1)>", "<img src=x onerror=alert(1)>"),
        ("  e\u0301  ", "é"),
        ("e\u0301" * 32, "é" * 32),
        (" " * 255 + "名", "名"),
        ("\u2003名\u2003", "\u2003名\u2003"),
        ("👨\u200d👩\u200d👧", "👨\u200d👩\u200d👧"),
    ],
)
def test_valid_names_keep_authenticated_identity(http_service, name, normalized):
    first = http_service.post(display_name=name)
    second = http_service.post(display_name="另一昵称")
    assert first.status_code == second.status_code == 200
    assert first.json()["displayName"] == normalized
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


@pytest.mark.parametrize(
    "field",
    [
        "identity",
        "participantIdentity",
        "subjectId",
        "role",
        "permissions",
        "accessToken",
    ],
)
def test_client_identity_and_extra_fields_are_rejected(http_service, field):
    response = http_service.client.post(
        "/api/v1/tokens/media",
        headers={"Authorization": "Bearer " + http_service.session},
        json={"roomName": "t1-room", "displayName": "名", field: "forged"},
    )
    assert response.status_code == 422
    assert response.json() == {
        "code": "INVALID_REQUEST",
        "message": "Admission could not be prepared",
    }
    assert "accessToken" not in response.text
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
        (b'{"roomName":"t1-room","displayName":NaN}', 400),
        (b'{"roomName":"t1-room","displayName":Infinity}', 400),
        (b'{"roomName":"t1-room","displayName":"A","displayName":"B"}', 400),
        (b'{"roomName":"t1-room","displayName":"A"} trailing', 400),
        (b"[" * 1100 + b"0", 400),
    ],
    ids=[
        "broken-json",
        "invalid-utf8",
        "duplicate-field",
        "oversized-body",
        "wrong-shape",
        "nan",
        "infinity",
        "duplicate-nickname",
        "trailing-data",
        "unterminated-deep-json",
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


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"roomName": "t1-room"},
        {"displayName": "名"},
        {"roomName": None, "displayName": "名"},
        {"roomName": "t1-room", "displayName": None},
        {"roomName": "t1-room", "displayName": 123},
        {"roomName": "t1-room", "displayName": ["名"]},
        {"roomName": "t1-room", "displayName": {"text": "名"}},
    ],
)
def test_missing_fields_and_wrong_types_are_filtered(http_service, body):
    response = http_service.client.post(
        "/api/v1/tokens/media",
        headers={"Authorization": "Bearer " + http_service.session},
        json=body,
    )
    assert response.status_code == 422
    assert response.json() == {
        "code": "INVALID_REQUEST",
        "message": "Admission could not be prepared",
    }


@pytest.mark.parametrize(
    "room", ["", "r" * 65, "房间", "t1-room\n", " t1-room", "../t1-room"]
)
def test_invalid_room_names_are_rejected_before_authorization(http_service, room):
    response = http_service.post(room_name=room)
    assert response.status_code == 422
    assert response.json()["code"] == "INVALID_REQUEST"
    assert "accessToken" not in response.text


@pytest.mark.parametrize("room", ["unknown", "r" * 64])
def test_valid_but_unknown_rooms_cannot_issue_tokens(http_service, room):
    response = http_service.post(room_name=room)
    assert response.status_code == 403
    assert response.json()["code"] == "FORBIDDEN"
    assert "accessToken" not in response.text


@pytest.mark.parametrize("content_type", ["text/plain", "application/jsonp", ""])
def test_non_json_content_type_is_filtered(http_service, content_type):
    response = http_service.client.post(
        "/api/v1/tokens/media",
        headers={
            "Authorization": "Bearer " + http_service.session,
            "Content-Type": content_type,
        },
        content=b'{"roomName":"t1-room","displayName":"A"}',
    )
    assert response.status_code == 422
    assert response.json()["code"] == "INVALID_REQUEST"


@pytest.mark.parametrize(("size", "status"), [(4096, 200), (4097, 413)])
def test_chunked_body_size_boundary_uses_bytes_read(http_service, size, status):
    body = b'{"roomName":"t1-room","displayName":"A"}'
    body += b" " * (size - len(body))
    response = http_service.client.post(
        "/api/v1/tokens/media",
        headers={
            "Authorization": "Bearer " + http_service.session,
            "Content-Type": "application/json",
        },
        content=iter([body[:2048], body[2048:]]),
    )
    assert response.status_code == status
    if status == 413:
        assert response.json()["code"] == "BODY_TOO_LARGE"
        assert "accessToken" not in response.text


@pytest.mark.parametrize(
    "session", ["", "Basic forged", "Bearer expired", "Bearer " + "x" * 257]
)
def test_invalid_session_headers_are_filtered(http_service, session):
    response = http_service.client.post(
        "/api/v1/tokens/media",
        headers={"Authorization": session},
        json={"roomName": "t1-room", "displayName": "名"},
    )
    assert response.status_code == 401
    assert response.json() == {
        "code": "NO_SESSION",
        "message": "Admission could not be prepared",
    }
    assert "accessToken" not in response.text


def test_unrecognized_identity_and_unknown_capabilities_do_not_grant_access():
    inputs = FixtureInputs()
    with running_service(inputs=inputs) as service:
        inputs.subject = "unrecognized-member"
        assert service.post().status_code == 403
        inputs.subject = None
        inputs.actions = {"unknown-capability", "admin"}
        response = service.post()
        assert response.status_code == 403
        assert "accessToken" not in response.text
        inputs.recover()
        assert service.post().status_code == 200


@pytest.mark.parametrize("fault", ["authentication", "authorization", "clock"])
def test_provider_failure_is_private_and_recovers_through_http(caplog, fault):
    inputs = FixtureInputs()
    caplog.set_level(logging.INFO)
    with running_service(inputs=inputs) as service:
        markers = [
            service.session,
            service.secret,
            "private-header-value",
            "C:\\private\\provider.py",
        ]
        inputs.fault = fault
        inputs.fault_message = " ".join(markers)
        response = service.client.post(
            "/api/v1/tokens/media",
            headers={
                "Authorization": "Bearer " + service.session,
                "X-Private": markers[2],
            },
            json={"roomName": "t1-room", "displayName": "private-request-name"},
        )
        assert response.status_code == 503
        assert response.json() == {
            "code": "SERVICE_UNAVAILABLE",
            "message": "Admission could not be prepared",
        }
        assert response.headers["cache-control"] == "no-store"
        public_output = response.text + caplog.text
        for marker in [*markers, "private-request-name", "Traceback", "accessToken"]:
            assert marker not in public_output
        inputs.recover()
        assert service.post().status_code == 200


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


def test_expired_clock_input_preserves_ttl_and_real_signature():
    inputs = FixtureInputs()
    inputs.utc_offset = -120
    with running_service(inputs=inputs) as service:
        expired = service.post()
        assert expired.status_code == 200
        body = expired.json()
        claims = jwt.decode(
            body["accessToken"],
            service.secret,
            algorithms=["HS256"],
            issuer=service.api_key,
            options={"verify_exp": False},
        )
        assert claims["exp"] - claims["nbf"] == 120
        assert datetime.fromisoformat(body["expiresAt"]).timestamp() == claims["exp"]
        verifier = TokenVerifier(service.api_key, service.secret, leeway=timedelta(0))
        with pytest.raises(jwt.ExpiredSignatureError):
            verifier.verify(body["accessToken"])
        inputs.recover()
        fresh = service.post()
        assert fresh.status_code == 200
        assert fresh.json()["accessToken"] != body["accessToken"]
        assert verifier.verify(fresh.json()["accessToken"]).identity == service.subject
