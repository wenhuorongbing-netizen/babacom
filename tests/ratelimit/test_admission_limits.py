import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from tokens.local_service import running_service


class ControlledClock:
    def __init__(self):
        self.tick = 100.0
        self.fail_signing = False

    def monotonic(self):
        return self.tick

    def utc_seconds(self):
        if self.fail_signing:
            raise RuntimeError("private signing fault")
        return time.time()


@pytest.mark.parametrize(
    ("quota", "attempt", "status"),
    [
        (6, {}, 200),
        (20, {"display_name": ""}, 422),
        (120, {"authenticated": False}, 401),
    ],
)
def test_each_rolling_layer_blocks_and_recovers_at_60_seconds(quota, attempt, status):
    clock = ControlledClock()
    with running_service(clock=clock) as service:
        for _ in range(quota):
            assert service.post(**attempt).status_code == status
        blocked = service.post(**attempt)
        assert blocked.status_code == 429
        assert blocked.headers["Retry-After"] == "60"
        assert blocked.json()["retryAfterSeconds"] == 60
        assert blocked.headers["cache-control"] == "no-store"
        assert "accessToken" not in blocked.text
        clock.tick += 59.999
        last_millisecond = service.post(**attempt)
        assert last_millisecond.status_code == 429
        assert last_millisecond.headers["Retry-After"] == "1"
        assert last_millisecond.json()["retryAfterSeconds"] == 1
        clock.tick = 160.0
        assert service.post(**attempt).status_code == status


@pytest.mark.parametrize(
    ("quota", "attempt", "status", "count"),
    [
        (6, {}, 200, 24),
        (20, {"display_name": ""}, 422, 32),
        (120, {"authenticated": False}, 401, 132),
    ],
)
def test_concurrent_requests_debit_each_layer_atomically(quota, attempt, status, count):
    with running_service(clock=ControlledClock()) as service:
        with ThreadPoolExecutor(max_workers=12) as pool:
            responses = list(pool.map(lambda _: service.post(**attempt), range(count)))
        assert sum(r.status_code == status for r in responses) == quota
        assert sum(r.status_code == 429 for r in responses) == count - quota
        assert all(
            "accessToken" not in r.text for r in responses if r.status_code == 429
        )


def test_signing_failure_consumes_the_approved_room_quota():
    clock = ControlledClock()
    clock.fail_signing = True
    with running_service(clock=clock) as service:
        for _ in range(6):
            response = service.post()
            assert response.status_code == 503
            assert response.json()["code"] == "SERVICE_UNAVAILABLE"
            assert "private signing fault" not in response.text
        clock.fail_signing = False
        assert service.post().status_code == 429


@pytest.mark.parametrize(
    ("content", "status"), [(b"{", 400), (b"x" * 4097, 413), (b"[]", 422)]
)
def test_invalid_authenticated_requests_consume_subject_quota(content, status):
    with running_service(clock=ControlledClock()) as service:
        for _ in range(20):
            response = service.client.post(
                "/api/v1/tokens/media",
                headers={
                    "Authorization": "Bearer " + service.session,
                    "Content-Type": "application/json",
                },
                content=content,
            )
            assert response.status_code == status
        blocked = service.post()
        assert blocked.status_code == 429
        assert blocked.headers["Retry-After"] == "60"
        assert blocked.json()["retryAfterSeconds"] == 60
        assert "accessToken" not in blocked.text


def test_denied_permissions_do_not_consume_approved_room_quota():
    from tokens.local_service import FixtureInputs

    inputs = FixtureInputs()
    inputs.actions = []
    with running_service(inputs=inputs, clock=ControlledClock()) as service:
        for _ in range(5):
            assert service.post().status_code == 403
        inputs.recover()
        for _ in range(6):
            assert service.post().status_code == 200
        assert service.post().status_code == 429


def test_retry_after_belongs_to_the_first_refusing_layer():
    clock = ControlledClock()
    clock.tick = 80.0
    with running_service(clock=clock) as service:
        for _ in range(14):
            assert service.post(display_name="").status_code == 422
        clock.tick = 100.0
        for _ in range(6):
            assert service.post().status_code == 200
        clock.tick = 110.0
        subject_blocked = service.post()
        assert subject_blocked.status_code == 429
        assert subject_blocked.headers["Retry-After"] == "30"
        assert subject_blocked.json()["retryAfterSeconds"] == 30
        clock.tick = 140.0
        room_blocked = service.post()
        assert room_blocked.status_code == 429
        assert room_blocked.headers["Retry-After"] == "20"
        assert room_blocked.json()["retryAfterSeconds"] == 20
        clock.tick = 160.0
        assert service.post().status_code == 200


def test_earlier_debits_survive_later_room_rejections():
    clock = ControlledClock()
    with running_service(clock=clock) as service:
        for _ in range(6):
            assert service.post().status_code == 200
        clock.tick = 130.0
        for _ in range(14):
            response = service.post()
            assert response.status_code == 429
            assert response.headers["Retry-After"] == "30"
        # The next rejection is at the subject layer. Rejected attempts there
        # must not extend the window by taking another subject slot.
        assert service.post().headers["Retry-After"] == "30"
        clock.tick = 160.0
        for _ in range(6):
            assert service.post().status_code == 200
        assert service.post().headers["Retry-After"] == "30"
