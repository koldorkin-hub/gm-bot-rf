#!/usr/bin/env bash
# ============================================================================
# РФ-сервер, шаг 2: перенос схемы данных действующего бота в базу gm_memory.
#
#   ./02-apply-core.sh [--db gm_memory] [--owner gm_app] [--dry-run]
#
# Схема данных у РФ-версии та же, что у действующего бота: меняется модель и площадка,
# а профили, журналы, коллекции здоровья и справочники — те же. Поэтому здесь НЕ пишется
# новая схема, а применяются УЖЕ ПРОВЕРЕННЫЕ на боевом скрипты из knowledge/schema
# в порядке зависимостей, с одной заменой: владелец таблиц n8n_user → роль РФ-сервера.
#
# Пропускаются намеренно:
#   memory-wave1-rollback.sql   — откат, применяется только руками при отказе;
#   test-diag-antispam.sql      — тест, а не схема;
#   owner-migration.sql         — перенос личных данных владельца со старого сервера;
#   owner-plan-start.sql        — разовый UPDATE под конкретного человека.
#
# Проверка — фактами: список таблиц, наличие функций, число строк в справочниках.
# ============================================================================
set -Eeuo pipefail

DB=gm_memory
OWNER=gm_app
DRY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --db) DB="$2"; shift 2 ;;
    --owner) OWNER="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "неизвестный ключ: $1" >&2; exit 2 ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/../knowledge/schema"
[[ -d "$SRC" ]] || { echo "нет каталога с эталонными скриптами: $SRC" >&2; exit 1; }

# Порядок зависимостей: сначала фундамент, потом миграции колонок, потом функции и справочники.
FILES=(
  memory-wave1.sql            # 6 хранилищ, справочники activity_library и freshness_policy
  memory-substep4a.sql        # флаг покрытия безопасности в онбординге
  memory-plan-started.sql     # дата старта программы
  research-report-json.sql    # структура разбора под пересборку PDF
  memory-substep6.sql         # fn_apply_extraction — роутер извлечённых фактов
  activity-kcal.sql           # расход калорий на активностях
  allergen-layer2.sql         # категории аллергенов и карта составных продуктов
  food-reference.sql          # справочник БЖУ
  food-reference-expand.sql   # расширение справочника
  food-liver.sql              # точечное дополнение справочника
  reminder.sql                # напоминания
  program-reminder-migration.sql  # программа тренировок с версиями + reminder.done_when (11.09.2026)
  program-cardio-migration.sql    # кардио отдельным списком; DROP FUNCTION старой сигнатуры (вечер 11.09)
  user-access.sql             # доступ по пользователям
  fn-admin-access.sql         # админ-команды доступа
  fn-admin-list-count.sql     # полная замена функции доступа (после предыдущей)
  websearch-budget.sql        # бюджет веб-поиска
  photo-batch.sql             # пачки фотографий
  diag-tables.sql             # самодиагностика
  dm-state.sql                # состояние /dm в саппорт-боте
  dialog-summary.sql          # скользящая сводка диалога
)

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "База: $DB | владелец таблиц: $OWNER | файлов: ${#FILES[@]}"
for f in "${FILES[@]}"; do
  [[ -f "$SRC/$f" ]] || { echo "нет файла $SRC/$f" >&2; exit 1; }
  # Единственная правка: владелец таблиц. Всё остальное применяется дословно.
  sed "s/OWNER TO n8n_user/OWNER TO $OWNER/g" "$SRC/$f" > "$TMP/$f"
  if [[ "$DRY" == 1 ]]; then
    echo "  [сухой прогон] $f ($(wc -l < "$TMP/$f") строк)"
    continue
  fi
  echo "  применяю $f"
  su - postgres -c "psql -v ON_ERROR_STOP=1 -q -d $DB -f $TMP/$f" >/dev/null
done

[[ "$DRY" == 1 ]] && { echo "сухой прогон завершён, база не тронута"; exit 0; }

# ── Проверка фактом ──
echo "проверяю результат запросами к базе"
su - postgres -c "psql -v ON_ERROR_STOP=1 -q -d $DB" <<'SQL'
DO $$
DECLARE
  want text[] := ARRAY['client_profile','measurement','workout_session','workout_entry','food_log',
                       'allergen','food_preference','medication','condition','injury','exclusion',
                       'recipe','recipe_ingredient','research_report','plan','client_summary',
                       'extraction_state','chat_history_archive','activity_library','freshness_policy',
                       'activity_met','allergen_group','food_allergen','food_reference','reminder',
                       'user_access','websearch_budget','photo_batch','photo_batch_item',
                       'diag_state','ops_error','ops_alert','dm_state','dialog_summary',
                       'training_program'];
  missing text;
  wrong_owner text;
  n_groups int;
  n_foods int;
BEGIN
  SELECT string_agg(t, ', ') INTO missing
    FROM unnest(want) t
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables
                      WHERE table_schema = 'public' AND table_name = t);
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'не созданы таблицы: %', missing; END IF;

  SELECT string_agg(tablename || ' → ' || tableowner, ', ') INTO wrong_owner
    FROM pg_tables WHERE schemaname = 'public' AND tableowner NOT IN ('gm_app','gm_dev')
      AND tablename = ANY(want);
  IF wrong_owner IS NOT NULL THEN RAISE EXCEPTION 'у таблиц чужой владелец: %', wrong_owner; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_apply_extraction') THEN
    RAISE EXCEPTION 'нет функции fn_apply_extraction — извлечение памяти не заработает';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_admin_access') THEN
    RAISE EXCEPTION 'нет функции fn_admin_access — админ-команды доступа не заработают';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_training_program') THEN
    RAISE EXCEPTION 'нет функции set_training_program — смена версии программы не заработает';
  END IF;
  -- Действующая версия программы ровно одна: это держит частичный уникальный индекс, а не промпт.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public' AND indexname = 'training_program_one_active') THEN
    RAISE EXCEPTION 'нет индекса training_program_one_active — двух действующих программ ничто не остановит';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'reminder' AND column_name = 'done_when') THEN
    RAISE EXCEPTION 'нет колонки reminder.done_when — автопропуск сделанного не заработает';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'training_program' AND column_name = 'cardio') THEN
    RAISE EXCEPTION 'нет колонки training_program.cardio — кардио снова окажется внутри силовых дней';
  END IF;
  -- У функции сменилась сигнатура: 7-й аргумент p_cardio. Старая версия рядом жить не должна.
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'set_training_program') <> 1 THEN
    RAISE EXCEPTION 'функций set_training_program % — старая сигнатура не удалена',
      (SELECT count(*) FROM pg_proc WHERE proname = 'set_training_program');
  END IF;
  IF (SELECT pronargs FROM pg_proc WHERE proname = 'set_training_program') <> 7 THEN
    RAISE EXCEPTION 'set_training_program принимает % аргументов вместо 7 — кардио не сохранится',
      (SELECT pronargs FROM pg_proc WHERE proname = 'set_training_program');
  END IF;

  SELECT count(*) INTO n_groups FROM allergen_group;
  SELECT count(*) INTO n_foods  FROM food_reference;
  IF n_groups < 11 THEN RAISE EXCEPTION 'категорий аллергенов %, ожидалось не меньше 11', n_groups; END IF;
  IF n_foods < 150 THEN RAISE EXCEPTION 'продуктов в справочнике %, ожидалось не меньше 150', n_foods; END IF;

  RAISE NOTICE 'Схема перенесена: таблиц % , категорий аллергенов %, продуктов в справочнике %.',
    array_length(want, 1), n_groups, n_foods;
END $$;
SQL
echo "готово"
