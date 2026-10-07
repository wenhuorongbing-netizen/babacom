import hashlib

import pytest

from app.auth.provider import User
from app.auth.session import SessionRegistry


def test_issued_session_authenticates_stable_subject_until_exact_expiry():
    now = [1_000.0]
    registry = SessionRegistry(utc_seconds=lambda: now[0])
    session = registry.issue("member-a")
    assert registry.authenticate(session) == User("member-a")
    now[0] = 4_599.999
    assert registry.authenticate(session) == User("member-a")
    now[0] = 4_600.0
    assert registry.authenticate(session) is None


def test_record_and_subject_revocation_do_not_change_other_subjects():
    registry = SessionRegistry()
    first = registry.issue("member-a")
    second = registry.issue("member-a")
    other = registry.issue("member-b")
    assert registry.revoke(first) is True
    assert registry.authenticate(first) is None
    assert registry.authenticate(second) == User("member-a")
    assert registry.revoke_subject("member-a") == 1
    assert registry.authenticate(second) is None
    assert registry.authenticate(other) == User("member-b")
    assert registry.revoke(first) is False
    assert registry.revoke_subject("member-a") == 0
    # Explicit reissue is permitted; revocation concerns existing records.
    assert registry.authenticate(registry.issue("member-a")) == User("member-a")


def test_operator_records_contain_only_digests_and_restart_requires_reissue():
    registry = SessionRegistry(utc_seconds=lambda: 1_000.0)
    sessions = [registry.issue("member-a") for _ in range(3)]
    assert len(set(sessions)) == 3
    assert all(len(bytes.fromhex(session)) == 32 for session in sessions)
    records = registry.records()
    assert len(records) == 3
    assert all(
        record.created_at == 1_000.0 and record.expires_at == 4_600.0
        for record in records
    )
    assert all(
        record.subject_id == "member-a" and not record.revoked for record in records
    )
    assert {record.digest for record in records} == {
        hashlib.sha256(session.encode("ascii")).hexdigest() for session in sessions
    }
    assert all(
        session not in repr(records) and session not in repr(registry)
        for session in sessions
    )
    registry.revoke(sessions[0])
    assert registry.records()[0].revoked is True
    restarted = SessionRegistry()
    assert restarted.authenticate(sessions[1]) is None
    assert restarted.authenticate(restarted.issue("member-a")) == User("member-a")


@pytest.mark.parametrize(
    "session", ["", "unknown", "0" * 64, "F" * 64, "😀" * 64, None, 1]
)
def test_unknown_or_malformed_credentials_are_refused(session):
    registry = SessionRegistry()
    assert registry.authenticate(session) is None
    assert registry.revoke(session) is False


@pytest.mark.parametrize("subject", ["", " ", None, 1])
def test_issuing_requires_a_stable_subject(subject):
    with pytest.raises(ValueError, match="stable subject"):
        SessionRegistry().issue(subject)
