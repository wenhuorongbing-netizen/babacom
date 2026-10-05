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


class FixtureInputs:
    def __init__(self):
        self.authenticated = True
        self.subject = None
        self.actions = None
        self.fault = None
        self.fault_message = "Controlled provider failure"

    def recover(self):
        self.authenticated = True
        self.subject = None
        self.actions = None
        self.fault = None


class FixtureAuthentication:
    def __init__(self, session, subject, inputs):
        self.session = session
        self.subject = subject
        self.inputs = inputs

    def authenticate(self, session):
        if self.inputs.fault == "authentication":
            raise RuntimeError(self.inputs.fault_message)
        return (
            User(self.inputs.subject or self.subject)
            if self.inputs.authenticated
            and secrets.compare_digest(session, self.session)
            else None
        )


class FixtureAuthorization:
    def __init__(self, subject, inputs):
        self.subject = subject
        self.inputs = inputs
        schema = json.loads(
            (ROOT / "packages/contracts/permissions.schema.json").read_text("utf-8")
        )
        self.actions = frozenset(schema["enum"])

    def resolve_channel(self, name):
        if self.inputs.fault == "authorization":
            raise RuntimeError(self.inputs.fault_message)
        return Channel("t1-room") if name == "t1-room" else None

    def granted_actions(self, user, channel):
        if user.subject_id == self.subject and channel.name == "t1-room":
            return (
                self.actions
                if self.inputs.actions is None
                else frozenset(self.inputs.actions)
            )
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


class FixtureClock:
    monotonic = staticmethod(time.monotonic)

    def __init__(self, inputs):
        self.inputs = inputs

    def utc_seconds(self):
        if self.inputs.fault == "clock":
            raise RuntimeError(self.inputs.fault_message)
        return time.time()


@contextmanager
def running_service(
    *,
    host="127.0.0.1",
    workers=1,
    actions=None,
    clock=None,
    inputs=None,
    response_status=None,
):
    if host != "127.0.0.1" or workers != 1:
        raise ValueError("The test launcher requires loopback and one worker")
    session = secrets.token_urlsafe(32)
    secret = secrets.token_urlsafe(48)
    subject = "member-" + secrets.token_hex(16)
    api_key = "t1-" + secrets.token_hex(16)
    inputs = inputs or FixtureInputs()
    if actions is not None:
        inputs.actions = actions
    config = ServiceConfig(api_key, secret, "ws://127.0.0.1:7880", workers=workers)
    app = create_app(
        FixtureAuthentication(session, subject, inputs),
        FixtureAuthorization(subject, inputs),
        config,
        clock=clock or FixtureClock(inputs),
    )
    if response_status is not None:
        admission_app = app

        async def observe_response(scope, receive, send):
            async def observe_send(message):
                if message["type"] == "http.response.start":
                    response_status(message["status"])
                await send(message)

            await admission_app(scope, receive, observe_send)

        app = observe_response
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
    inputs = FixtureInputs()
    inputs.authenticated = args.scenario != "no-session"
    inputs.actions = [] if args.scenario == "forbidden" else None
    inputs.fault = "clock" if args.scenario == "service-fault" else None

    def observed(status):
        print(json.dumps({"event": "response", "status": status}), flush=True)

    with running_service(
        host=args.host,
        inputs=inputs,
        response_status=observed,
    ) as service:
        # Private parent pipe; the desktop launcher consumes it without logging.
        print(
            json.dumps(
                {
                    "apiBase": service.base_url,
                    "applicationSession": service.session,
                    "roomName": "t1-room",
                    "environment": "local-test",
                }
            ),
            flush=True,
        )
        # A fixed parent-only test command changes provider inputs, never routes.
        for command in sys.stdin:
            if command.strip() == "recover":
                inputs.recover()
                print(json.dumps({"event": "recovered"}), flush=True)


if __name__ == "__main__":
    main()
