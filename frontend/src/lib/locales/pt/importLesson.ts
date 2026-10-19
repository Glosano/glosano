import type { Catalog } from '@/lib/i18n'

export const importLessonMessages: Catalog = {
  File: 'Ficheiro',
  'Import method': 'Método de importação',
  'Drop a file here': 'Largue um ficheiro aqui',
  'Choose file': 'Escolher ficheiro',
  'Choose one file.': 'Escolha um ficheiro.',
  'Choose a .txt or .md file.': 'Escolha um ficheiro .txt ou .md.',
  'Only .txt and .md files with text content are supported.':
    'Só são suportados ficheiros .txt e .md com conteúdo de texto.',
  'The file must not exceed 5 MiB.': 'O ficheiro não pode exceder 5 MiB.',
  'Save the file as UTF-8 and try again.': 'Guarde o ficheiro em UTF-8 e tente de novo.',
  'The file must contain non-empty text.': 'O ficheiro deve conter texto não vazio.',
  'Upload a UTF-8 .txt or .md file, up to 5 MiB. Lesson language: {{language}}.':
    'Carregue um ficheiro .txt ou .md em UTF-8, até 5 MiB. Língua da lição: {{language}}.',
  'Could not process the lesson. Close this window and try importing again.':
    'Não foi possível processar a lição. Feche esta janela e tente importar de novo.',
  'Processing lesson… You can close this window: the import will continue.':
    'A processar a lição… Pode fechar esta janela: a importação continuará.',
  'Check status': 'Verificar estado',
}
