from dataclasses import dataclass
from typing import Protocol

from app.auth.provider import User


@dataclass(frozen=True)
class Channel:
    name: str


class AuthorizationProvider(Protocol):
    def resolve_channel(self, name: str) -> Channel | None: ...
    def granted_actions(self, user: User, channel: Channel) -> frozenset[str]: ...


class PermissionPolicy:
    def __init__(self, provider: AuthorizationProvider, actions: tuple[str, ...]):
        self.provider = provider
        self.actions = actions

    def resolve_channel(self, name: str) -> Channel | None:
        return self.provider.resolve_channel(name)

    def can(self, user: User, action: str, channel: Channel) -> bool:
        if not user.subject_id or action not in self.actions:
            return False
        if self.provider.resolve_channel(channel.name) != channel:
            return False
        return action in self.provider.granted_actions(user, channel)
