"""Finite operator-supplied room grants consumed by PermissionPolicy.can."""

from collections.abc import Iterable, Mapping

from app.auth.provider import User
from app.permissions.policy import Channel


class RoomAccess:
    def __init__(
        self,
        rooms: Iterable[str],
        grants: Mapping[str, Mapping[str, Iterable[str]]],
    ):
        self._channels: dict[str, Channel] = {}
        for name in rooms:
            if not isinstance(name, str) or not name.strip():
                raise ValueError("A room name is required")
            self._channels[name] = Channel(name)
        self._grants: dict[tuple[str, str], frozenset[str]] = {}
        for subject, room_grants in grants.items():
            if not isinstance(subject, str) or not subject.strip():
                raise ValueError("A stable subject is required")
            for room, actions in room_grants.items():
                if room not in self._channels:
                    raise ValueError("Grant refers to an unconfigured room")
                self._grants[(subject, room)] = frozenset(actions)

    def resolve_channel(self, name: str) -> Channel | None:
        return self._channels.get(name)

    def granted_actions(self, user: User, channel: Channel) -> frozenset[str]:
        return self._grants.get((user.subject_id, channel.name), frozenset())
