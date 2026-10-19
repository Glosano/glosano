import { type Catalog, ctx } from '@/lib/i18n'

export const reviewMessages: Catalog = {
  'Could not recall': '思い出せなかった',
  'Recognized after reveal': '答えを見て思い出した',
  'Almost recalled': 'ほぼ思い出せた',
  'Recalled with difficulty': 'やっと思い出せた',
  Recalled: '思い出せた',
  'Recalled immediately': 'すぐに思い出せた',
  'Rate how easily you recalled the word.': '単語をどれくらい簡単に思い出せたか評価してください。',
  'Your choice has been checked. Now rate how easily you recalled the word.':
    '選択を確認しました。次に、単語をどれくらい簡単に思い出せたか評価してください。',
  'Finish session': 'セッションを終了',
  'Choose an activity': 'アクティビティを選択',
  [ctx('title', 'Choose an activity')]: 'アクティビティの選択',
  'Back to material results': '教材の結果に戻る',
  'Example from the material': '教材からの例文',
  'AI-generated example': 'AI生成の例文',
  'AI translation of the example': '例文のAI翻訳',
  'AI feedback': 'AIフィードバック',
  'Translating the example…': '例文を翻訳しています…',
  'The example translation is unavailable. You can continue reviewing.':
    '例文の翻訳は利用できません。復習は続けられます。',
  'No saved translation': '保存された翻訳はありません',
  'This item is no longer available. Skip this exercise.':
    'この項目は利用できなくなりました。この問題はスキップしてください。',
  'Mistakes from the previous session: {{count}} of {{total}} available.':
    '前回のセッションの間違い：{{total}}件中{{count}}件が利用可能です。',
  'Answers saved': '保存した回答',
  Skipped: 'スキップ',
  Unanswered: '未回答',
  Mistakes: '間違い',
  'Moved to known': '既知に移動',
  'The last attempt is unconfirmed and is not included in these results.':
    '最後の回答は確認できていないため、この結果には含まれていません。',
  'The remaining mistakes are available in the next session.':
    '残りの間違いは、次のセッションで利用できます。',
  'Practise difficult words': '苦手な単語を練習',
  'These mistakes are no longer available for review.':
    'これらの間違いは、復習に利用できなくなりました。',
  'Fill in the word': '単語を入力',
  'Extra practice — your review schedule stays the same.':
    '追加練習です。復習のスケジュールは変わりません。',
  'No words are available for this practice.': 'この練習に使える単語がありません。',
  Attempts: '回答数',
  Matches: '一致数',
  'With a hint': 'ヒントあり',
  'Difficult words: {{count}} of {{total}} available.':
    '苦手な単語：{{total}}語中{{count}}語が利用可能です。',
  'Enter the whole phrase': 'フレーズ全体を入力してください',
  'Enter the missing word': '抜けている単語を入力してください',
  Hint: 'ヒント',
  'Correct!': '正解です！',
  'This exercise practises a different word.': 'この問題では、別の単語を練習します。',
  'Your answer: {{answer}}': 'あなたの回答：{{answer}}',
  'Studied form: {{answer}}': '学習している形：{{answer}}',
  'Getting started': 'はじめに',
  'Scheduled review': 'スケジュールされた復習',
  'Review this material’s vocabulary': 'この教材の単語を復習',
  'Extra practice': '追加練習',
  'Recall the meaning and reveal the answer': '意味を思い出してから、答えを表示します',
  'Type the missing word or phrase': '抜けている単語またはフレーズを入力します',
  'Available: {{total}} · This session: {{count}}':
    '利用可能：{{total}} · このセッション：{{count}}',
  'Saved today: {{done}} of {{limit}} reviews.': '今日保存した復習：{{limit}}回中{{done}}回。',
  'Session size is limited by your remaining daily allowance.':
    'セッションの規模は、1日の残りの上限によって制限されます。',
  'The remaining vocabulary is available in later sessions.':
    '残りの単語は、後のセッションで利用できます。',
  'Open flashcards': 'フラッシュカードを開く',
  'Attempts: {{count}} · Skipped: {{skipped}} · Remaining: {{remaining}}':
    '回答：{{count}} · スキップ：{{skipped}} · 残り：{{remaining}}',
  Mistake: '間違い',
}
