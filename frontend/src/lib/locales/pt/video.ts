import { type Catalog, ctx } from '@/lib/i18n'

export const videoMessages: Catalog = {
  'Pressing Play connects your browser to YouTube.':
    'Ao premir Play, o seu navegador liga-se ao YouTube.',
  'Processing lesson…': 'A processar a lição…',
  'Video player': 'Leitor de vídeo',
  'Play fragment': 'Reproduzir fragmento',
  'Replay fragment': 'Repetir fragmento',
  Pause: 'Pausar',
  'Creator captions': 'Legendas do autor',
  'Automatic captions': 'Legendas automáticas',
  'Could not open the video. You can still study the text.':
    'Não foi possível abrir o vídeo. Pode continuar a estudar o texto.',
  'Open on YouTube': 'Abrir no YouTube',
  'Your browser blocked playback. Press ▶ again.':
    'O navegador bloqueou a reprodução. Prima ▶ de novo.',
  [ctx('video', 'Stop')]: 'Parar',
  'Play on turn': 'Reproduzir ao mudar de página',
  'Advance automatically': 'Avançar automaticamente',
  'Page turning': 'Mudança de página',
  More: 'Mais',
  'Pin video': 'Fixar vídeo',
  'Shrink video': 'Reduzir vídeo',
  'New words on the page you leave become known. You can undo this.':
    'As palavras novas da página que deixa passam a conhecidas. Pode anular esta ação.',
  'New words in the fragment you leave become known. You can undo this.':
    'As palavras novas do fragmento que deixa passam a conhecidas. Pode anular esta ação.',
  'Saving page progress…': 'A guardar o progresso da página…',
  'Saving fragment progress…': 'A guardar o progresso do fragmento…',
  'Could not save the page. Retry saving, then press Play.':
    'Não foi possível guardar a página. Tente guardar de novo e, depois, prima Play.',
  'Could not save the fragment. Retry saving, then press Play.':
    'Não foi possível guardar o fragmento. Tente guardar de novo e, depois, prima Play.',
  'Play from {{time}}': 'Reproduzir a partir de {{time}}',
  'By fragment': 'Por fragmentos',
  'Previous fragment': 'Fragmento anterior',
  'Next fragment': 'Fragmento seguinte',
  'YouTube link': 'Ligação do YouTube',
  Import: 'Importar',
  'Retry import': 'Tentar importar de novo',
  'Import the title and captions from YouTube. Language: {{language}}.':
    'Importar o título e as legendas do YouTube. Língua: {{language}}.',
  'Prefer creator captions, then automatic captions in the same language.':
    'Dá-se preferência às legendas do autor e, depois, às automáticas na mesma língua.',
  'Could not reach YouTube. Try importing again.':
    'Não foi possível contactar o YouTube. Tente importar de novo.',
  'YouTube blocked requests from this server. Try again later.':
    'O YouTube bloqueou os pedidos deste servidor. Tente mais tarde.',
  'This video has no captions in your learning language.':
    'Este vídeo não tem legendas na língua que está a estudar.',
  'Captions are unavailable for this video.': 'Não há legendas disponíveis para este vídeo.',
  'Video unavailable. Check the link and access to the video.':
    'Vídeo indisponível. Verifique a ligação e o acesso ao vídeo.',
  'Could not retrieve the title. Check access to the video.':
    'Não foi possível obter o título. Verifique o acesso ao vídeo.',
  'Captions contain invalid text or timestamps.':
    'As legendas contêm texto ou marcas de tempo inválidos.',
  'Captions exceed the limit: 5 MiB, 20,000 cues or 6 hours.':
    'As legendas excedem o limite: 5 MiB, 20 000 entradas de legenda ou 6 horas.',
  'Import timed out. Try again.': 'A importação excedeu o tempo limite. Tente de novo.',
  'Enter an HTTPS link to a single YouTube video.':
    'Introduza uma ligação HTTPS para um único vídeo do YouTube.',
  'Could not import this video. Try again later.':
    'Não foi possível importar este vídeo. Tente mais tarde.',
  'Edit text within each fragment. Timing and order stay the same.':
    'Edite o texto dentro de cada fragmento. Os tempos e a ordem mantêm-se.',
  'Fragment {{number}} · {{range}}': 'Fragmento {{number}} · {{range}}',
  'The material has changed or is still processing. Reload before saving.':
    'O material foi alterado ou ainda está a ser processado. Recarregue antes de guardar.',
}
