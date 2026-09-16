"""Bounded YouTube-only adapter; external exception details never leave this module."""

from __future__ import annotations

import asyncio
import json
import re
import sys
import time
from contextlib import suppress
from dataclasses import asdict, dataclass
from typing import Any
from urllib.parse import parse_qs, urlsplit

import requests
from requests.adapters import HTTPAdapter
from youtube_transcript_api import YouTubeTranscriptApi

ACQUISITION_TIMEOUT_SECONDS = 120


class VideoImportError(Exception):
    def __init__(self, code: str, retryable: bool = False) -> None:
        self.code = code
        self.retryable = retryable
        super().__init__(code)


def parse_youtube_url(url: str) -> str:
    try:
        parsed = urlsplit(url)
        if (
            parsed.scheme != "https"
            or parsed.username
            or parsed.password
            or parsed.port not in (None, 443)
        ):
            raise ValueError
        host = parsed.hostname
        parts = parsed.path.strip("/").split("/")
        video_id = None
        if host == "youtu.be" and len(parts) == 1:
            video_id = parts[0]
        elif host in {"youtube.com", "www.youtube.com", "m.youtube.com"}:
            if parsed.path == "/watch":
                values = parse_qs(parsed.query).get("v", [])
                video_id = values[0] if len(values) == 1 else None
            elif len(parts) == 2 and parts[0] in {"embed", "shorts"}:
                video_id = parts[1]
        if video_id is None or not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
            raise ValueError
        return video_id
    except ValueError as exc:
        raise VideoImportError("invalid_url") from exc


def select_track(tracks: Any, language_code: str) -> Any:
    def matches(code: str) -> bool:
        code = code.lower()
        if language_code == "zh-Hans":
            return code in {"zh-hans", "zh-cn", "zh-sg"} or code.startswith("zh-hans-")
        return code == language_code or code.startswith(language_code + "-")

    candidates = [track for track in tracks if matches(track.language_code)]
    if not candidates:
        raise VideoImportError("captions_language_unavailable")
    return min(
        candidates,
        key=lambda t: (
            t.is_generated,
            t.language_code.lower() != language_code.lower(),
            t.language_code.lower(),
            t.language,
        ),
    )


@dataclass(frozen=True)
class VideoResult:
    video_id: str
    title: str
    author: str | None
    language_code: str
    is_generated: bool
    cues: list[Any]


class _BoundedAdapter(HTTPAdapter):
    """Read before requests' redirect machinery can consume an unbounded body."""

    def __init__(self, deadline: float) -> None:
        super().__init__()
        self.deadline = deadline

    def send(
        self,
        request: Any,
        stream: bool = False,
        timeout: Any = None,
        verify: Any = True,
        cert: Any = None,
        proxies: Any = None,
    ) -> Any:
        response = super().send(
            request, stream=stream, timeout=timeout, verify=verify, cert=cert, proxies=proxies
        )
        chunks: list[bytes] = []
        size = 0
        for chunk in response.iter_content(65536):
            size += len(chunk)
            if size > 16 * 1024 * 1024:
                response.close()
                raise VideoImportError("limit_exceeded")
            if time.monotonic() >= self.deadline:
                response.close()
                raise VideoImportError("network_error", True)
            chunks.append(chunk)
        response._content = b"".join(chunks)
        response._content_consumed = True  # pyright: ignore[reportAttributeAccessIssue]
        return response


class RestrictedSession(requests.Session):
    """Validate every send including redirects, with one acquisition deadline."""

    def __init__(self) -> None:
        super().__init__()
        self.trust_env = False
        self.deadline = time.monotonic() + 120
        self.max_redirects = 3
        self.mount("https://", _BoundedAdapter(self.deadline))

    def send(self, request: Any, **kwargs: Any) -> Any:
        parsed = urlsplit(request.url)
        if (
            parsed.scheme != "https"
            or parsed.hostname not in {"www.youtube.com", "youtube.com"}
            or parsed.port not in (None, 443)
            or parsed.username
            or parsed.password
            or parsed.path not in {"/watch", "/youtubei/v1/player", "/api/timedtext", "/oembed"}
        ):
            raise VideoImportError("request_blocked")
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise VideoImportError("network_error", True)
        kwargs["timeout"] = min(10, remaining)
        kwargs["stream"] = True
        return super().send(request, **kwargs)


