"""Loopback fixture for real SFU tests. Normal entrypoints never import this."""

import argparse
import hashlib
import json
import os
import secrets
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

import httpx
import jwt
import uvicorn

from app.auth.provider import User
from app.auth.session import SessionRegistry
from app.factory import Clock, ServiceConfig, create_app
from app.permissions.policy import Channel
from app.permissions.room_access import RoomAccess
from app.tokens.service import AdmissionContracts, MediaTokens

ROOT = Path(__file__).resolve().parents[2]
SFU_SHA256 = "951f9466cd4450b3c3c7f1a5830a05a9bb97cc11d93cf1be9ebcd3b47cc316d1"
ROOM = "t1-room"
UNGRANTED_ROOM = "t2-ungranted-room"


class FixtureAuthentication:
    def __init__(self, session, subject):
        self.session = session
        self.subject = subject

    def authenticate(self, session):
        return (
            User(self.subject)
            if secrets.compare_digest(session, self.session)
            else None
        )


class FixtureAuthorization:
    def __init__(self, subject):
        self.subject = subject
        self.actions = frozenset(AdmissionContracts().actions)

    def resolve_channel(self, name):
        return Channel(ROOM) if name == ROOM else None

    def granted_actions(self, user, channel):
        return (
            self.actions
            if user.subject_id == self.subject and channel.name == ROOM
            else frozenset()
        )


