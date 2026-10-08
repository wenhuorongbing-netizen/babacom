import json
import secrets
import socket
import threading
import time
from contextlib import contextmanager
from datetime import timedelta

import httpx
import jwt
import pytest
import uvicorn
from livekit.api import TokenVerifier

from app.auth.provider import User
from app.auth.session import SessionRegistry
from app.factory import Clock, ServiceConfig, create_app
from app.main import run
from app.permissions.policy import Channel, PermissionPolicy
from app.permissions.room_access import RoomAccess
from app.tokens.service import AdmissionContracts


def test_finite_room_grants_use_the_shared_permission_policy():
    actions = AdmissionContracts().actions
    grants = {"member-a": {"room-a": set(actions)}}
    provider = RoomAccess(["room-a", "room-b"], grants)
    policy = PermissionPolicy(provider, actions)
    room = policy.resolve_channel("room-a")
    assert room == Channel("room-a")
    assert all(policy.can(User("member-a"), action, room) for action in actions)
    assert not any(policy.can(User("member-b"), action, room) for action in actions)
    assert not any(
        policy.can(User("member-a"), action, Channel("room-b")) for action in actions
    )
    assert not policy.can(User("member-a"), "unknown", room)
    assert policy.resolve_channel("unknown") is None
    assert not policy.can(User("member-a"), actions[0], Channel("unknown"))
    assert not policy.can(User(""), actions[0], room)
    # Caller changes cannot expand the explicit configuration after construction.
    grants["member-b"] = {"room-b": set(actions)}
    grants["member-a"]["room-a"].clear()
    assert all(policy.can(User("member-a"), action, room) for action in actions)
    assert not any(
        policy.can(User("member-b"), action, Channel("room-b")) for action in actions
    )


class RealAdmission:
    def __init__(self, actions=None):
        self.utc = time.time()
        self.tick = 100.0
        self.registry = SessionRegistry(utc_seconds=lambda: self.utc)
        self.session = self.registry.issue("member-a")
        self.other_session = self.registry.issue("member-b")
        self.config = ServiceConfig(
            "test-" + secrets.token_hex(16),
            secrets.token_urlsafe(48),
            "ws://127.0.0.1:7880",
        )
        self.access = RoomAccess(
            ["room-a", "room-b"],
            {
                "member-a": {
                    "room-a": AdmissionContracts().actions
                    if actions is None
                    else actions
                }
            },
        )
        self.application = create_app(
            self.registry,
            self.access,
            self.config,
            clock=Clock(monotonic=lambda: self.tick, utc_seconds=lambda: self.utc),
        )

    def post(self, *, session=None, room="room-a", name="玩家"):
        headers = {"Content-Type": "application/json"}
        if session is not False:
            headers["Authorization"] = "Bearer " + (
                self.session if session is None else session
            )
        return self.client.post(
            "/api/v1/tokens/media",
            headers=headers,
            content=json.dumps({"roomName": room, "displayName": name}),
        )


@contextmanager
def running_admission(*, actions=None):
    service = RealAdmission(actions)
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    server = uvicorn.Server(
        uvicorn.Config(
            service.application,
            host="127.0.0.1",
            workers=1,
            proxy_headers=False,
            access_log=False,
            log_config=None,
            log_level="critical",
        )
    )
    thread = threading.Thread(
        target=server.run, kwargs={"sockets": [sock]}, daemon=True
    )
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started:
            if not thread.is_alive() or time.monotonic() >= deadline:
                raise RuntimeError("Real admission service startup timed out")
            time.sleep(0.01)
        with httpx.Client(
            base_url=f"http://127.0.0.1:{sock.getsockname()[1]}",
            timeout=15,
            trust_env=False,
        ) as service.client:
            yield service
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        sock.close()


def assert_refused(response, status, code):
    assert response.status_code == status
    assert response.json()["code"] == code
    assert response.headers["cache-control"] == "no-store"
    assert "accessToken" not in response.text
    assert "participantIdentity" not in response.text


