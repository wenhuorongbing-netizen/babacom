import uvicorn

from app.factory import create_app


def run(auth_provider=None, authorization_provider=None, config=None):
    """Host integration supplies real adapters explicitly; no fixture fallback."""
    if auth_provider is None or authorization_provider is None or config is None:
        raise SystemExit("Authentication and authorization providers are required")
    app = create_app(auth_provider, authorization_provider, config)
    uvicorn.run(
        app,
        host="127.0.0.1",
        workers=1,
        proxy_headers=False,
        access_log=False,
        log_config=None,
    )


if __name__ == "__main__":
    run()