def free_port(kind=socket.SOCK_STREAM):
    with socket.socket(socket.AF_INET, kind) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--scenario",
        choices=[
            "ready",
            "bad-signature",
            "url-mismatch",
            "expired-peer",
            "expired-session",
            "revoked-session",
            "unauthorized-room",
            "missing-action",
            "expired-ticket",
        ],
        default="ready",
    )
    parser.add_argument(
        "--provider", choices=["fixture", "registry"], default="fixture"
    )
    args = parser.parse_args()
    binary = Path(
        os.environ.get(
            "BABACOM_SFU_BINARY",
            str(
                ROOT.parent
                / "babacom/infra/measurement/.runtime/livekit-1.13.7/livekit-server.exe"
            ),
        )
    )
    if hashlib.sha256(binary.read_bytes()).hexdigest() != SFU_SHA256:
        raise RuntimeError("SFU binary does not match verified official release")
    port, udp_port = free_port(), free_port(socket.SOCK_DGRAM)
    key, secret = "t2-" + secrets.token_hex(16), secrets.token_urlsafe(48)
    session, subject = secrets.token_urlsafe(32), "member-" + secrets.token_hex(16)
    url = f"ws://127.0.0.1:{port}"
    # Only the SFU child receives this environment. No secret in argv or a file.
    server_config = json.dumps(
        {
            "port": port,
            "bind_addresses": ["127.0.0.1"],
            "rtc": {
                "tcp_port": 0,
                "udp_port": udp_port,
                "node_ip": "127.0.0.1",
                "use_external_ip": False,
                "enable_loopback_candidate": True,
                "ips": {"includes": ["127.0.0.1/32"]},
                "stun_servers": [],
            },
            "keys": {key: secret},
            "logging": {"level": "error"},
        }
    )
    sfu = subprocess.Popen(
        [str(binary)],
        cwd=ROOT / "apps/desktop/build",
        env={**os.environ, "LIVEKIT_CONFIG": server_config},
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    server = None
    thread = None
    sock = None
    try:
        deadline = time.monotonic() + 10
        while True:
            if sfu.poll() is not None:
                raise RuntimeError("Local SFU stopped during startup")
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                    break
            except OSError:
                if time.monotonic() >= deadline:
                    raise RuntimeError("Local SFU startup timed out") from None
                time.sleep(0.05)
        livekit_url = (
            url if args.scenario != "url-mismatch" else f"ws://127.0.0.1:{free_port()}"
        )
        signer = (
            secret if args.scenario != "bad-signature" else secrets.token_urlsafe(48)
        )
        config = ServiceConfig(key, signer, livekit_url)
        session_offset = 0.0
        if args.provider == "registry":
            authentication = SessionRegistry(
                utc_seconds=lambda: time.time() + session_offset
            )
            session = authentication.issue(subject)
            actions = AdmissionContracts().actions
            authorization = RoomAccess(
                [ROOM, UNGRANTED_ROOM],
                {
                    subject: {
                        ROOM: actions[1:]
                        if args.scenario == "missing-action"
                        else actions
                    }
                },
            )
            if args.scenario == "expired-session":
                session_offset = 3600.0
            elif args.scenario == "revoked-session":
                authentication.revoke(session)
        else:
            authentication = FixtureAuthentication(session, subject)
            authorization = FixtureAuthorization(subject)
        application = create_app(
            authentication,
            authorization,
            config,
            clock=Clock(utc_seconds=lambda: time.time() - 180)
            if args.scenario == "expired-ticket"
            else None,
        )
        request_count = 0

        async def observe(scope, receive, send):
            nonlocal request_count
            if scope["type"] == "http":
                request_count += 1
                print(
                    json.dumps({"event": "request", "count": request_count}), flush=True
                )

            async def observed_send(message):
                if message["type"] == "http.response.start":
                    print(
                        json.dumps({"event": "response", "status": message["status"]}),
                        flush=True,
                    )
                await send(message)

            await application(scope, receive, observed_send)

        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        server = uvicorn.Server(
            uvicorn.Config(
                observe,
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
        deadline = time.monotonic() + 10
        while not server.started:
            if not thread.is_alive() or time.monotonic() >= deadline:
                raise RuntimeError("Media fixture startup timed out")
            time.sleep(0.01)
        tokens = MediaTokens(
            AdmissionContracts(),
            ServiceConfig(key, secret, url),
            (lambda: time.time() - 180)
            if args.scenario == "expired-peer"
            else time.time,
        )
        peer = tokens.issue("peer-" + secrets.token_hex(16), ROOM, "合成参与者")
        print(
            json.dumps(
                {
                    "configuration": {
                        "apiBase": f"http://127.0.0.1:{sock.getsockname()[1]}",
                        "applicationSession": session,
                        "roomName": UNGRANTED_ROOM
                        if args.scenario == "unauthorized-room"
                        else ROOM,
                        "environment": "local-test",
                    },
                    "media": {"sfuBase": url},
                    "peer": peer,
                }
            ),
            flush=True,
        )
        with httpx.Client(
            base_url=f"http://127.0.0.1:{port}", trust_env=False, timeout=5
        ) as client:
            for line in sys.stdin:
                command = json.loads(line)
                operation = command["command"]
                result = {"event": operation, "requestId": command["requestId"]}
                if operation in ("revoke-session", "revoke-subject", "expire-session"):
                    if args.provider != "registry":
                        raise ValueError(
                            "Registry controls require explicit real providers"
                        )
                    if operation == "revoke-session":
                        authentication.revoke(session)
                    elif operation == "revoke-subject":
                        authentication.revoke_subject(subject)
                    else:
                        session_offset += 3600.0
                elif operation == "ticket":
                    if args.provider != "registry":
                        raise ValueError(
                            "Real HTTP tickets require explicit real providers"
                        )
                    response = client.post(
                        f"http://127.0.0.1:{sock.getsockname()[1]}/api/v1/tokens/media",
                        headers={"Authorization": "Bearer " + session},
                        json={"roomName": ROOM, "displayName": "真实准入玩家"},
                    )
                    result["status"] = response.status_code
                    if response.status_code == 200:
                        result["credentials"] = response.json()
                    else:
                        result["code"] = response.json()["code"]
                elif operation == "stop-sfu":
                    sfu.terminate()
                    sfu.wait(timeout=5)
                elif operation in ("inspect", "inspect-room-b", "remove", "refresh"):
                    inspection = operation in ("inspect", "inspect-room-b")
                    room = UNGRANTED_ROOM if operation == "inspect-room-b" else ROOM
                    now = int(time.time())
                    admin = jwt.encode(
                        {
                            "iss": key,
                            "nbf": now,
                            "exp": now + 30,
                            "video": {"roomAdmin": True, "room": room},
                        },
                        secret,
                        algorithm="HS256",
                    )
                    method = (
                        "ListParticipants"
                        if inspection
                        else "UpdateParticipant"
                        if operation == "refresh"
                        else "RemoveParticipant"
                    )
                    payload = {"room": room}
                    if operation in ("remove", "refresh"):
                        payload["identity"] = subject
                    if operation == "refresh":
                        payload["permission"] = {
                            "canSubscribe": True,
                            "canPublish": True,
                            "canPublishData": False,
                        }
                    response = client.post(
                        "/twirp/livekit.RoomService/" + method,
                        headers={"Authorization": "Bearer " + admin},
                        json=payload,
                    )
                    if (
                        inspection
                        and response.status_code == 404
                        and response.json().get("code") == "not_found"
                    ):
                        result["participants"] = []
                        print(json.dumps(result), flush=True)
                        continue
                    response.raise_for_status()
                    if inspection:
                        result["participants"] = [
                            {
                                "identity": p["identity"],
                                "tracks": len(p.get("tracks", [])),
                            }
                            for p in response.json().get("participants", [])
                        ]
                print(json.dumps(result), flush=True)
    finally:
        if server:
            server.should_exit = True
        if thread:
            thread.join(timeout=10)
        if sock:
            sock.close()
        if sfu.poll() is None:
            sfu.terminate()
            sfu.wait(timeout=5)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Exceptions can carry signed request URLs; report categories only.
        print("Local media fixture failed: " + type(error).__name__, file=sys.stderr)
        sys.exit(1)
