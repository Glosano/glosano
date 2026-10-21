"""Validate an app-only Compose upgrade; run with Python in the installed image."""
import json
import sys


def validate(old: dict, new: dict, source: str, target: str) -> None:
    def require(ok: bool, message: str) -> None:
        if not ok:
            raise ValueError(message)

    roles = {"postgres", "redis", "migrate", "app-api", "app-worker"}
    require(bool(old.get("name")) and old.get("name") == new.get("name"), "project name changed")
    for key in ("volumes", "networks"):
        require(old.get(key) == new.get(key), f"{key} changed; use the manual update procedure")
    require(set(old["services"]) == set(new["services"]) == roles, "service layout changed")
    for role in roles:
        before, after = old["services"][role], new["services"][role]
        require(not before.get("build") and not after.get("build"), "local builds are unsupported")
        for key in ("volumes", "ports", "networks"):
            require(before.get(key) == after.get(key), f"{role} {key} changed")
        if role in {"postgres", "redis"}:
            require(before == after, f"{role} configuration changed; infrastructure updates are manual")
        else:
            require(before["image"] == f"ghcr.io/glosano/glosano:{source}", "unexpected installed image")
            require(after["image"] == f"ghcr.io/glosano/glosano:{target}", "unexpected target image")
            require(before.get("environment", {}).get("GLOSANO_REDIS_URL", "redis://redis:6379/0") == "redis://redis:6379/0", "external Redis requires a separate backup procedure")
            for key in before.get("environment", {}):
                require(before.get("environment", {}).get(key) == after.get("environment", {}).get(key), f"{role} {key} changed")


if __name__ == "__main__":
    try:
        # Windows PowerShell 5.1 can prefix native stdin with a UTF-8 BOM.
        payload = json.loads(sys.stdin.buffer.read().decode("utf-8-sig"))
        validate(payload["old"], payload["new"], payload["source"], payload["target"])
    except (ValueError, KeyError, TypeError) as error:
        sys.exit(f"Unsafe automatic update: {error}")
    print("Compose storage and configuration are compatible.")
