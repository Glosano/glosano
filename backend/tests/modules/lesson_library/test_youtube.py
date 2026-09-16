from collections.abc import Iterator
from types import SimpleNamespace

import pytest
from requests.adapters import HTTPAdapter

from flinq.modules.lesson_library.video_segments import Cue, prepare_fragments
from flinq.modules.lesson_library.youtube import VideoImportError, parse_youtube_url, select_track


@pytest.mark.parametrize(
    "url",
    [
        "https://youtu.be/M7lc1UVf-VE?t=9",
        "https://www.youtube.com/watch?v=M7lc1UVf-VE",
        "https://m.youtube.com/shorts/M7lc1UVf-VE",
    ],
)
def test_canonical_id(url: str) -> None:
    assert parse_youtube_url(url) == "M7lc1UVf-VE"


@pytest.mark.parametrize(
    "url",
    [
        "http://youtu.be/M7lc1UVf-VE",
        "https://evil.test/watch?v=M7lc1UVf-VE",
        "https://youtube.com@evil.test/watch?v=M7lc1UVf-VE",
        "https://youtube.com/playlist?list=x",
        "https://youtu.be/short",
    ],
)
def test_invalid_url(url: str) -> None:
    with pytest.raises(VideoImportError):
        parse_youtube_url(url)


def test_language_priority_and_chinese():
    tracks = [
        SimpleNamespace(language_code=code, is_generated=auto, language=code)
        for code, auto in [("pt", True), ("pt-BR", False), ("pt-PT", False)]
    ]
    assert select_track(tracks, "pt").language_code == "pt-BR"
    tracks = [
        SimpleNamespace(language_code=code, is_generated=False, language=code)
        for code in ["zh", "zh-TW", "zh-CN"]
    ]
    assert select_track(tracks, "zh-Hans").language_code == "zh-CN"
    with pytest.raises(VideoImportError, match="captions_language_unavailable"):
        select_track(tracks[:2], "zh-Hans")


def test_overlap_equal_starts_and_gaps():
    cues = [
        Cue("<b>Hello</b> &amp;\nworld", 0, 4000),
        Cue("again", 0, 3000),
        Cue("today.", 2000, 3000),
        Cue("Next.", 5000, 6000),
    ]
    snapshot, fragments = prepare_fragments(cues, "en")
    assert snapshot[0]["end_ms"] == 4000
    assert [(f.text, f.media_start_ms, f.media_end_ms) for f in fragments] == [
        ("Hello & world again today.", 0, 3000),
        ("Next.", 5000, 6000),
    ]
    assert fragments[0].cue_intervals == [
        {"start_ms": 0, "end_ms": 2000},
        {"start_ms": 2000, "end_ms": 3000},
    ]


@pytest.mark.parametrize(
    "cues",
    [
        [],
        [Cue("a", -1, 2)],
        [Cue("a", 2, 2)],
        [Cue("a", 0, float("inf"))],
        [Cue("a", 2, 3), Cue("b", 0, 1)],
        [Cue("a", 0, 21600001)],
        [Cue("!!!", 0, 1000)],
    ],
)
def test_invalid_track(cues: list[Cue]) -> None:
    with pytest.raises(VideoImportError):
        prepare_fragments(cues, "en")


def test_grouping_respects_abbreviations_soft_limits_and_cue_boundaries():
    _, fragments = prepare_fragments(
        [Cue("Dr.", 0, 1000), Cue("Smith speaks.", 1000, 2000), Cue("First. Second.", 2000, 3000)],
        "en",
    )
    assert [f.text for f in fragments] == ["Dr. Smith speaks.", "First. Second."]
    _, fragments = prepare_fragments(
        [Cue("words " * 61, 0, 25000), Cue("next", 25000, 26000)], "en"
    )
    assert len(fragments) == 2


def test_restricted_session_blocks_redirect_targets_before_network() -> None:
    import requests

    from flinq.modules.lesson_library.youtube import RestrictedSession

    with RestrictedSession() as session:
        request = requests.Request("GET", "https://127.0.0.1/private").prepare()
        with pytest.raises(VideoImportError, match="request_blocked"):
            session.send(request)


def test_limits_include_empty_cues_and_original_order() -> None:
    with pytest.raises(VideoImportError, match="limit_exceeded"):
        prepare_fragments([Cue("", i, i + 1) for i in range(20001)], "en")
    with pytest.raises(VideoImportError, match="limit_exceeded"):
        prepare_fragments([Cue("a" * (5 * 1024 * 1024 + 1), 0, 1000)], "en")
    snapshot, fragments = prepare_fragments(
        [Cue("Hello", 0, 1000), Cue("Hello", 0, 1000), Cue("Hello", 1000, 2000)], "en"
    )
    assert len(snapshot) == 2
    assert fragments[0].text == "Hello Hello"


@pytest.mark.parametrize(
    "status,retries,code",
    [(503, 3, "network_error"), (429, 1, "request_blocked"), (403, 1, "request_blocked")],
)
def test_provider_http_status_policy(
    monkeypatch: pytest.MonkeyPatch, status: int, retries: int, code: str
) -> None:
    import requests
    from youtube_transcript_api import YouTubeRequestFailed

    from flinq.modules.lesson_library.youtube import YouTubeTranscriptProvider

    calls = []

    def unavailable(*args: object) -> None:
        calls.append(1)
        response = requests.Response()
        response.status_code = status
        try:
            response.raise_for_status()
        except requests.HTTPError as error:
            raise YouTubeRequestFailed("M7lc1UVf-VE", error) from error

    monkeypatch.setattr(
        "flinq.modules.lesson_library.youtube.YouTubeTranscriptApi.list", unavailable
    )

    def no_sleep(_: float) -> None:
        pass

    monkeypatch.setattr("flinq.modules.lesson_library.youtube.time.sleep", no_sleep)
    with pytest.raises(VideoImportError, match=code):
        YouTubeTranscriptProvider()._acquire("M7lc1UVf-VE", "en")
    assert len(calls) == retries


