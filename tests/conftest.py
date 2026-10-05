import pytest
from tokens.local_service import running_service


@pytest.fixture
def http_service():
    with running_service() as service:
        yield service
