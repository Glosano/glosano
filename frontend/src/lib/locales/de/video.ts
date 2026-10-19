import { type Catalog, ctx } from '@/lib/i18n'

export const videoMessages: Catalog = {
  'Pressing Play connects your browser to YouTube.':
    'Beim Klick auf „Play“ verbindet sich Ihr Browser mit YouTube.',
  'Processing lesson…': 'Lektion wird verarbeitet…',
  'Video player': 'Videoplayer',
  'Play fragment': 'Abschnitt abspielen',
  'Replay fragment': 'Abschnitt wiederholen',
  Pause: 'Pause',
  'Creator captions': 'Untertitel des Urhebers',
  'Automatic captions': 'Automatische Untertitel',
  'Could not open the video. You can still study the text.':
    'Das Video konnte nicht geöffnet werden. Sie können den Text trotzdem lernen.',
  'Open on YouTube': 'Auf YouTube öffnen',
  'Your browser blocked playback. Press ▶ again.':
    'Ihr Browser hat die Wiedergabe blockiert. Drücken Sie erneut ▶.',
  [ctx('video', 'Stop')]: 'Stopp',
  'Play on turn': 'Beim Umblättern abspielen',
  'Advance automatically': 'Automatisch weiterblättern',
  'Page turning': 'Umblättern',
  More: 'Mehr',
  'Pin video': 'Video anheften',
  'Shrink video': 'Video verkleinern',
  'New words on the page you leave become known. You can undo this.':
    'Neue Wörter auf der verlassenen Seite werden als bekannt markiert. Sie können das rückgängig machen.',
  'New words in the fragment you leave become known. You can undo this.':
    'Neue Wörter im verlassenen Abschnitt werden als bekannt markiert. Sie können das rückgängig machen.',
  'Saving page progress…': 'Seitenfortschritt wird gespeichert…',
  'Saving fragment progress…': 'Abschnittsfortschritt wird gespeichert…',
  'Could not save the page. Retry saving, then press Play.':
    'Die Seite konnte nicht gespeichert werden. Speichern Sie erneut und drücken Sie dann „Play“.',
  'Could not save the fragment. Retry saving, then press Play.':
    'Der Abschnitt konnte nicht gespeichert werden. Speichern Sie erneut und drücken Sie dann „Play“.',
  'Play from {{time}}': 'Ab {{time}} abspielen',
  'By fragment': 'Nach Abschnitten',
  'Previous fragment': 'Vorheriger Abschnitt',
  'Next fragment': 'Nächster Abschnitt',
  'YouTube link': 'YouTube-Link',
  Import: 'Importieren',
  'Retry import': 'Import wiederholen',
  'Import the title and captions from YouTube. Language: {{language}}.':
    'Titel und Untertitel werden von YouTube importiert. Sprache: {{language}}.',
  'Prefer creator captions, then automatic captions in the same language.':
    'Zuerst Untertitel des Urhebers, dann automatische Untertitel in derselben Sprache.',
  'Could not reach YouTube. Try importing again.':
    'YouTube ist nicht erreichbar. Versuchen Sie den Import erneut.',
  'YouTube blocked requests from this server. Try again later.':
    'YouTube hat Anfragen dieses Servers blockiert. Versuchen Sie es später erneut.',
  'This video has no captions in your learning language.':
    'Dieses Video hat keine Untertitel in Ihrer Lernsprache.',
  'Captions are unavailable for this video.': 'Für dieses Video sind keine Untertitel verfügbar.',
  'Video unavailable. Check the link and access to the video.':
    'Video nicht verfügbar. Prüfen Sie den Link und den Zugriff auf das Video.',
  'Could not retrieve the title. Check access to the video.':
    'Der Titel konnte nicht abgerufen werden. Prüfen Sie den Zugriff auf das Video.',
  'Captions contain invalid text or timestamps.':
    'Die Untertitel enthalten ungültigen Text oder ungültige Zeitstempel.',
  'Captions exceed the limit: 5 MiB, 20,000 cues or 6 hours.':
    'Die Untertitel überschreiten das Limit: 5 MiB, 20.000 Einträge oder 6 Stunden.',
  'Import timed out. Try again.': 'Zeitüberschreitung beim Import. Versuchen Sie es erneut.',
  'Enter an HTTPS link to a single YouTube video.':
    'Geben Sie einen HTTPS-Link zu einem einzelnen YouTube-Video ein.',
  'Could not import this video. Try again later.':
    'Dieses Video konnte nicht importiert werden. Versuchen Sie es später erneut.',
  'Edit text within each fragment. Timing and order stay the same.':
    'Bearbeiten Sie den Text innerhalb der Abschnitte. Zeiten und Reihenfolge bleiben unverändert.',
  'Fragment {{number}} · {{range}}': 'Abschnitt {{number}} · {{range}}',
  'The material has changed or is still processing. Reload before saving.':
    'Das Material hat sich geändert oder wird noch verarbeitet. Laden Sie die Seite vor dem Speichern neu.',
}
