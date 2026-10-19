import type { Catalog } from '@/lib/i18n'

export const commonMessages: Catalog = {
  Settings: '設定',
  Profile: 'プロフィール',
  Preferences: '環境設定',
  Data: 'データ',
  Library: 'ライブラリ',
  Vocabulary: '単語帳',
  'Sign out': 'ログアウト',
  'Account menu': 'アカウントメニュー',
  'Material language': '教材の言語',
  'Add language': '言語を追加',
  'Adding…': '追加しています…',
  'Choose a language to study.': '学習する言語を選択してください。',
  'All available languages have already been added.': '利用可能な言語はすべて追加済みです。',
  'Interface language': '表示言語',
  'Loading…': '読み込んでいます…',
  Close: '閉じる',
  Cancel: 'キャンセル',
  Retry: '再試行',
  Save: '保存',
  'Saving…': '保存しています…',
  Saved: '保存しました',
  'Display name': '表示名',
  Email: 'メールアドレス',
  'Email cannot be changed.': 'メールアドレスは変更できません。',
  'Change password': 'パスワードを変更',
  'Current password': '現在のパスワード',
  'Enter your current password.': '現在のパスワードを入力してください。',
  'New password': '新しいパスワード',
  'Confirm new password': '新しいパスワード（確認）',
  'Password must contain 10 to 128 characters.': 'パスワードは10〜128文字で入力してください。',
  'Passwords do not match.': 'パスワードが一致しません。',
  'Enter a display name of 1 to 80 characters.': '表示名は1〜80文字で入力してください。',
  'Password changed. Sign in again on your other devices.':
    'パスワードを変更しました。ほかのデバイスでは、もう一度ログインしてください。',
  'Learning languages': '学習言語',
  'Choose at least one language.': '言語を1つ以上選択してください。',
  'Removing a language from this list keeps your lessons, vocabulary and progress.':
    'この一覧から言語を削除しても、レッスン、単語帳、進捗は保持されます。',
  'Instructions and explanations will use the interface language.':
    '指示や説明には表示言語が使われます。',
  'Native language': '母語',
  'New translations are made into this language. Saved translations stay unchanged.':
    '新しい翻訳はこの言語で作成されます。保存済みの翻訳は変更されません。',
  'Choose your native language': '母語を選択してください',
  'Choose a language': '言語を選択',
  '{{language}} was removed from your learning languages: you cannot study your native language. Your lessons and vocabulary are kept.':
    '{{language}}は母語のため学習できません。学習言語から削除しました。レッスンと単語帳は保持されます。',
  'Your native language cannot be a learning language': '母語を学習言語にすることはできません',
  'This is your native language — change it above': 'これはあなたの母語です。上で変更してください',
  'Reading goal, minutes per day': '読書の目標（1日あたりの分数）',
  'A personal goal. Reading time is not measured yet.':
    '個人の目標です。読書時間はまだ計測されません。',
  'Daily review limit': '1日の復習上限',
  'Enter a whole number within the allowed range.': '許可された範囲内の整数を入力してください。',
  'Export data': 'データのエクスポート',
  'Download your profile, preferences, lessons, vocabulary, review history and statistics as JSON.':
    'プロフィール、環境設定、レッスン、単語帳、復習履歴、統計をJSONでダウンロードします。',
  'Download JSON': 'JSONをダウンロード',
  'Preparing download…': 'ダウンロードを準備しています…',
  'Your download is ready.': 'ダウンロードの準備ができました。',
  'Delete account': 'アカウントを削除',
  'Deletion is permanent. Your profile, your own lessons, vocabulary and progress will be deleted.':
    '削除は元に戻せません。プロフィール、ご自身のレッスン、単語帳、進捗が削除されます。',
  'Your own shared lessons will also be deleted. Other users’ lessons and the shared dictionary will remain.':
    'ご自身が共有したレッスンも削除されます。ほかのユーザーのレッスンと共有辞書は残ります。',
  'Continue with deletion': '削除を続ける',
  'Confirm deletion': '削除の確認',
  'Enter your password to permanently delete your account.':
    'アカウントを完全に削除するには、パスワードを入力してください。',
  Password: 'パスワード',
  'Delete permanently': '完全に削除',
  'Deleting…': '削除しています…',
  'Incorrect password.': 'パスワードが正しくありません。',
  'Incorrect email or password.': 'メールアドレスまたはパスワードが正しくありません。',
  'This email is already in use.': 'このメールアドレスはすでに使用されています。',
  'Registration is closed by the administrator.': '新規登録は管理者によって停止されています。',
  'Your session expired. Sign in again.':
    'セッションの有効期限が切れました。もう一度ログインしてください。',
  'Check the form fields.': '入力内容を確認してください。',
  'Too many attempts. Try again later.':
    '試行回数が多すぎます。しばらくしてからもう一度お試しください。',
  'The request failed. Please try again.': 'リクエストに失敗しました。もう一度お試しください。',
  'Could not load your profile.': 'プロフィールを読み込めませんでした。',
  'The dictionary for this language pair is not installed. You can add a translation manually.':
    'この言語ペアの辞書はインストールされていません。翻訳は手動で追加できます。',
  'Save preferences': '環境設定を保存',
  'Save profile': 'プロフィールを保存',
  'You do not have permission for this action.': 'この操作を行う権限がありません。',
  'Your preferences were saved, but the interface language could not be loaded. Reload the page to try again.':
    '環境設定は保存しましたが、表示言語を読み込めませんでした。ページを再読み込みしてもう一度お試しください。',
  'Could not load this language. Check your connection and try again.':
    'この言語を読み込めませんでした。接続を確認して、もう一度お試しください。',
}
