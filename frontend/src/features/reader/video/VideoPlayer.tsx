import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import type { LessonMedia } from '@/api/lessons'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/i18n'
import { mediaTime } from '@/lib/mediaTime'
import { observePlayback, type Interval, type Observation } from './playback'
import { createYouTubePlayer, type YouTubePlayer } from './youtubePlayer'

export interface VideoControls {
  pause(): void
  seek(seconds: number): void
  playFrom(seconds: number): void
}
interface Props {
  ref?: Ref<VideoControls>
  media: LessonMedia
  interval: Interval
  resetKey: string
  startTime?: number | null
  continueUntil?: number
  blocked?: boolean
  onTime(time: number): void
  onPlaying?(playing: boolean): void
  onBoundary?(): Interval | null
  onSeek?(time: number): Interval | null
}

export function VideoPlayer(props: Props) {
  const t = useTranslation()
  const latest = useRef(props)
  latest.current = props
  const host = useRef<HTMLDivElement>(null)
  const player = useRef<YouTubePlayer | null>(null)
  const acquiring = useRef<Promise<YouTubePlayer> | null>(null)
  const playIntent = useRef(0)
  const abort = useRef<AbortController | null>(null)
  const bound = useRef(props.interval)
  const previous = useRef<Observation | null>(null)
  const lastTime = useRef<number | null>(null)
  const state = useRef(2)
  const ended = useRef(false)
  const initialSeek = useRef<number | null>(null)
  const pendingSeek = useRef<{ time: number; at: number } | null>(null)
  const mounted = useRef(true)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const [time, setTime] = useState(props.interval.start)
  useEffect(() => {
    latest.current.onPlaying?.(playing)
  }, [playing])

  function pause() {
    playIntent.current++
    player.current?.pause()
    state.current = 2
    previous.current = null
    setPlaying(false)
  }
  function commandSeek(seconds: number) {
    if (!player.current) return
    pendingSeek.current = { time: seconds, at: performance.now() }
    previous.current = null
    player.current.seek(seconds)
  }
  function waitingForSeek(value: number) {
    const pending = pendingSeek.current
    if (!pending) return false
    if (value >= pending.time - 0.15 && value <= pending.time + 0.6) {
      pendingSeek.current = null
      previous.current = null
      return false
    }
    if (performance.now() - pending.at > 5000) {
      pendingSeek.current = null
      pause()
      setError(true)
    }
    return true
  }
  function seek(seconds: number) {
    pause()
    initialSeek.current = seconds
    ended.current = false
    commandSeek(seconds)
    setTime(seconds)
    latest.current.onTime(seconds)
  }
  function playFrom(seconds: number) {
    if (latest.current.blocked || document.hidden) return
    seek(seconds)
    void play()
  }
  useImperativeHandle(props.ref, () => ({ pause, seek, playFrom }))

  useEffect(() => {
    bound.current = { start: props.interval.start, end: props.interval.end }
  }, [props.interval.start, props.interval.end])
  useEffect(() => {
    bound.current = latest.current.interval
    const start = latest.current.startTime
    seek(
      start != null && start >= bound.current.start && start < bound.current.end
        ? start
        : bound.current.start,
    )
    // resetKey represents manual navigation; automatic paging changes only the bounds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.resetKey])
  useEffect(() => {
    if (props.blocked) pause()
  }, [props.blocked])
  useEffect(() => {
    mounted.current = true
    const visibility = () => {
      if (document.hidden) pause()
    }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      mounted.current = false
      abort.current?.abort()
      player.current?.destroy()
      player.current = null
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [])

  function handleSeek(value: number) {
    if (waitingForSeek(value)) return
    previous.current = null
    const destination = latest.current.onSeek?.(value)
    if (destination) {
      bound.current = destination
      return
    }
    if (value < bound.current.start - 0.15 || value >= bound.current.end) seek(bound.current.start)
  }

  useEffect(() => {
    if (!loaded) return
    const timer = window.setInterval(() => {
      const api = player.current
      if (!api) return
      const value = api.time()
      if (!Number.isFinite(value)) return
      if (waitingForSeek(value)) return
      setTime(value)
      latest.current.onTime(value)
      const changed = lastTime.current != null && Math.abs(value - lastTime.current) > 0.15
      lastTime.current = value
      if (state.current !== 1) {
        previous.current = null
        if (changed && (value < bound.current.start || value >= bound.current.end))
          handleSeek(value)
        return
      }
      if (latest.current.blocked || document.hidden) {
        pause()
        return
      }
      const sample = { time: value, wall: performance.now(), rate: api.rate() }
      const interval = { ...bound.current, end: latest.current.continueUntil ?? bound.current.end }
      const result = observePlayback(previous.current, sample, interval)
      previous.current = sample
      if (result === 'seek') {
        handleSeek(value)
        return
      }
      if (result === 'boundary') {
        const next = latest.current.onBoundary?.()
        if (next) {
          bound.current = next
          ended.current = false
        } else {
          pause()
          ended.current = true
        }
      }
    }, 100)
    return () => clearInterval(timer)
    // Handlers read latest props; polling must survive page changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

  async function play(repeat = false) {
    if (latest.current.blocked || document.hidden) return
    const intent = ++playIntent.current
    setError(false)
    setAutoplayBlocked(false)
    if (!player.current && host.current) {
      if (!acquiring.current) {
        setLoading(true)
        abort.current = new AbortController()
        acquiring.current = createYouTubePlayer(
          host.current,
          props.media.video_id,
          {
            onState: (value) => {
              if (!mounted.current) return
              state.current = value
              if (value === 1) {
                if (latest.current.blocked || document.hidden) {
                  pause()
                  return
                }
                if (ended.current) {
                  commandSeek(bound.current.start)
                  ended.current = false
                } else if (player.current) handleSeek(player.current.time())
              } else previous.current = null
              setPlaying(value === 1 || value === 3)
            },
            onError: () => {
              if (mounted.current) {
                pause()
                setError(true)
              }
            },
            onAutoplayBlocked: () => {
              if (mounted.current) {
                pause()
                setAutoplayBlocked(true)
              }
            },
          },
          abort.current.signal,
        ).then((api) => {
          if (!mounted.current) {
            api.destroy()
          } else {
            player.current = api
            setLoaded(true)
            commandSeek(initialSeek.current ?? bound.current.start)
          }
          return api
        })
      }
      try {
        await acquiring.current
      } catch {
        if (mounted.current && intent === playIntent.current) setError(true)
        return
      } finally {
        acquiring.current = null
        if (mounted.current) setLoading(false)
      }
    }
    const api = player.current
    if (
      !api ||
      !mounted.current ||
      latest.current.blocked ||
      document.hidden ||
      intent !== playIntent.current
    )
      return
    const now = pendingSeek.current?.time ?? api.time()
    if (repeat || ended.current || now < bound.current.start || now >= bound.current.end - 0.05)
      commandSeek(bound.current.start)
    ended.current = false
    initialSeek.current = null
    previous.current = null
    api.play()
  }

  return (
    <section aria-label={t('Видеоплеер')} className="mx-auto mt-4 max-w-[720px] space-y-3">
      <div className="relative aspect-video min-h-[200px] overflow-hidden rounded-xl bg-neutral-950 text-white">
        <div ref={host} className="absolute inset-0" />
        {!loaded && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <Play className="size-10 opacity-70" aria-hidden />
            <span className="line-clamp-2 font-medium">{props.media.title}</span>
            <span className="text-xs text-neutral-400">YouTube · {props.media.author}</span>
            <span className="max-w-sm text-xs text-neutral-400">
              {t('При нажатии Play браузер подключится к YouTube.')}
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="lg"
          disabled={loading || props.blocked}
          onClick={() => (playing ? pause() : void play())}
          aria-label={playing ? t('Пауза') : t('Воспроизвести фрагмент')}
        >
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
          {loading ? t('Загрузка…') : playing ? t('Пауза') : t('Воспроизвести')}
        </Button>
        <Button
          variant="outline"
          disabled={loading || props.blocked}
          onClick={() => void play(true)}
          aria-label={t('Повторить фрагмент')}
        >
          <RotateCcw aria-hidden />
          {t('Повторить фрагмент')}
        </Button>
        <span dir="ltr" className="text-xs tabular-nums text-muted-foreground">
          {mediaTime(time * 1000)} / {mediaTime(props.interval.end * 1000)}
        </span>
        <span className="text-xs text-muted-foreground">
          {props.media.language_code} ·{' '}
          {t(props.media.is_generated ? 'Автоматические субтитры' : 'Авторские субтитры')}
        </span>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t('Не удалось открыть видео. Текст доступен для изучения.')}{' '}
          <a
            href={props.media.canonical_url}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            {t('Открыть на YouTube')}
          </a>
        </p>
      )}
      {autoplayBlocked && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('Браузер остановил запуск. Нажмите «Воспроизвести» ещё раз.')}
        </p>
      )}
    </section>
  )
}
