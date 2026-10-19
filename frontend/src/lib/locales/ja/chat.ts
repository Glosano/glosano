import type { Catalog } from '@/lib/i18n'

export const chatMessages: Catalog = {
  'Retry adding quotes': '引用の追加を再試行',
  'Remove old quotes': '古い引用を削除',
  'Old quotes could not be added to the message. Retry or remove the old quotes; your question text will be kept.':
    '古い引用をメッセージに追加できませんでした。再試行するか、古い引用を削除してください。質問のテキストは保持されます。',
  'Cancel adding quote': '引用の追加をキャンセル',
  'The quote does not fit in the message. Shorten the text and try again.':
    '引用がメッセージに収まりません。テキストを短くして、もう一度お試しください。',
  'Message…': 'メッセージ…',
  'Context limit: {{budget}} characters.': 'コンテキストの上限：{{budget}}文字。',
  'This paragraph is too large to quote. Choose a shorter paragraph.':
    'この段落は長すぎて引用できません。もっと短い段落を選んでください。',
  'Add paragraph to chat': '段落をチャットに追加',
  'Paragraph added to chat': '段落をチャットに追加しました',
  'Adding paragraph…': '段落を追加しています…',
  'Wait for the previous quotation to finish': '前の引用の追加が終わるまでお待ちください',
  'Could not attach the quotation. Try again.':
    '引用を添付できませんでした。もう一度お試しください。',
  'Chat transcript': 'チャット履歴',
  'Exercise {{id}}': '問題 {{id}}',
  'Response pending': '回答を作成中',
  'Generating…': '生成しています…',
  'Response cancelled': '回答を停止しました',
  'Response failed': '回答を取得できませんでした',
  Message: 'メッセージ',
  'Send message': 'メッセージを送信',
  Send: '送信',
  'Stop response': '回答を停止',
  Stop: '停止',
  Chat: 'チャット',
  'AI chat': 'AIチャット',
  Conversations: '会話',
  Chats: 'チャット',
  'Open sidebar': 'サイドバーを開く',
  'Close sidebar': 'サイドバーを閉じる',
  'Close conversation list': '会話の一覧を閉じる',
  'Conversation actions: {{title}}': '会話の操作：{{title}}',
  'New conversation': '新しい会話',
  Rename: '名前を変更',
  'Your conversation appears after the first message.':
    '最初のメッセージを送ると会話が表示されます。',
  'More conversations': 'さらに会話を表示',
  'Delete conversation?': '会話を削除しますか？',
  'Rename conversation': '会話の名前を変更',
  'This conversation’s history, exercises and attempts will be deleted.':
    'この会話の履歴、問題、回答の記録が削除されます。',
  'Conversation title': '会話のタイトル',
  'Retry loading': '読み込みを再試行',
  Citation: '引用',
  'Remove citation': '引用を削除',
  'Saved context snapshot': '保存済みのコンテキストのスナップショット',
  'Source version {{version}}': '引用元のバージョン {{version}}',
  'The source has changed. It will open without the old position.':
    '引用元が変更されました。以前の位置は使わずに開きます。',
  'The source is unavailable. The snapshot is preserved.':
    '引用元を利用できません。スナップショットは保存されています。',
  'The source is unavailable or changed. The snapshot is preserved.':
    '引用元を利用できないか、変更されています。スナップショットは保存されています。',
  'Open source': '引用元を開く',
  'Could not load citation': '引用を読み込めませんでした',
  'Discussing attempt': '回答についての相談',
  'Exercise context': '問題のコンテキスト',
  'The draft changed in another window. Your copy is saved locally.':
    '下書きが別のウィンドウで変更されました。お手元のコピーはローカルに保存されています。',
  'Server version': 'サーバー版',
  'Citations: {{count}}': '引用：{{count}}件',
  'Load server version': 'サーバー版を読み込む',
  'Save my version': '自分の版を保存',
  'Retry sending': '送信を再試行',
  'AI is disabled. History and drafts remain available; new replies are unavailable.':
    'AIは無効です。履歴と下書きは引き続き利用できますが、新しい返信は利用できません。',
  'Sending…': '送信しています…',
  'Not saved to server': 'サーバーに保存されていません',
  'Retry saving': '保存を再試行',
  'The source changed or is unavailable. Remove the citation and attach it again.':
    '引用元が変更されたか、利用できません。引用を削除して、もう一度添付してください。',
  'The context is too large. Shorten the message or remove citations.':
    'コンテキストが大きすぎます。メッセージを短くするか、引用を削除してください。',
  'Exercise · AI-generated': '問題 · AI生成',
  'Choose an answer': '答えを選択',
  Answer: '答え',
  'Check answer': '答え合わせ',
  'Retry answer submission': '回答の送信を再試行',
  'AI evaluation is unavailable. Your answer is saved as a draft.':
    'AIによる評価は利用できません。回答は下書きとして保存されています。',
  'Could not submit your answer. Retry; your attempt is preserved.':
    '回答を送信できませんでした。再試行してください。回答の記録は保持されています。',
  'Similar exercise': '類似の問題',
  'Discuss exercise': '問題について相談',
  'Previous attempts': '過去の回答',
  'Awaiting evaluation': '評価待ち',
  'Not graded — evaluation failed': '未採点 — 評価に失敗しました',
  Correct: '正解',
  Incorrect: '不正解',
  'Discuss this attempt': 'この回答について相談',
  'Retry loading attempts': '回答の読み込みを再試行',
  'More attempts': 'さらに回答を表示',
  'Close chat': 'チャットを閉じる',
  'Click the plus to the left of a paragraph to quote it, then ask a question.':
    '段落の左にある「+」をクリックして引用し、質問してください。',
  'Earlier messages': '以前のメッセージ',
  'AI-generated': 'AI生成',
  Copy: 'コピー',
  'Show more': 'もっと見る',
  Copied: 'コピーしました',
  'Some earlier history was omitted from the response context.':
    '以前の履歴の一部は、回答のコンテキストに含まれていません。',
  'Response interrupted': '回答が中断されました',
  'Retry response': '回答を再試行',
  Queued: '待機中',
  'Add to chat': 'チャットに追加',
  'In a new conversation': '新しい会話で',
  'Select text in the lesson to attach an exact citation.':
    'レッスン内のテキストを選択すると、正確な引用を添付できます。',
  'Dictionary / Chat': '辞書 / チャット',
  'The citation position is unavailable: the material has changed.':
    '引用の位置を利用できません。教材が変更されました。',
  'Could not load exercise': '問題を読み込めませんでした',
  'Your current draft will be sent with the similar exercise request.':
    '現在の下書きは、類似の問題のリクエストと一緒に送信されます。',
  'Exercise for the new request': '新しいリクエストの問題',
  'The previous exercise or attempt reference will be replaced.':
    '前の問題または回答への参照は置き換えられます。',
  'Send draft and create similar': '下書きを送信して類似の問題を作成',
  'Clear answer draft': '回答の下書きを消去',
  'You have 30 unfinished answers. Submit or clear an existing answer to start another.':
    '未完了の回答が30件あります。新しく始めるには、既存の回答を送信するか消去してください。',
}