def test_redirect_cannot_fetch_external_host(monkeypatch: pytest.MonkeyPatch) -> None:
    from io import BytesIO
    from typing import Any

    import requests

    from flinq.modules.lesson_library.youtube import RestrictedSession

    urls: list[str] = []

    def transport(_self: Any, request: Any, **kwargs: Any) -> requests.Response:
        urls.append(request.url)
        response = requests.Response()
        response.status_code = 302
        response.url = request.url
        response.request = request
        response.headers["Location"] = "https://127.0.0.1/private"
        response.raw = BytesIO(b"redirect")
        return response

    monkeypatch.setattr(HTTPAdapter, "send", transport)
    with RestrictedSession() as session, pytest.raises(VideoImportError, match="request_blocked"):
        session.get("https://www.youtube.com/watch?v=M7lc1UVf-VE")
    assert len(urls) == 1


def test_oversized_redirect_body_is_bounded_before_following(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from typing import Any

    import requests

    from flinq.modules.lesson_library.youtube import RestrictedSession

    class StreamingBody:
        consumed = 0

        def stream(self, amount: int, decode_content: bool = True) -> Iterator[bytes]:
            for _ in range(4000):
                self.consumed += amount
                yield b"a" * amount

        def close(self) -> None:
            pass

        def release_conn(self) -> None:
            pass

    raw = StreamingBody()

    def transport(_self: Any, request: Any, **kwargs: Any) -> requests.Response:
        response = requests.Response()
        response.status_code = 302
        response.url = request.url
        response.request = request
        response.headers["Location"] = "https://127.0.0.1/private"
        response.raw = raw
        return response

    monkeypatch.setattr(HTTPAdapter, "send", transport)
    with RestrictedSession() as session, pytest.raises(VideoImportError, match="limit_exceeded"):
        session.get("https://www.youtube.com/watch?v=M7lc1UVf-VE")
    assert raw.consumed <= 16 * 1024 * 1024 + 65536


async def test_acquisition_terminates_underlying_slow_transfer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import asyncio
    import sys
    from typing import Any

    from flinq.modules.lesson_library import youtube

    processes: list[asyncio.subprocess.Process] = []
    spawn = asyncio.create_subprocess_exec

    async def slow_child(*args: Any, **kwargs: Any) -> asyncio.subprocess.Process:
        # A real child remains stuck in a transfer producing small increments;
        # socket inactivity limits would never expire this process.
        process = await spawn(
            sys.executable,
            "-c",
            "import sys,time\nwhile True:\n "
            'sys.stdout.write("x");sys.stdout.flush();time.sleep(.01)',
            **kwargs,
        )
        processes.append(process)
        return process

    monkeypatch.setattr(asyncio, "create_subprocess_exec", slow_child)
    monkeypatch.setattr(youtube, "ACQUISITION_TIMEOUT_SECONDS", 0.1, raising=False)
    with pytest.raises(VideoImportError, match="network_error"):
        await asyncio.wait_for(youtube.YouTubeTranscriptProvider().acquire("M7lc1UVf-VE", "en"), 2)
    assert len(processes) == 1
    assert processes[0].returncode is not None and processes[0].returncode < 0


async def test_provider_subprocess_returns_typed_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio
    from typing import Any

    from flinq.modules.lesson_library.youtube import YouTubeTranscriptProvider

    spawn = asyncio.create_subprocess_exec

    async def fixture_child(*args: Any, **kwargs: Any) -> asyncio.subprocess.Process:
        script = (
            "from flinq.modules.lesson_library.youtube import "
            "YouTubeTranscriptProvider,VideoResult,acquire_main;"
            "from flinq.modules.lesson_library.video_segments import Cue;"
            "YouTubeTranscriptProvider._acquire=lambda *args: "
            'VideoResult("M7lc1UVf-VE","Title",None,"en-US",True,[Cue("Hello.",0,1000)]);'
            "acquire_main()"
        )
        return await spawn(args[0], "-c", script, *args[3:], **kwargs)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fixture_child)
    result = await YouTubeTranscriptProvider().acquire("M7lc1UVf-VE", "en")
    assert result.language_code == "en-US" and result.is_generated
    assert result.cues == [Cue("Hello.", 0, 1000)]


async def test_cancelled_acquisition_reaps_child(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio
    import sys
    from typing import Any

    from flinq.modules.lesson_library.youtube import YouTubeTranscriptProvider

    spawn = asyncio.create_subprocess_exec
    started = asyncio.Event()
    processes: list[asyncio.subprocess.Process] = []

    async def child(*args: Any, **kwargs: Any) -> asyncio.subprocess.Process:
        process = await spawn(sys.executable, "-c", "import time; time.sleep(60)", **kwargs)
        processes.append(process)
        started.set()
        return process

    monkeypatch.setattr(asyncio, "create_subprocess_exec", child)
    task = asyncio.create_task(YouTubeTranscriptProvider().acquire("M7lc1UVf-VE", "en"))
    await asyncio.wait_for(started.wait(), 2)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert processes[0].returncode is not None and processes[0].returncode < 0
