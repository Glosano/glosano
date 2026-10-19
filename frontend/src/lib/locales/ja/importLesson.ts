import type { Catalog } from '@/lib/i18n'

export const importLessonMessages: Catalog = {
  File: 'ファイル',
  'Import method': 'インポート方法',
  'Drop a file here': 'ここにファイルをドロップ',
  'Choose file': 'ファイルを選択',
  'Choose one file.': 'ファイルを1つ選択してください。',
  'Choose a .txt or .md file.': '.txt または .md ファイルを選択してください。',
  'Only .txt and .md files with text content are supported.':
    'テキストを含む .txt と .md ファイルのみ対応しています。',
  'The file must not exceed 5 MiB.': 'ファイルサイズは5 MiB以内にしてください。',
  'Save the file as UTF-8 and try again.': 'ファイルをUTF-8で保存して、もう一度お試しください。',
  'The file must contain non-empty text.': 'ファイルには空でないテキストが必要です。',
  'Upload a UTF-8 .txt or .md file, up to 5 MiB. Lesson language: {{language}}.':
    'UTF-8の .txt または .md ファイルを、5 MiBまでアップロードしてください。レッスンの言語：{{language}}。',
  'Could not process the lesson. Close this window and try importing again.':
    'レッスンを処理できませんでした。このウィンドウを閉じて、もう一度インポートしてください。',
  'Processing lesson… You can close this window: the import will continue.':
    'レッスンを処理しています… このウィンドウは閉じても構いません。インポートは続行されます。',
  'Check status': '状況を確認',
}
