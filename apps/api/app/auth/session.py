"""Explicit, process-local bearer sessions; no passwords or persistence."""

import hashlib
import re
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass, replace
from threading import Lock

from app.auth.provider import User


@dataclass(frozen=True)
class SessionRecord:
    digest: str
    subject_id: str
    created_at: float
    expires_at: float
    revoked: bool = False


class SessionRegistry:
    def __init__(self, *, utc_seconds: Callable[[], float] = time.time):
        self._utc_seconds = utc_seconds
        self._records: dict[str, SessionRecord] = {}
        self._lock = Lock()

    def issue(self, subject_id: str) -> str:
        if not isinstance(subject_id, str) or not subject_id.strip():
            raise ValueError("A stable subject is required")
        with self._lock:
            while True:
                session = secrets.token_hex(32)
                digest = hashlib.sha256(session.encode("ascii")).hexdigest()
                if digest not in self._records:
                    break
            now = self._utc_seconds()
            self._records[digest] = SessionRecord(digest, subject_id, now, now + 3600)
        return session

    def authenticate(self, session: str) -> User | None:
        if (
            not isinstance(session, str)
            or re.fullmatch(r"[0-9a-f]{64}", session) is None
        ):
            return None
        digest = hashlib.sha256(session.encode("ascii")).hexdigest()
        with self._lock:
            record = self._records.get(digest)
            if (
                record is None
                or record.revoked
                or not self._utc_seconds() < record.expires_at
            ):
                return None
            return User(record.subject_id)

    def records(self) -> tuple[SessionRecord, ...]:
        """Return an immutable operator snapshot; bearer secrets are never retained."""
        with self._lock:
            return tuple(self._records.values())

    def revoke(self, session: str) -> bool:
        if (
            not isinstance(session, str)
            or re.fullmatch(r"[0-9a-f]{64}", session) is None
        ):
            return False
        digest = hashlib.sha256(session.encode("ascii")).hexdigest()
        with self._lock:
            record = self._records.get(digest)
            if record is None or record.revoked:
                return False
            self._records[digest] = replace(record, revoked=True)
            return True

    def revoke_subject(self, subject_id: str) -> int:
        with self._lock:
            records = [
                record
                for record in self._records.values()
                if record.subject_id == subject_id and not record.revoked
            ]
            for record in records:
                self._records[record.digest] = replace(record, revoked=True)
            return len(records)
