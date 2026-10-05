from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class User:
    subject_id: str


class AuthenticationProvider(Protocol):
    """Trusted adapter: only an authenticated session may resolve to a subject."""

    def authenticate(self, session: str) -> User | None: ...
