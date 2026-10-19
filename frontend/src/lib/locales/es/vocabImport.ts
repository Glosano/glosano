import type { Catalog } from '@/lib/i18n'

export const vocabImportMessages: Catalog = {
  'More actions': 'Más acciones',
  'Import from LingQ…': 'Importar de LingQ…',
  'Import from LingQ': 'Importar de LingQ',
  'Words and phrases go to your {{language}} vocabulary.':
    'Las palabras y frases se añaden a tu vocabulario ({{language}}).',
  'New import': 'Nueva importación',
  'By token (with levels)': 'Por token (con niveles)',
  'CSV file': 'Archivo CSV',
  'Import LingQ tags': 'Importar etiquetas de LingQ',
  'Paste your LingQ API key.': 'Pega tu clave de API de LingQ.',
  'Sign in to LingQ and open the API key page':
    'Inicia sesión en LingQ y abre la página de la clave de API',
  'Copy the key and paste it here': 'Copia la clave y pégala aquí',
  'LingQ API key': 'Clave de API de LingQ',
  'The key is used only for this import and is not saved.':
    'La clave solo se usa para esta importación y no se guarda.',
  'Words you marked as known while reading in LingQ are not transferred yet — only your LingQ cards.':
    'Las palabras que marcaste como conocidas al leer en LingQ aún no se transfieren, solo tus tarjetas de LingQ.',
  'If a word is already in your vocabulary': 'Si una palabra ya está en tu vocabulario',
  'Keep its level': 'Mantener su nivel',
  'Update from LingQ': 'Actualizar desde LingQ',
  'Start import': 'Iniciar importación',
  'Choose a CSV file.': 'Elige un archivo CSV.',
  'A CSV export has no levels, review dates or known words. To transfer levels and review dates, use the token tab.':
    'Una exportación CSV no tiene niveles, fechas de repaso ni palabras conocidas. Para transferir los niveles y las fechas de repaso, usa la pestaña por token.',
  'Level for new words': 'Nivel para las palabras nuevas',
  'Studying, confidence {{value}}': 'En estudio, confianza {{value}}',
  'Importing…': 'Importando…',
  'Importing… {{done}} of {{total}}': 'Importando… {{done}} de {{total}}',
  'You can close this window — the import will continue.':
    'Puedes cerrar esta ventana: la importación continuará.',
  'Row {{row}}': 'Fila {{row}}',
  'Import finished': 'Importación terminada',
  'Added: {{words}} words, {{phrases}} phrases':
    'Añadidas: palabras — {{words}}, frases — {{phrases}}',
  'Updated: {{value}}': 'Actualizadas: {{value}}',
  'New known words: {{value}}': 'Nuevas palabras conocidas: {{value}}',
  'Skipped: {{value}}': 'Omitidas: {{value}}',
  'Show details': 'Mostrar detalles',
  'and {{value}} more not shown': 'y {{value}} más sin mostrar',
  'The import was interrupted. Start it again — nothing will be duplicated.':
    'La importación se interrumpió. Vuelve a iniciarla: no se duplicará nada.',
  'The import failed. Try again later.': 'La importación ha fallado. Inténtalo de nuevo más tarde.',
  'Lost connection to the server — the import status is unknown.':
    'Se perdió la conexión con el servidor: el estado de la importación es desconocido.',
  'Check again': 'Comprobar de nuevo',
  'An import is already running.': 'Ya hay una importación en curso.',
  'Set your native language in the profile first.':
    'Primero indica tu lengua materna en el perfil.',
  'The file is not a UTF-8 CSV.': 'El archivo no es un CSV en UTF-8.',
  'This does not look like a LingQ export: there is no "term" column.':
    'No parece una exportación de LingQ: no hay columna «term».',
  'The file looks damaged or is not a CSV export.':
    'El archivo parece dañado o no es una exportación CSV.',
  'The file has too many rows.': 'El archivo tiene demasiadas filas.',
  'The file is too large.': 'El archivo es demasiado grande.',
  'Choose a level for new words.': 'Elige un nivel para las palabras nuevas.',
  'The import was not found.': 'No se encontró la importación.',
  'LingQ rejected the key. Check it and try again.':
    'LingQ ha rechazado la clave. Compruébala e inténtalo de nuevo.',
  'LingQ is unreachable from the server. Try again later.':
    'El servidor no puede conectar con LingQ. Inténtalo de nuevo más tarde.',
  'LingQ did not accept the request. Check the selected language.':
    'LingQ no ha aceptado la solicitud. Comprueba el idioma seleccionado.',
  'You have too many LingQ cards in this language to import by token.':
    'Tienes demasiadas tarjetas de LingQ en este idioma para importarlas por token.',
  'Empty term': 'Término vacío',
  'Phrase is longer than 8 words': 'La frase tiene más de 8 palabras',
  'Term is longer than 256 characters': 'El término tiene más de 256 caracteres',
  'Translation skipped: language not supported': 'Traducción omitida: idioma no compatible',
  'Translation is longer than 512 characters': 'La traducción tiene más de 512 caracteres',
  'Tag is longer than 64 characters': 'La etiqueta tiene más de 64 caracteres',
  'Note is longer than 4000 characters': 'La nota tiene más de 4000 caracteres',
  'This row was skipped.': 'Esta fila se ha omitido.',
}
