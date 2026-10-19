import { msg } from '@/lib/i18n'

export const VIDEO_IMPORT_ERRORS: Record<string, string> = {
  invalid_url: msg('Enter an HTTPS link to a single YouTube video.'),
  captions_language_unavailable: msg('This video has no captions in your learning language.'),
  import_expired: msg('Import timed out. Try again.'),
  import_failed: msg('Could not import this video. Try again later.'),
  queue_unavailable: msg('Could not import this video. Try again later.'),
  network_error: msg('Could not reach YouTube. Try importing again.'),
  request_blocked: msg('YouTube blocked requests from this server. Try again later.'),
  no_matching_transcript: msg('This video has no captions in your learning language.'),
  transcripts_disabled: msg('Captions are unavailable for this video.'),
  video_unavailable: msg('Video unavailable. Check the link and access to the video.'),
  metadata_unavailable: msg('Could not retrieve the title. Check access to the video.'),
  invalid_transcript: msg('Captions contain invalid text or timestamps.'),
  limit_exceeded: msg('Captions exceed the limit: 5 MiB, 20,000 cues or 6 hours.'),
  import_timeout: msg('Import timed out. Try again.'),
  invalid_youtube_url: msg('Enter an HTTPS link to a single YouTube video.'),
}

export function videoImportError(code?: string): string {
  return (code && VIDEO_IMPORT_ERRORS[code]) || msg('Could not import this video. Try again later.')
}
