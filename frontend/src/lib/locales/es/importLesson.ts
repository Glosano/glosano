import type { Catalog } from '@/lib/i18n'

export const importLessonMessages: Catalog = {
  File: 'Archivo',
  'Import method': 'Método de importación',
  'Drop a file here': 'Suelta un archivo aquí',
  'Choose file': 'Elegir archivo',
  'Choose one file.': 'Elige un solo archivo.',
  'Choose a .txt or .md file.': 'Elige un archivo .txt o .md.',
  'Only .txt and .md files with text content are supported.':
    'Solo se admiten archivos .txt y .md con contenido de texto.',
  'The file must not exceed 5 MiB.': 'El archivo no debe superar los 5 MiB.',
  'Save the file as UTF-8 and try again.': 'Guarda el archivo en UTF-8 e inténtalo de nuevo.',
  'The file must contain non-empty text.': 'El archivo debe contener texto.',
  'Upload a UTF-8 .txt or .md file, up to 5 MiB. Lesson language: {{language}}.':
    'Sube un archivo .txt o .md en UTF-8 de hasta 5 MiB. Idioma de la lección: {{language}}.',
  'Could not process the lesson. Close this window and try importing again.':
    'No se ha podido procesar la lección. Cierra esta ventana e intenta importarla de nuevo.',
  'Processing lesson… You can close this window: the import will continue.':
    'Procesando la lección… Puedes cerrar esta ventana: la importación continuará.',
  'Check status': 'Comprobar estado',
}
