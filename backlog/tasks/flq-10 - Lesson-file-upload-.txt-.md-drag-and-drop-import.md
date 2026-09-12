---
id: FLQ-10
title: 'Lesson file upload: .txt/.md drag-and-drop import'
status: Done
assignee:
  - Марк
created_date: '2026-05-03 18:35'
updated_date: '2026-09-11 11:40'
labels:
  - frontend
  - backend
dependencies:
  - FLQ-1
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Расширить ImportLessonDialog (FilterRow → Импортировать) добавлением второй вкладки «Файл».

**Что нужно:**
- Dialog tab «Файл» с drag-and-drop area + file picker.
- Accept `.txt`, `.md` (decision log §3 — только эти форматы в MVP).
- POST `/api/lessons/import-file` (multipart) — backend читает file, создаёт Lesson с raw_text = decoded UTF-8.
- Title определяется из filename (без extension); пользователь может поменять.
- Workflow: upload → 202 → poll status (как в FLQ-1).

**Зависимости:** FLQ-1 (processing pipeline).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Dialog tab Файл открывается и принимает .txt/.md drop
- [x] #2 POST /api/lessons/import-file валидирует mime/extension
- [x] #3 Title по умолчанию из filename, редактируется до save
- [x] #4 Lesson переходит в processing → ready через worker job
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Согласовано пользователем 2026-09-11.
1. Добавить тесты multipart импорта: txt/md, filename/title, MIME/extension, UTF-8/BOM, пустой файл, лимит 5 МиБ, auth/CSRF, очередь и processing→ready через worker на реальном Postgres/Redis.
2. Добавить POST /api/lessons/import-file, использовать существующий create_lesson_for_import и общий commit/enqueue с обработкой отказа очереди. Импорт приватный, язык текущий; расширение без учёта регистра, текст UTF-8, Markdown сохраняется как текст.
3. Добавить FormData в API client и тип ответа 202; расширить ImportLessonDialog вкладкой Файл с drop/picker, названием из filename и ручным редактированием, локальной валидацией и RU/EN сообщениями.
4. Отображать processing и опрашивать GET lesson до ready/failed, показывать ошибки, обновлять библиотеку.
5. Проверить компонентные и интеграционные тесты, ruff/pyright и frontend lint/build; провести ревью diff, записать результаты в задачу. Работать в текущем checkout с сохранением существующих пользовательских изменений.

Уточнения по ревью в рамках согласованного импорта: сохранять source_type=file и original_filename в существующем LessonSource; ограничить multipart body до разбора (5 МиБ файла + 64 КиБ метаданных), отклонять неавторизованный upload до чтения body. Дополнить тестами source provenance и chunked upload.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Исследован существующий импорт: FLQ-1 Done; POST /api/lessons создаёт processing lesson и ставит job в очередь; GET /api/lessons/{id} возвращает статус. ImportLessonDialog поддерживает только текст и закрывается после 202. Подготовлено предложение расширения: вкладка Файл, multipart endpoint с валидацией, повторное использование pipeline, polling результата, API/component tests. Реализация ещё не начата; ожидается согласование решения по workflow.

Основная реализация прошла API/worker-тесты, frontend suite и build. Визуальная проверка desktop и 390px выполнена. На ревью выявлены потеря source provenance и слишком поздняя проверка лимита multipart; исправляются с регрессионными тестами. Полный frontend прогон требует NODE_OPTIONS=--no-experimental-webstorage для совместимости Node 24 и jsdom.

Завершено 2026-09-11. Все замечания независимого ревью исправлены и повторно проверены; открытых замечаний нет. Итоговые проверки: 74 backend tests passed (Postgres/Redis testcontainers), 336 frontend tests passed (48 файлов, NODE_OPTIONS=--no-experimental-webstorage), tsc + vite build passed, ESLint изменённых файлов и ruff check/format passed, pyright 0 errors. Два существующих pyright warning в list_lessons, warning testcontainers и предупреждение Vite о размере bundle не относятся к новой логике. Временные файлы визуальной проверки удалены. Изменения оставлены в рабочем дереве, коммиты не создавались.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Добавлен импорт приватных уроков из .txt/.md через вкладку Файл в существующем ImportLessonDialog. Поддержаны drag-and-drop и file picker, название из имени файла с редактированием, RU/EN сообщения и состояния обработки до ready/failed. Сохранён импорт вставленного текста, исправлен тип ответа 202 и добавлена поддержка FormData в клиенте с сохранением CSRF.

POST /api/lessons/import-file проверяет расширение, MIME, UTF-8 (с BOM и без), непустой текст, размер до 5 МиБ и метаданные; использует общий create/commit/enqueue и существующий worker. Источник получает source_type=file и очищенное original_filename; manual-import сохраняет прежние значения. Middleware отклоняет анонимные uploads до чтения body и ограничивает поток multipart до 5 МиБ + 64 КиБ до парсинга, в том числе без Content-Length. Миграции и новые зависимости не потребовались.

Проверено: 74 backend tests passed на реальном Postgres/Redis; 336 frontend tests passed; tsc + Vite build; ESLint изменённых файлов; ruff check/format; pyright без ошибок (2 прежних warning в list_lessons). Визуальная проверка desktop и 390px выполнена. Независимое ревью и повторная проверка исправлений завершены без открытых замечаний. Изменения не закоммичены.
<!-- SECTION:FINAL_SUMMARY:END -->