def test_real_http_issues_unchanged_media_grants_and_nickname_cannot_change_subject():
    with running_admission() as service:
        identities = []
        for name, normalized in [
            ("  e\u0301 玩家 🎮  ", "é 玩家 🎮"),
            ("改名玩家", "改名玩家"),
        ]:
            response = service.post(name=name)
            assert response.status_code == 200
            assert response.headers["cache-control"] == "no-store"
            body = response.json()
            assert body["displayName"] == normalized
            identities.append(body["participantIdentity"])
            claims = TokenVerifier(
                service.config.api_key, service.config.api_secret, leeway=timedelta(0)
            ).verify(body["accessToken"])
            assert claims.identity == "member-a"
            payload = jwt.decode(
                body["accessToken"],
                service.config.api_secret,
                algorithms=["HS256"],
                issuer=service.config.api_key,
            )
            assert payload["exp"] - payload["nbf"] == 120
            assert claims.video.room == "room-a"
            assert claims.video.room_join is True
            assert claims.video.can_subscribe is True
            assert claims.video.can_publish is True
            assert claims.video.can_publish_sources == ["microphone"]
            assert claims.video.can_publish_data is False
        assert identities == ["member-a", "member-a"]


@pytest.mark.parametrize(
    "condition", ["missing", "unknown", "expired", "revoked", "subject-revoked"]
)
def test_real_http_refuses_invalid_application_sessions_without_media_tickets(
    condition,
):
    with running_admission() as service:
        session = service.session
        if condition == "missing":
            session = False
        elif condition == "unknown":
            session = secrets.token_hex(32)
        elif condition == "expired":
            service.utc += 3600
        elif condition == "revoked":
            service.registry.revoke(session)
        elif condition == "subject-revoked":
            service.registry.revoke_subject("member-a")
        assert_refused(service.post(session=session), 401, "NO_SESSION")


@pytest.mark.parametrize("room", ["room-b", "unknown"])
def test_real_http_refuses_ungranted_or_unknown_rooms(room):
    with running_admission() as service:
        assert_refused(service.post(room=room), 403, "FORBIDDEN")
        assert_refused(service.post(session=service.other_session), 403, "FORBIDDEN")


@pytest.mark.parametrize("missing", AdmissionContracts().actions)
def test_real_http_requires_every_shared_action(missing):
    actions = [action for action in AdmissionContracts().actions if action != missing]
    with running_admission(actions=actions) as service:
        assert_refused(service.post(), 403, "FORBIDDEN")


@pytest.mark.parametrize(
    "name",
    [
        "",
        " " * 32,
        "界" * 33,
        "x" * 257,
        "\t名",
        "\u200b名",
        "\u202e名",
        "\u2066名",
        "名\x00",
        "\ud800",
    ],
)
def test_real_http_preserves_nickname_refusal_boundaries(name):
    with running_admission() as service:
        assert_refused(service.post(name=name), 422, "INVALID_REQUEST")


@pytest.mark.parametrize(
    ("quota", "attempt", "status"),
    [(6, {}, 200), (20, {"name": ""}, 422), (120, {"session": False}, 401)],
)
def test_real_http_preserves_each_rolling_limit_and_exact_60_second_recovery(
    quota, attempt, status
):
    with running_admission() as service:
        for _ in range(quota):
            assert service.post(**attempt).status_code == status
        blocked = service.post(**attempt)
        assert_refused(blocked, 429, "RATE_LIMITED")
        assert blocked.headers["Retry-After"] == "60"
        assert blocked.json()["retryAfterSeconds"] == 60
        service.tick = 159.999
        assert service.post(**attempt).status_code == 429
        service.tick = 160.0
        assert service.post(**attempt).status_code == status


def test_real_http_room_and_subject_limits_share_stable_identity_across_reissue():
    with running_admission() as service:
        second = service.registry.issue("member-a")
        for index in range(6):
            session = service.session if index % 2 == 0 else second
            response = service.post(session=session, name=f"玩家{index}")
            assert response.status_code == 200
        assert_refused(service.post(session=second), 429, "RATE_LIMITED")
        # The room refusal also consumes one of the 20 subject attempts.
        for _ in range(13):
            response = service.post(session=second, room="room-b")
            assert response.status_code == 403
        assert_refused(
            service.post(session=service.session, room="room-b"), 429, "RATE_LIMITED"
        )


@pytest.mark.parametrize(
    ("auth", "access"), [(None, RoomAccess([], {})), (SessionRegistry(), None)]
)
def test_normal_factory_and_run_require_explicit_providers(auth, access):
    config = ServiceConfig("test", secrets.token_urlsafe(48), "ws://127.0.0.1:7880")
    with pytest.raises(ValueError, match="providers are required"):
        create_app(auth, access, config)
    with pytest.raises(SystemExit, match="providers are required"):
        run(auth, access, config)


def test_real_admission_still_requires_single_worker():
    with pytest.raises(ValueError, match="one worker"):
        create_app(
            SessionRegistry(),
            RoomAccess([], {}),
            ServiceConfig(
                "test", secrets.token_urlsafe(48), "ws://127.0.0.1:7880", workers=2
            ),
        )
