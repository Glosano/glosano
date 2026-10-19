# UI translation glossary

Reference for translating the Glosano UI catalogs (`frontend/src/lib/locales/<lang>/<area>.ts`).
One product term gets one translation per language, everywhere. The EN and RU columns are the
wording the UI uses today (copied from the catalogs); the other seven columns are the agreed
wording for the new catalogs.

Translate from the English key, use the Russian entry as a second source for meaning and tone,
and use this file for terminology.

## Terms

| Concept | en | ru | pt (PT-PT) | es (ES) | fr | de | zh-Hans | ja | hi |
|---|---|---|---|---|---|---|---|---|---|
| Status `new` | New | Новые / Новых (completion) | Novas | Nuevas | Nouveaux | Neu | 新词 | 新規 | नए |
| Status `tracked` (being studied) | Studying (also "Tracked" in the vocabulary filter) | В изучении / На изучении (completion) / Отслеживаемые (filter) | Em estudo | En estudio | En apprentissage | Wird gelernt | 学习中 | 学習中 | सीखे जा रहे |
| Status `known` | Known | Известные слова / Известно / Изученные / Изучено | Conhecidas | Conocidas | Connus | Bekannt | 已知 | 既知 | ज्ञात |
| Status `ignored` | Ignored | Игнорируется / Игнорируемые | Ignoradas | Ignoradas | Ignorés | Ignoriert | 已忽略 | 無視 | अनदेखे |
| Material (an imported text or video) | Material | Материал | Material | Material | Contenu | Material | 学习材料 | 教材 | सामग्री |
| Lesson | Lesson | Урок | Lição | Lección | Leçon | Lektion | 课程 | レッスン | पाठ |
| Library | Library | Библиотека | Biblioteca | Biblioteca | Bibliothèque | Bibliothek | 资料库 | ライブラリ | लाइब्रेरी |
| Vocabulary (the user's saved words and phrases) | Vocabulary | Словарь | Vocabulário | Vocabulario | Vocabulaire | Vokabeln | 词汇表 | 単語帳 | शब्दावली |
| Review (SRS repetition) | Review | Повторение | Revisão | Repaso | Révision | Wiederholung | 复习 | 復習 | दोहराव |
| Phrase | Phrase | Фраза | Frase | Frase | Expression | Phrase | 短语 | フレーズ | वाक्यांश |
| Page (of a text) | Page | Страница | Página | Página | Page | Seite | 页 | ページ | पृष्ठ |
| AI translation | AI translation | AI-перевод | Tradução AI | Traducción AI | Traduction AI | AI-Übersetzung | AI 翻译 | AI翻訳 | AI अनुवाद |
| Word card (the popup shown when a word is clicked) | card | карточка (слова) | Cartão da palavra | Ficha de la palabra | Fiche du mot | Wortkarte | 单词卡 | 単語カード | शब्द कार्ड |
| Flashcards (review activity) | Flashcards | Карточки | Cartões | Tarjetas | Cartes mémoire | Karteikarten | 闪卡 | フラッシュカード | फ़्लैशकार्ड |
| Native language | Native language | Родной язык | Língua materna | Lengua materna | Langue maternelle | Muttersprache | 母语 | 母語 | मातृभाषा |
| Learning language | Learning languages | Изучаемые языки | Línguas de estudo | Idiomas de estudio | Langues étudiées | Lernsprachen | 学习语言 | 学習言語 | सीखी जा रही भाषाएँ |
| Interface language | Interface language | Язык интерфейса | Língua da interface | Idioma de la interfaz | Langue de l'interface | Sprache der Benutzeroberfläche | 界面语言 | 表示言語 | इंटरफ़ेस की भाषा |
| Material language | Material language | Язык материала | Língua do material | Idioma del material | Langue du contenu | Sprache des Materials | 学习材料的语言 | 教材の言語 | सामग्री की भाषा |
| Confidence (level 0..5 of a tracked item) | Confidence level | Уровень уверенности | Nível de confiança | Nivel de confianza | Niveau de confiance | Sicherheitsstufe | 熟悉度 | 習熟度 | विश्वास स्तर |
| Tag | Tag | Тег | Etiqueta | Etiqueta | Étiquette | Tag | 标签 | タグ | टैग |
| Translation (a saved meaning of a word) | Translation | Перевод | Tradução | Traducción | Traduction | Übersetzung | 翻译 | 翻訳 | अनुवाद |
| Settings | Settings | Настройки | Definições | Ajustes | Paramètres | Einstellungen | 设置 | 設定 | सेटिंग्स |
| Log in | Log in | Вход / Войти | Iniciar sessão | Iniciar sesión | Se connecter | Anmelden | 登录 | ログイン | लॉग इन |
| Sign up | Sign up | Регистрация / Зарегистрироваться | Registar-se | Registrarse | S'inscrire | Registrieren | 注册 | 新規登録 | साइन अप |
| Sign out | Sign out | Выйти | Terminar sessão | Cerrar sesión | Se déconnecter | Abmelden | 退出登录 | ログアウト | साइन आउट |
| Delete | Delete | Удалить | Eliminar | Eliminar | Supprimer | Löschen | 删除 | 削除 | हटाएँ |

Notes on the table:

- Status wording follows ADR-0005. `tracked` is a status of a word the user is actively studying;
  `ignored` is for proper nouns and junk tokens and is never counted as `known`. Do not merge
  `known` and `ignored` into one word, and do not translate `ignored` in a way that sounds like
  "known".
- The English UI calls `tracked` items "Studying" (Russian: «В изучении» in statistics, «На изучении»
  on the completion screen, «Отслеживаемые» only as a vocabulary tab/filter label). In every other
  language use the single "studying" term from the table for all three places; only inflect it
  where grammar requires (for example agreement with a counted noun on the completion screen).
- The status columns give the plural/adjective form used for tab, filter and count labels
  ("New", "Known", "Ignored" as groups of words). Where a key is a state of one word
  (context `status`), use the singular form of the same term.
- "Material" and "Lesson" both name the same imported item; the UI uses "Lesson" in the reader,
  import and review, and "Material" in the library and edit/delete dialogs. Keep the two terms
  distinct as the table does.
- "Flashcards" (a review activity) and "word card" (the popup on a word) are different things;
  never use the same word for both.
- "AI" stays "AI" in every language (see below), so the compound is "AI translation", not a
  localized abbreviation.

## Do not translate

Keep these exactly as written, in every language:

- Glosano, YouTube, Wiktionary, Kaikki
- `.txt`, `.md`, Markdown
- AI, email (the word "email" stays as is, including the plain "Email" field label, except
  where the Russian entry deliberately spells it out for the `auth` context; there, use the
  language's usual phrase for "email address")
- Placeholders in `{{…}}`: `{{count}}`, `{{language}}`, `{{title}}`, `{{value0}}`, `{{words}}` and
  so on. Do not translate, rename, add or drop a placeholder; you may move it to where the target
  grammar needs it.
- Symbols and markers inside strings: ✓, ✅, ❌, ▾, ⟳, ⊟, `…`, `/4`, numbers, `%`.
- Language names are provided through `{{language}}`; do not spell them out.

## Contexts

Some keys exist twice because one English word needs different wording in different places. The
key is built with `ctx(context, key)`; translate every context entry as its own string, picking
the form that fits the place described here.

| Context | Where it is used | What to translate |
|---|---|---|
| `link` | Link text under the register form, "Log in" | A short action link ("Already have an account? Log in"). |
| `auth` | The "Email" field label on the login and register forms | A form field label. |
| `title` | Page headings: "Sign up" on the register page, "Choose an activity" on the review mode screen | A heading, not a button; a noun phrase is usually better than an imperative. |
| `review` | Review-session buttons and labels: "Try again", "Check answer", "Next", and the "Lesson vocabulary" subtitle | Short button labels inside a review exercise; "Next" means "next card/question", not "next page". |
| `completion` | Row labels on the material completion screen: "Known", "New", "Studying", "Ignored" | Count labels (a number of words next to each); use the plural/adjective form that agrees with "words". |
| `filter` | Vocabulary filter popover: "Known", "Ignored", "Added", "Due for review" | Option labels in a filter; "Added" is the date the item was added, "Due for review" means cards whose review date has come. |
| `status` | Accessible label (aria-label) for the known state of one word in the lesson vocabulary row | The state of a single word ("Known"), singular. |
| `video` | Video player controls and the page-turning menu: "Stop" and the menu labels | Player/menu control labels. |

Keys without a context ("Next", "Known", "Try again") are used elsewhere with their own
meaning, for example "Next" as pagination ("Next page") and "Known" as a statistics counter. The
Russian catalog shows the intended split.

## Register and language variant

- **pt**: European Portuguese (PT-PT), not Brazilian. Address the user with the formal
  imperative and "o seu / a sua" (Introduza, Escolha), avoid "você". Use PT-PT spelling and terms
  (Definições, Terminar sessão, Registar-se).
- **es**: Spanish of Spain, not Latin American. Address the user as "tú" (second person
  singular, informal), as is conventional for consumer apps in Spain; prefer impersonal or
  infinitive forms for labels. Never use "vosotros" or "usted".
- **fr**: Polite "vous" form throughout; never "tu".
- **de**: Polite "Sie" form throughout; never "du". Capitalize "Sie/Ihr".
- **ja**: Polite style です/ます in sentences. Short labels and buttons stay as nouns or plain
  verbs (保存, 削除, 次へ). Do not mix plain and polite style within one message.
- **zh-Hans**: Mainland Simplified Chinese (Mainland terms and punctuation: full-width `，。！？`
  inside Chinese text). Never Traditional characters. Keep `AI` as `AI` and put a space between
  it and Chinese text ("AI 翻译").
- **hi**: Devanagari script, polite "आप" register. Widely used English loanwords are fine and
  preferred for tech terms (AI, email, लॉग इन, साइन आउट, सेटिंग्स, टैग, लाइब्रेरी). Do not write Hindi in
  Latin script.

## Plural forms

Plural entries are objects keyed by CLDR plural categories (`zero`, `one`, `two`, `few`, `many`,
`other`) with the English key as the entry key and `{{count}}` inside every form. Each language
must provide exactly the categories that the platform reports for it, and `other` is always
required:

- Trust `new Intl.PluralRules(lang).resolvedOptions().pluralCategories`, not memory of grammar
  rules. For example `ja` and `zh-Hans` use only `other`; `de` and `hi` use `one` and `other`;
  `fr`, `es` and `pt` use `one`, `many` and `other`; `ru` uses `one`, `few`, `many` and `other`.
- Do not add categories the language does not report (they are never selected), and do not
  omit one it does report.
- `count` selects the form and is also interpolated, so keep `{{count}}` in every form.
- `many` in `fr`/`es`/`pt` is selected for large round numbers (1 000 000 and up), where these
  languages need "de" before the noun ("1 million de mots"); write the form with that particle
  where the language requires it, otherwise it equals `other`.

## Quick checklist for a translator

1. Same keys as `ru/<area>.ts`, same export names, same placeholders in each value.
2. Terms come from the table above; no synonyms for table terms.
3. Context entries (`ctx(...)`) are translated too, each with the form for its place.
4. Brand and format names unchanged; `{{…}}` untouched.
5. Register matches the language note.
