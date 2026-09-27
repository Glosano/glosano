const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com'])
const PATH_PREFIXES = new Set(['shorts', 'live', 'embed'])

/** Canonical watch URL for a YouTube video page, or null for anything else. */
export function youtubeWatchUrl(raw: string | undefined): string | null {
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  let id: string | null = null
  if (url.hostname === 'youtu.be') {
    id = url.pathname.split('/').filter(Boolean)[0] ?? null
  } else if (YOUTUBE_HOSTS.has(url.hostname)) {
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0] === 'watch') id = url.searchParams.get('v')
    else if (parts.length === 2 && PATH_PREFIXES.has(parts[0]!)) id = parts[1]!
  }
  // live/ID is not understood by the server's parser, so always send the watch form.
  return id && VIDEO_ID.test(id) ? `https://www.youtube.com/watch?v=${id}` : null
}
