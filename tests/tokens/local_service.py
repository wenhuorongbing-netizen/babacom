"""Independent loopback-only test launcher; never imported by normal entrypoints."""

import argparse
import json
import secrets
import socket
import sys
import threading
import time
from contextlib import contextmanager
from pathlib import Path

import httpx
import uvicorn

from app.auth.provider import User
from app.factory import ServiceConfig, create_app
from app.permissions.policy import Channel

ROOT = Path(__file__).resolve().parents[2]


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
    def __init__(self, subject, actions=None):
        self.subject = subject
        schema = json.loads(
            (ROOT / "packages/contracts/permissions.schema.json").read_text("utf-8")
        )
        self.actions = frozenset(schema["enum"] if actions is None else actions)

    def resolve_channel(self, name):
        return Channel("t1-room") if name == "t1-room" else None

    def granted_actions(self, user, channel):
        if user.subject_id == self.subject and channel.name == "t1-room":
            return self.actions
        return frozenset()


class RunningService:
    def __init__(self, base_url, session, subject, secret, api_key):
        self.base_url = base_url
        self.session = session
        self.subject = subject
        self.secret = secret
        self.api_key = api_key
        self.client = httpx.Client(base_url=base_url, timeout=15, trust_env=False)

    def post(self, display_name="玩家", room_name="t1-room", authenticated=True):
        headers = {"Content-Type": "application/json"}
        if authenticated:
            headers["Authorization"] = "Bearer " + self.session
        return self.client.post(
            "/api/v1/tokens/media",
            headers=headers,
            content=json.dumps({"roomName": room_name, "displayName": display_name}),
        )


class SigningFaultClock:
    monotonic = staticmethod(time.monotonic)

    @staticmethod
    def utc_seconds():
        raise RuntimeError("Controlled clock failure")


@contextmanager
def running_service(*, host="127.0.0.1", workers=1, actions=None, clock=None):
    if host != "127.0.0.1" or workers != 1:
        raise ValueError("The test launcher requires loopback and one worker")
    session = secrets.token_urlsafe(32)
    secret = secrets.token_urlsafe(48)
    subject = "member-" + secrets.token_hex(16)
    api_key = "t1-" + secrets.token_hex(16)
    config = ServiceConfig(api_key, secret, "ws://127.0.0.1:7880", workers=workers)
    app = create_app(
        FixtureAuthentication(session, subject),
        FixtureAuthorization(subject, actions),
        config,
        clock=clock,
    )
    sock = socket.socket()
    sock.bind((host, 0))
    server = uvicorn.Server(
        uvicorn.Config(
            app,
            host=host,
            workers=workers,
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
            server.should_exit = True
            thread.join(timeout=5)
            sock.close()
            raise RuntimeError("Test service did not start")
        time.sleep(0.01)
    service = RunningService(
        f"http://127.0.0.1:{sock.getsockname()[1]}", session, subject, secret, api_key
    )
    try:
        yield service
    finally:
        service.client.close()
        server.should_exit = True
        thread.join(timeout=10)
        sock.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument(
        "--scenario",
        choices=["ready", "no-session", "forbidden", "service-fault"],
        default="ready",
    )
    args = parser.parse_args()
    if args.host != "127.0.0.1":
        parser.error("The test service may only bind to 127.0.0.1")
    with running_service(
        host=args.host,
        actions=[] if args.scenario == "forbidden" else None,
        clock=SigningFaultClock() if args.scenario == "service-fault" else None,
    ) as service:
        # Private parent pipe; the desktop launcher consumes it without logging.
        print(
            json.dumps(
                {
                    "apiBase": service.base_url,
                    "applicationSession": (
                        secrets.token_urlsafe(32)
                        if args.scenario == "no-session"
                        else service.session
                    ),
                    "roomName": "t1-room",
                    "environment": "local-test",
                }
            ),
            flush=True,
        )
        sys.stdin.read()


if __name__ == "__main__":
    main()
