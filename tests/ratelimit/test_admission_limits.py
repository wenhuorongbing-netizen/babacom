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
    ("quota", "attempt"),
    [(6, {}), (20, {"display_name": ""}), (120, {"authenticated": False})],
)
def test_each_rolling_layer_blocks_and_recovers_at_60_seconds(quota, attempt):
    clock = ControlledClock()
    with running_service(clock=clock) as service:
        for _ in range(quota):
            assert service.post(**attempt).status_code != 429
        blocked = service.post(**attempt)
        assert blocked.status_code == 429
        assert blocked.headers["Retry-After"] == "60"
        assert blocked.json()["retryAfterSeconds"] == 60
        assert "accessToken" not in blocked.text
        clock.tick += 59.999
        assert service.post(**attempt).headers["Retry-After"] == "1"
        clock.tick = 160.0
        assert service.post(**attempt).status_code != 429


def test_concurrent_requests_do_not_exceed_room_quota():
    with running_service() as service:
        with ThreadPoolExecutor(max_workers=12) as pool:
            responses = list(pool.map(lambda _: service.post(), range(24)))
        assert sum(r.status_code == 200 for r in responses) == 6
        assert sum(r.status_code == 429 for r in responses) == 18
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
