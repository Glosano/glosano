"""Provider URL validation and DNS-pinned requests; local inference is supported."""

import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit

import httpx


class EndpointError(Exception):
    pass


def _allowed_ip(host: str) -> bool:
    address = ipaddress.ip_address(host)
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    return not (
        address.is_link_local
        or address.is_multicast
        or address.is_unspecified
        or str(address) in {"100.100.100.200", "168.63.129.16", "fd00:ec2::254"}
        or (address.is_reserved and not address.is_loopback)
    )


def validate_url(value: str) -> str:
    value = value.strip().rstrip("/")
    if not value:
        return value
    try:
        parsed = urlsplit(value)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or parsed.port == 0
            or any(ord(c) < 33 for c in value)
            or "\\" in value
        ):
            raise ValueError
        host = parsed.hostname.rstrip(".").lower()
        if host in {"metadata", "metadata.google.internal", "instance-data"}:
            raise ValueError
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            if not _allowed_ip(host):
                raise ValueError
        httpx.URL(value)
    except (ValueError, httpx.InvalidURL):
        raise EndpointError("invalid_endpoint") from None
    return value


async def target(url: str) -> tuple[httpx.URL, dict[str, str], dict[str, object]]:
    """Resolve once, reject metadata addresses, then connect to the validated IP with TLS SNI."""
    validate_url(url)
    original = httpx.URL(url)
    try:
        async with asyncio.timeout(5):
            addresses = await asyncio.get_running_loop().getaddrinfo(
                original.host,
                original.port or (443 if original.scheme == "https" else 80),
                type=socket.SOCK_STREAM,
            )
    except (OSError, TimeoutError):
        raise EndpointError("server_unavailable") from None
    ips = [str(item[4][0]) for item in addresses]
    if not ips or not all(_allowed_ip(ip) for ip in ips):
        raise EndpointError("invalid_endpoint")
    if original.scheme == "http" and any(ipaddress.ip_address(ip).is_global for ip in ips):
        raise EndpointError("https_required")
    return (
        original.copy_with(host=ips[0]),
        {"Host": original.netloc.decode()},
        {"sni_hostname": original.host},
    )
