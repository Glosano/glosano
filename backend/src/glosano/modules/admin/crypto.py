"""Domain-separated authenticated encryption; no secret values in exceptions."""

import base64

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


class SecretError(Exception):
    pass


def _cipher(secret: str) -> Fernet:
    if len(secret) < 32 or secret.lower() in {"change-me", "changeme"} or len(set(secret)) < 8:
        raise SecretError("instance_secret_invalid")
    derived = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None, info=b"glosano/ai-settings/v1"
    ).derive(secret.encode())
    return Fernet(base64.urlsafe_b64encode(derived))


def encrypt(value: str, secret: str) -> str:
    return _cipher(secret).encrypt(value.encode()).decode()


def decrypt(value: str, secret: str) -> str:
    try:
        return _cipher(secret).decrypt(value.encode()).decode()
    except (InvalidToken, UnicodeError, ValueError):
        raise SecretError("key_unreadable") from None
