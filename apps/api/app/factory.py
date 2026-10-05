import time
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from fastapi import FastAPI, Request

from app.auth.provider import AuthenticationProvider
from app.permissions.policy import AuthorizationProvider, PermissionPolicy
from app.ratelimit.limiter import RollingLimits
from app.tokens.routes import admission_router, failure
from app.tokens.service import AdmissionContracts, MediaTokens


@dataclass(frozen=True)
class ServiceConfig:
    api_key: str
    api_secret: str = field(repr=False)
    livekit_url: str = ""
    workers: int = 1


@dataclass(frozen=True)
class Clock:
    monotonic: object = time.monotonic
    utc_seconds: object = time.time


def create_app(
    auth_provider: AuthenticationProvider,
    authorization_provider: AuthorizationProvider,
    config: ServiceConfig,
    *,
    clock=None,
) -> FastAPI:
    if auth_provider is None or authorization_provider is None:
        raise ValueError("Authentication and authorization providers are required")
    if config.workers != 1:
        raise ValueError("T1 requires exactly one worker")
    parsed = urlsplit(config.livekit_url)
    if (
        not config.api_key
        or len(config.api_secret) < 32
        or parsed.scheme not in ("ws", "wss")
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
    ):
        raise ValueError("Invalid controlled service configuration")
    contracts = AdmissionContracts()
    policy = PermissionPolicy(authorization_provider, contracts.actions)
    clock = clock or Clock()
    limits = RollingLimits(clock.monotonic)
    tokens = MediaTokens(contracts, config, clock.utc_seconds)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def no_store(request: Request, call_next):
        try:
            response = await call_next(request)
        except Exception:
            response = failure(503, "SERVICE_UNAVAILABLE")
        response.headers["Cache-Control"] = "no-store"
        return response

    app.include_router(
        admission_router(auth_provider, policy, contracts, limits, tokens)
    )
    return app
