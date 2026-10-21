import type { Catalog } from '../../i18n'

export const admin: Catalog = {
  'AI settings': 'AI 設定',
  'API key': 'API キー',
  Administrator: '管理者',
  Application: 'アプリ',
  Environment: '環境変数',
  'Configuration source': '設定の取得元',
  'Connection preset': '接続プリセット',
  'Connection successful.': '接続に成功しました。',
  'Enable AI': 'AI を有効にする',
  'Enter a new key': '新しいキーを入力',
  'Keep saved key': '保存済みキーを保持',
  'No saved key': '保存済みキーなし',
  'Use no key / remove saved key': 'キーなし／保存済みキーを削除',
  'New API key': '新しい API キー',
  'Load models': 'モデル一覧を取得',
  'Model identifier': 'モデル識別子',
  'Other compatible server': 'その他の互換サーバー',
  'Reload settings': '設定を再読み込み',
  'Save AI settings': 'AI 設定を保存',
  'Saved configuration': '保存済み設定',
  'Server address': 'サーバーアドレス',
  'Test connection': '接続をテスト',
  'Working…': '処理中…',
  'AI is blocked by the server environment.': 'サーバー環境により AI が無効です。',
  'Settings changed elsewhere. Reload before saving.':
    '設定が別の場所で変更されました。保存前に再読み込みしてください。',
  'Enter a key for this server or choose no key.':
    'このサーバーのキーを入力するか、キーなしを選択してください。',
  'The saved key cannot be read. Enter it again or remove it.':
    '保存済みキーを読み取れません。再入力するか削除してください。',
  'The instance secret is unsuitable for encryption. Contact the server owner.':
    'インスタンスのシークレットが暗号化に適していません。サーバー管理者に連絡してください。',
  'Enter a valid server address. Metadata services are not allowed.':
    '有効なサーバーアドレスを入力してください。メタデータサービスは使用できません。',
  'Use HTTPS for a public server.': '公開サーバーには HTTPS を使用してください。',
  'Enter the server address and model.': 'サーバーアドレスとモデルを入力してください。',
  'Enter a valid API key or choose no key.':
    '有効な API キーを入力するか、キーなしを選択してください。',
  'The server rejected the API key.': 'サーバーが API キーを拒否しました。',
  'The model or endpoint was not found.': 'モデルまたはエンドポイントが見つかりません。',
  'This server does not list models. Enter the model manually.':
    'このサーバーはモデル一覧を提供しません。手動で入力してください。',
  'The server is unavailable. Check the address and connection.':
    'サーバーに接続できません。アドレスと接続を確認してください。',
  'The server did not respond in time.': 'サーバーの応答がタイムアウトしました。',
  'The provider is limiting requests. Try again later.':
    'プロバイダーがリクエストを制限しています。後で再試行してください。',
  'The server returned an incompatible response.': 'サーバーから互換性のない応答が返されました。',
  'The server response was too large.': 'サーバーの応答が大きすぎます。',
  'One connection for translations, chat and practice. AI is optional.':
    '翻訳・チャット・練習で接続を共有します。AI は任意です。',
  'You can always enter the model identifier manually.':
    'モデル識別子はいつでも手動で入力できます。',
  'For a model on the Docker host, use host.docker.internal instead of localhost. The model server must already be running.':
    'Docker ホスト上のモデルには localhost ではなく host.docker.internal を使用します。モデルサーバーを起動しておいてください。',
  'Testing sends a short diagnostic request and may incur a provider charge. It does not change your active connection.':
    'テストは短い診断リクエストを送信し、料金が発生する場合があります。有効な接続は変更されません。',
  'Models loaded: {{count}}': '読み込んだモデル数：{{count}}',
  'Search models': 'モデルを検索',
  'Choose a model': 'モデルを選択',
  'No matching models. Try another search or enter the identifier manually.':
    '一致するモデルがありません。検索条件を変えるか、モデル識別子を手動で入力してください。',
  'Choose a model, test the connection, then save the settings.':
    'モデルを選択し、接続をテストしてから設定を保存してください。',
}
