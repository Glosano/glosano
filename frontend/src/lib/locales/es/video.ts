import { type Catalog, ctx } from '@/lib/i18n'

export const videoMessages: Catalog = {
  'Pressing Play connects your browser to YouTube.':
    'Al pulsar Reproducir, tu navegador se conectará a YouTube.',
  'Processing lesson…': 'Procesando la lección…',
  'Video player': 'Reproductor de vídeo',
  'Play fragment': 'Reproducir fragmento',
  'Replay fragment': 'Repetir fragmento',
  Pause: 'Pausa',
  'Creator captions': 'Subtítulos del autor',
  'Automatic captions': 'Subtítulos automáticos',
  'Could not open the video. You can still study the text.':
    'No se ha podido abrir el vídeo. Aún puedes estudiar el texto.',
  'Open on YouTube': 'Abrir en YouTube',
  'Your browser blocked playback. Press ▶ again.':
    'Tu navegador ha bloqueado la reproducción. Pulsa ▶ de nuevo.',
  [ctx('video', 'Stop')]: 'Detener',
  'Play on turn': 'Reproducir al cambiar de página',
  'Advance automatically': 'Avanzar automáticamente',
  'Page turning': 'Cambio de página',
  More: 'Más',
  'Pin video': 'Fijar vídeo',
  'Shrink video': 'Reducir vídeo',
  'New words on the page you leave become known. You can undo this.':
    'Las palabras nuevas de la página que dejas pasan a conocidas. Puedes deshacerlo.',
  'New words in the fragment you leave become known. You can undo this.':
    'Las palabras nuevas del fragmento que dejas pasan a conocidas. Puedes deshacerlo.',
  'Saving page progress…': 'Guardando el progreso de la página…',
  'Saving fragment progress…': 'Guardando el progreso del fragmento…',
  'Could not save the page. Retry saving, then press Play.':
    'No se ha podido guardar la página. Reintenta el guardado y pulsa Reproducir.',
  'Could not save the fragment. Retry saving, then press Play.':
    'No se ha podido guardar el fragmento. Reintenta el guardado y pulsa Reproducir.',
  'Play from {{time}}': 'Reproducir desde {{time}}',
  'By fragment': 'Por fragmentos',
  'Previous fragment': 'Fragmento anterior',
  'Next fragment': 'Fragmento siguiente',
  'YouTube link': 'Enlace de YouTube',
  Import: 'Importar',
  'Retry import': 'Reintentar la importación',
  'Import the title and captions from YouTube. Language: {{language}}.':
    'Se importarán el título y los subtítulos de YouTube. Idioma: {{language}}.',
  'Prefer creator captions, then automatic captions in the same language.':
    'Se prefieren los subtítulos del autor y, si no hay, los automáticos en el mismo idioma.',
  'Could not reach YouTube. Try importing again.':
    'No se ha podido conectar con YouTube. Intenta importar de nuevo.',
  'YouTube blocked requests from this server. Try again later.':
    'YouTube ha bloqueado las solicitudes de este servidor. Inténtalo de nuevo más tarde.',
  'This video has no captions in your learning language.':
    'Este vídeo no tiene subtítulos en tu idioma de estudio.',
  'Captions are unavailable for this video.':
    'Los subtítulos no están disponibles para este vídeo.',
  'Video unavailable. Check the link and access to the video.':
    'Vídeo no disponible. Comprueba el enlace y el acceso al vídeo.',
  'Could not retrieve the title. Check access to the video.':
    'No se ha podido obtener el título. Comprueba el acceso al vídeo.',
  'Captions contain invalid text or timestamps.':
    'Los subtítulos contienen texto o marcas de tiempo no válidos.',
  'Captions exceed the limit: 5 MiB, 20,000 cues or 6 hours.':
    'Los subtítulos superan el límite: 5 MiB, 20 000 líneas o 6 horas.',
  'Import timed out. Try again.': 'La importación ha tardado demasiado. Inténtalo de nuevo.',
  'Enter an HTTPS link to a single YouTube video.':
    'Introduce un enlace HTTPS a un único vídeo de YouTube.',
  'Could not import this video. Try again later.':
    'No se ha podido importar este vídeo. Inténtalo de nuevo más tarde.',
  'Edit text within each fragment. Timing and order stay the same.':
    'Edita el texto dentro de cada fragmento. Los tiempos y el orden no cambian.',
  'Fragment {{number}} · {{range}}': 'Fragmento {{number}} · {{range}}',
  'The material has changed or is still processing. Reload before saving.':
    'El material ha cambiado o todavía se está procesando. Recarga antes de guardar.',
}
