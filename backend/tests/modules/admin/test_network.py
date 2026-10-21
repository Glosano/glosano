"""DNS aliases and HTTP responses cannot bypass the provider boundary."""

import asyncio
import socket
from unittest.mock import AsyncMock

import pytest

from glosano.modules.admin.network import EndpointError, target


@pytest.mark.parametrize(
    ("ip", "scheme", "error"),
    [
        ("169.254.169.254", "https", "invalid_endpoint"),
        ("fd00:ec2::254", "https", "invalid_endpoint"),
        ("::ffff:169.254.169.254", "https", "invalid_endpoint"),
        ("8.8.8.8", "http", "https_required"),
    ],
)
async def test_dns_alias_cannot_bypass_validation(
    monkeypatch: pytest.MonkeyPatch, ip: str, scheme: str, error: str
):
    resolve = AsyncMock(return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 80))])
    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", resolve)
    with pytest.raises(EndpointError, match=error):
        await target(f"{scheme}://model.example/v1/models")


async def test_pin_private_address_with_original_host_and_sni(monkeypatch: pytest.MonkeyPatch):
    resolve = AsyncMock(
        return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.168.1.20", 8443))]
    )
    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", resolve)
    url, headers, extensions = await target("https://local-model.example:8443/v1/models")
    assert str(url) == "https://192.168.1.20:8443/v1/models"
    assert headers == {"Host": "local-model.example:8443"}
    assert extensions == {"sni_hostname": "local-model.example"}
    assert resolve.await_count == 1
