export interface YouTubePlayer {
  play(): void
  pause(): void
  seek(seconds: number): void
  time(): number
  rate(): number
  destroy(): void
}
interface Events {
  onState(state: number): void
  onError(code: number): void
  onAutoplayBlocked(): void
}
interface NativePlayer {
  playVideo(): void
  pauseVideo(): void
  seekTo(time: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  getPlaybackRate(): number
  destroy(): void
}
interface YouTubeAPI {
  Player: new (
    element: HTMLElement,
    config: {
      events: {
        onReady(): void
        onStateChange(event: { data: number }): void
        onError(event: { data: number }): void
        onAutoplayBlocked(): void
      }
    },
  ) => NativePlayer
}
declare global {
  interface Window {
    YT?: YouTubeAPI
    onYouTubeIframeAPIReady?: () => void
  }
}
let loading: Promise<YouTubeAPI> | null = null

function loadAPI(): Promise<YouTubeAPI> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (loading) return loading
  loading = new Promise<YouTubeAPI>((resolve, reject) => {
    const script = document.createElement('script')
    const prior = window.onYouTubeIframeAPIReady
    const finish = (error?: Error) => {
      window.clearTimeout(timeout)
      script.onerror = null
      window.onYouTubeIframeAPIReady = prior
      if (error) {
        script.remove()
        reject(error)
      } else if (window.YT) resolve(window.YT)
    }
    const timeout = window.setTimeout(() => finish(new Error('YouTube API timeout')), 20000)
    window.onYouTubeIframeAPIReady = () => {
      finish()
      prior?.()
    }
    script.src = 'https://www.youtube.com/iframe_api'
    script.onerror = () => finish(new Error('YouTube API unavailable'))
    document.head.append(script)
  }).catch((error: unknown) => {
    loading = null
    throw error
  })
  return loading
}

export async function createYouTubePlayer(
  host: HTMLElement,
  videoId: string,
  events: Events,
  signal?: AbortSignal,
): Promise<YouTubePlayer> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error('Invalid YouTube id')
  const api = await loadAPI()
  signal?.throwIfAborted()
  const iframe = document.createElement('iframe')
  const query = new URLSearchParams({
    enablejsapi: '1',
    origin: window.location.origin,
    playsinline: '1',
    controls: '1',
  })
  iframe.src = `https://www.youtube.com/embed/${videoId}?${query}`
  iframe.title = 'YouTube'
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
  iframe.allowFullscreen = true
  iframe.referrerPolicy = 'strict-origin-when-cross-origin'
  iframe.className = 'h-full w-full border-0'
  host.replaceChildren(iframe)
  return new Promise((resolve, reject) => {
    let ready = false
    const cleanup = () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
    const abort = () => {
      cleanup()
      native.destroy()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const timeout = setTimeout(() => {
      cleanup()
      native.destroy()
      reject(new Error('YouTube player timeout'))
    }, 20000)
    const native = new api.Player(iframe, {
      events: {
        onReady: () => {
          ready = true
          cleanup()
          resolve({
            play: () => native.playVideo(),
            pause: () => native.pauseVideo(),
            seek: (time) => native.seekTo(time, true),
            time: () => native.getCurrentTime(),
            rate: () => native.getPlaybackRate() || 1,
            destroy: () => native.destroy(),
          })
        },
        onStateChange: ({ data }) => events.onState(data),
        onError: ({ data }) => {
          events.onError(data)
          if (!ready) {
            cleanup()
            native.destroy()
            reject(new Error(`YouTube error ${data}`))
          }
        },
        onAutoplayBlocked: events.onAutoplayBlocked,
      },
    })
    signal?.addEventListener('abort', abort, { once: true })
  })
}
