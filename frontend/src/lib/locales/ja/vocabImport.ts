import type { Catalog } from '@/lib/i18n'

export const vocabImportMessages: Catalog = {
  'More actions': 'その他の操作',
  'Import from LingQ…': 'LingQ からインポート…',
  'Import from LingQ': 'LingQ からインポート',
  'Words and phrases go to your {{language}} vocabulary.':
    '単語とフレーズは単語帳（{{language}}）に追加されます。',
  'New import': '新しいインポート',
  'By token (with levels)': 'トークンで（レベル付き）',
  'CSV file': 'CSV ファイル',
  'Import LingQ tags': 'LingQ のタグをインポート',
  'Paste your LingQ API key.': 'LingQ の API キーを貼り付けてください。',
  'Sign in to LingQ and open the API key page': 'LingQ にログインして API キーのページを開く',
  'Copy the key and paste it here': 'キーをコピーしてここに貼り付け',
  'LingQ API key': 'LingQ API キー',
  'The key is used only for this import and is not saved.':
    'キーはこのインポートにのみ使用され、保存されません。',
  'Words you marked as known while reading in LingQ are not transferred yet — only your LingQ cards.':
    'LingQ で読みながら既知にした単語はまだ移行されません。移行されるのは LingQ カードだけです。',
  'If a word is already in your vocabulary': '単語がすでに単語帳にある場合',
  'Keep its level': 'レベルをそのままにする',
  'Update from LingQ': 'LingQ の内容で更新する',
  'Start import': 'インポートを開始',
  'Choose a CSV file.': 'CSV ファイルを選択してください。',
  'A CSV export has no levels, review dates or known words. To transfer levels and review dates, use the token tab.':
    'CSV エクスポートにはレベル、復習日、既知の単語が含まれません。レベルと復習日を移行するには、トークンのタブを使ってください。',
  'Level for new words': '新しい単語のレベル',
  'Studying, confidence {{value}}': '学習中、習熟度 {{value}}',
  'Importing…': 'インポート中…',
  'Importing… {{done}} of {{total}}': 'インポート中… {{done}} / {{total}}',
  'You can close this window — the import will continue.':
    'このウィンドウを閉じてもインポートは続きます。',
  'Row {{row}}': '{{row}} 行目',
  'Import finished': 'インポートが完了しました',
  'Added: {{words}} words, {{phrases}} phrases': '追加：単語 {{words}} 件、フレーズ {{phrases}} 件',
  'Updated: {{value}}': '更新：{{value}}',
  'New known words: {{value}}': '新しい既知の単語：{{value}}',
  'Skipped: {{value}}': 'スキップ：{{value}}',
  'Show details': '詳細を表示',
  'and {{value}} more not shown': 'ほか {{value}} 件は表示されていません',
  'The import was interrupted. Start it again — nothing will be duplicated.':
    'インポートが中断されました。もう一度開始してください。重複は発生しません。',
  'The import failed. Try again later.': 'インポートに失敗しました。後でもう一度お試しください。',
  'Lost connection to the server — the import status is unknown.':
    'サーバーとの接続が切れました。インポートの状態は不明です。',
  'Check again': 'もう一度確認',
  'An import is already running.': 'インポートはすでに実行中です。',
  'Set your native language in the profile first.': '先にプロフィールで母語を設定してください。',
  'The file is not a UTF-8 CSV.': 'このファイルは UTF-8 の CSV ではありません。',
  'This does not look like a LingQ export: there is no "term" column.':
    'LingQ のエクスポートではないようです。「term」列がありません。',
  'The file looks damaged or is not a CSV export.':
    'ファイルが破損しているか、CSV エクスポートではありません。',
  'The file has too many rows.': 'ファイルの行数が多すぎます。',
  'The file is too large.': 'ファイルが大きすぎます。',
  'Choose a level for new words.': '新しい単語のレベルを選択してください。',
  'The import was not found.': 'インポートが見つかりません。',
  'LingQ rejected the key. Check it and try again.':
    'LingQ がキーを拒否しました。確認してもう一度お試しください。',
  'LingQ is unreachable from the server. Try again later.':
    'サーバーから LingQ に接続できません。後でもう一度お試しください。',
  'LingQ did not accept the request. Check the selected language.':
    'LingQ がリクエストを受け付けませんでした。選択した言語を確認してください。',
  'You have too many LingQ cards in this language to import by token.':
    'この言語の LingQ カードが多すぎるため、トークンではインポートできません。',
  'Empty term': '用語が空です',
  'Phrase is longer than 8 words': 'フレーズが 8 語を超えています',
  'Term is longer than 256 characters': '用語が 256 文字を超えています',
  'Translation skipped: language not supported': '翻訳をスキップ：対応していない言語です',
  'Translation is longer than 512 characters': '翻訳が 512 文字を超えています',
  'Tag is longer than 64 characters': 'タグが 64 文字を超えています',
  'Note is longer than 4000 characters': 'メモが 4000 文字を超えています',
  'This row was skipped.': 'この行はスキップされました。',
}
