import { type Catalog, ctx } from '@/lib/i18n'

export const videoMessages: Catalog = {
  'Pressing Play connects your browser to YouTube.':
    '再生を押すと、ブラウザがYouTubeに接続されます。',
  'Processing lesson…': 'レッスンを処理しています…',
  'Video player': 'ビデオプレーヤー',
  'Play fragment': 'フラグメントを再生',
  'Replay fragment': 'フラグメントをもう一度再生',
  Pause: '一時停止',
  'Creator captions': '投稿者の字幕',
  'Automatic captions': '自動字幕',
  'Could not open the video. You can still study the text.':
    '動画を開けませんでした。テキストでの学習は続けられます。',
  'Open on YouTube': 'YouTubeで開く',
  'Your browser blocked playback. Press ▶ again.':
    'ブラウザが再生をブロックしました。もう一度 ▶ を押してください。',
  [ctx('video', 'Stop')]: '停止',
  'Play on turn': 'ページ送り時に再生',
  'Advance automatically': '自動でページ送り',
  'Page turning': 'ページ送り',
  More: 'その他',
  'Pin video': '動画を固定',
  'Shrink video': '動画を縮小',
  'New words on the page you leave become known. You can undo this.':
    '移動前のページにある新しい単語は既知になります。この操作は取り消せます。',
  'New words in the fragment you leave become known. You can undo this.':
    '移動前のフラグメントにある新しい単語は既知になります。この操作は取り消せます。',
  'Saving page progress…': 'ページの進捗を保存しています…',
  'Saving fragment progress…': 'フラグメントの進捗を保存しています…',
  'Could not save the page. Retry saving, then press Play.':
    'ページを保存できませんでした。保存を再試行してから、再生を押してください。',
  'Could not save the fragment. Retry saving, then press Play.':
    'フラグメントを保存できませんでした。保存を再試行してから、再生を押してください。',
  'Play from {{time}}': '{{time}}から再生',
  'By fragment': 'フラグメントごと',
  'Previous fragment': '前のフラグメント',
  'Next fragment': '次のフラグメント',
  'YouTube link': 'YouTubeのリンク',
  Import: 'インポート',
  'Retry import': 'インポートを再試行',
  'Import the title and captions from YouTube. Language: {{language}}.':
    'YouTubeからタイトルと字幕をインポートします。言語：{{language}}。',
  'Prefer creator captions, then automatic captions in the same language.':
    '投稿者の字幕を優先し、なければ同じ言語の自動字幕を使います。',
  'Could not reach YouTube. Try importing again.':
    'YouTubeに接続できませんでした。もう一度インポートしてください。',
  'YouTube blocked requests from this server. Try again later.':
    'YouTubeがこのサーバーからのリクエストをブロックしました。しばらくしてからもう一度お試しください。',
  'This video has no captions in your learning language.':
    'この動画には、学習言語の字幕がありません。',
  'Captions are unavailable for this video.': 'この動画の字幕は利用できません。',
  'Video unavailable. Check the link and access to the video.':
    '動画を利用できません。リンクと動画へのアクセス権を確認してください。',
  'Could not retrieve the title. Check access to the video.':
    'タイトルを取得できませんでした。動画へのアクセス権を確認してください。',
  'Captions contain invalid text or timestamps.':
    '字幕に無効なテキストまたはタイムスタンプが含まれています。',
  'Captions exceed the limit: 5 MiB, 20,000 cues or 6 hours.':
    '字幕が上限を超えています：5 MiB、20,000キュー、または6時間。',
  'Import timed out. Try again.': 'インポートがタイムアウトしました。もう一度お試しください。',
  'Enter an HTTPS link to a single YouTube video.':
    'YouTube動画1本のHTTPSリンクを入力してください。',
  'Could not import this video. Try again later.':
    'この動画をインポートできませんでした。しばらくしてからもう一度お試しください。',
  'Edit text within each fragment. Timing and order stay the same.':
    '各フラグメント内のテキストを編集できます。タイミングと順序は変わりません。',
  'Fragment {{number}} · {{range}}': 'フラグメント {{number}} · {{range}}',
  'The material has changed or is still processing. Reload before saving.':
    '教材が変更されたか、まだ処理中です。保存する前に再読み込みしてください。',
}
