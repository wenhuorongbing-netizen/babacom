import json

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from jsonschema import ValidationError

from app.ratelimit.limiter import RateLimited


def failure(status: int, code: str, retry_after: int | None = None):
    body = {"code": code, "message": "Admission could not be prepared"}
    headers = {"Cache-Control": "no-store"}
    if retry_after is not None:
        body["retryAfterSeconds"] = retry_after
        headers["Retry-After"] = str(retry_after)
    return JSONResponse(body, status_code=status, headers=headers)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON field")
        result[key] = value
    return result


def invalid_constant(_value):
    raise ValueError("Invalid JSON number")


def admission_router(auth, policy, contracts, limits, tokens):
    router = APIRouter()

    @router.post("/api/v1/tokens/media")
    async def prepare(request: Request):
        try:
            ip = request.client.host if request.client else "unknown"
            limits.charge(("ip", ip), 120)
            header = request.headers.get("authorization", "")
            scheme, _, session = header.partition(" ")
            if scheme.lower() != "bearer" or not session or len(session) > 256:
                return failure(401, "NO_SESSION")
            user = auth.authenticate(session)
            if user is None:
                return failure(401, "NO_SESSION")
            limits.charge(("subject", user.subject_id), 20)
            if request.headers.get("content-type", "").split(";")[0].strip() != (
                "application/json"
            ):
                return failure(422, "INVALID_REQUEST")
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 4096:
                    return failure(413, "BODY_TOO_LARGE")
            try:
                data = json.loads(
                    body.decode("utf-8"),
                    object_pairs_hook=unique_object,
                    parse_constant=invalid_constant,
                )
            except (ValueError, UnicodeError, RecursionError):
                return failure(400, "MALFORMED_REQUEST")
            try:
                contracts.validate("request", data)
                name = contracts.normalize_name(data["displayName"])
            except (ValidationError, ValueError):
                return failure(422, "INVALID_REQUEST")
            channel = policy.resolve_channel(data["roomName"])
            if channel is None or not all(
                policy.can(user, action, channel) for action in contracts.actions
            ):
                return failure(403, "FORBIDDEN")
            limits.charge(("room", user.subject_id, channel.name), 6)
            response = tokens.issue(user.subject_id, channel.name, name)
            return JSONResponse(response, headers={"Cache-Control": "no-store"})
        except RateLimited as error:
            return failure(429, "RATE_LIMITED", error.retry_after)
        except Exception:
            return failure(503, "SERVICE_UNAVAILABLE")

    return router
