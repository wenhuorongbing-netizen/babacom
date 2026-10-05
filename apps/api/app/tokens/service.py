import json
import unicodedata
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

import jwt
from jsonschema import Draft7Validator

CONTRACTS = Path(__file__).resolve().parents[4] / "packages" / "contracts"


class AdmissionContracts:
    def __init__(self):
        self.admission = json.loads(
            (CONTRACTS / "admission.schema.json").read_text("utf-8")
        )
        self.claims = json.loads(
            (CONTRACTS / "token-claims.schema.json").read_text("utf-8")
        )
        self.actions = tuple(
            json.loads((CONTRACTS / "permissions.schema.json").read_text("utf-8"))[
                "enum"
            ]
        )
        for schema in (self.admission, self.claims):
            Draft7Validator.check_schema(schema)

    def validate(self, name: str, value: object) -> None:
        schema = {**self.admission, "$ref": f"#/$defs/{name}"}
        Draft7Validator(schema).validate(value)

    def normalize_name(self, raw: str) -> str:
        rule = self.admission["x-nickname"]
        if len(raw) > rule["rawMaxCodePoints"]:
            raise ValueError("Invalid display name")
        name = unicodedata.normalize(rule["normalization"], raw).strip(
            chr(rule["trimCodePoint"])
        )
        if (
            not rule["normalizedMinCodePoints"]
            <= len(name)
            <= rule["normalizedMaxCodePoints"]
            or name.isspace()
        ):
            raise ValueError("Invalid display name")
        if any(
            unicodedata.category(char) in rule["forbiddenCategories"]
            or ord(char) in rule["forbiddenCodePoints"]
            for char in name
        ):
            raise ValueError("Invalid display name")
        return name


class MediaTokens:
    def __init__(
        self, contracts: AdmissionContracts, config, utc_seconds: Callable[[], float]
    ):
        self.contracts = contracts
        self.config = config
        self._utc_seconds = utc_seconds

    def issue(self, subject: str, room: str, name: str) -> dict:
        now = int(self._utc_seconds())
        expires = now + self.contracts.claims["x-ttlSeconds"]
        claims = {
            "iss": self.config.api_key,
            "sub": subject,
            "nbf": now,
            "exp": expires,
            "name": name,
            "video": {
                "room": room,
                "roomJoin": True,
                "canSubscribe": True,
                "canPublish": True,
                "canPublishSources": ["microphone"],
                "canPublishData": False,
            },
        }
        Draft7Validator(self.contracts.claims).validate(claims)
        token = jwt.encode(claims, self.config.api_secret, algorithm="HS256")
        response = {
            "livekitUrl": self.config.livekit_url,
            "roomName": room,
            "participantIdentity": subject,
            "displayName": name,
            "accessToken": token,
            "expiresAt": datetime.fromtimestamp(expires, UTC).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            ),
        }
        self.contracts.validate("success", response)
        return response