class YouTubeTranscriptProvider:
    async def acquire(self, video_id: str, language_code: str) -> VideoResult:
        """Isolate blocking HTTP so the total deadline also terminates its I/O."""
        from glosano.modules.lesson_library.video_segments import Cue

        parse_youtube_url(f"https://youtu.be/{video_id}")
        deadline = asyncio.get_running_loop().time() + ACQUISITION_TIMEOUT_SECONDS
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-c",
            "from glosano.modules.lesson_library.youtube import acquire_main; acquire_main()",
            video_id,
            language_code,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            async with asyncio.timeout_at(deadline):
                output, _ = await process.communicate()
        except BaseException as exc:
            if process.returncode is None:
                with suppress(ProcessLookupError):
                    process.kill()
            # Drain/reap after cancellation as wait() alone can hang on a full pipe.
            await process.communicate()
            if isinstance(exc, TimeoutError):
                raise VideoImportError("network_error", True) from None
            raise
        if process.returncode != 0:
            raise VideoImportError("network_error", True)
        try:
            payload = json.loads(output)
            if "error" in payload:
                raise VideoImportError(payload["error"], payload["retryable"])
            return VideoResult(
                video_id=payload["video_id"],
                title=payload["title"],
                author=payload["author"],
                language_code=payload["language_code"],
                is_generated=payload["is_generated"],
                cues=[Cue(**cue) for cue in payload["cues"]],
            )
        except (ValueError, KeyError, TypeError):
            raise VideoImportError("invalid_transcript") from None

    def _acquire(self, video_id: str, language_code: str) -> VideoResult:
        from glosano.modules.lesson_library.video_segments import Cue, plain_text

        parse_youtube_url(f"https://youtu.be/{video_id}")
        with RestrictedSession() as session:
            for attempt in range(3):
                try:
                    track = select_track(
                        YouTubeTranscriptApi(http_client=session).list(video_id), language_code
                    )
                    transcript = track.fetch()
                    response = session.get(
                        "https://www.youtube.com/oembed",
                        params={
                            "url": f"https://www.youtube.com/watch?v={video_id}",
                            "format": "json",
                        },
                    )
                    response.raise_for_status()
                    metadata = response.json()
                    if not isinstance(metadata, dict) or not isinstance(metadata.get("title"), str):
                        raise VideoImportError("metadata_unavailable")
                    title = plain_text(metadata["title"]).strip()[:200]
                    if not title:
                        raise VideoImportError("metadata_unavailable")
                    return VideoResult(
                        video_id,
                        title,
                        plain_text(metadata.get("author_name") or "")[:200] or None,
                        track.language_code,
                        track.is_generated,
                        [
                            Cue(c.text, c.start * 1000, (c.start + c.duration) * 1000)
                            for c in transcript
                        ],
                    )
                except VideoImportError:
                    raise
                except Exception as exc:
                    code = type(exc).__name__
                    error = VideoImportError("invalid_transcript")
                    if isinstance(
                        exc,
                        (
                            requests.Timeout,
                            requests.ConnectionError,
                            requests.exceptions.ChunkedEncodingError,
                        ),
                    ):
                        error = VideoImportError("network_error", True)
                    elif isinstance(exc, requests.HTTPError) or isinstance(
                        exc.__context__, requests.HTTPError
                    ):
                        http_error = exc if isinstance(exc, requests.HTTPError) else exc.__context__
                        assert isinstance(http_error, requests.HTTPError)
                        response = http_error.response
                        error = (
                            VideoImportError("network_error", True)
                            if response is not None and response.status_code >= 500
                            else VideoImportError("request_blocked")
                        )
                    elif code in {
                        "RequestBlocked",
                        "IpBlocked",
                        "PoTokenRequired",
                        "AgeRestricted",
                    }:
                        error = VideoImportError("request_blocked")
                    elif code == "TranscriptsDisabled":
                        error = VideoImportError("transcripts_disabled")
                    elif code in {"VideoUnavailable", "VideoUnplayable", "InvalidVideoId"}:
                        error = VideoImportError("video_unavailable")
                    if not error.retryable or attempt == 2:
                        raise error from None
                    time.sleep(2**attempt)
        raise VideoImportError("network_error", True)


def acquire_main() -> None:
    """Private subprocess entry point; only safe structured output crosses IPC."""
    try:
        result = YouTubeTranscriptProvider()._acquire(sys.argv[1], sys.argv[2])
        payload = asdict(result)
    except VideoImportError as exc:
        payload = {"error": exc.code, "retryable": exc.retryable}
    except Exception:
        payload = {"error": "invalid_transcript", "retryable": False}
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
