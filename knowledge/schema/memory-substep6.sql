-- Подэтап 6a: функция-роутер извлечённых фактов. Идемпотентна (CREATE OR REPLACE).
-- Принимает извлечённый моделью jsonb и разносит по типизированным хранилищам атомарно.
-- Медфакты — confirmed=false (бот подтвердит). Дедуп по существующим активным записям.
-- Применять: cat ... | su - postgres -c "psql -d n8n_memory -v ON_ERROR_STOP=1 -f -"

CREATE OR REPLACE FUNCTION fn_apply_extraction(p_bot_id text, p_user_id bigint, p_payload jsonb, p_max_id int)
RETURNS void AS $$
BEGIN
  -- Числа -> measurement (source=extracted). measured_on от модели или сегодня.
  INSERT INTO measurement (bot_id,user_id,measured_on,metric,value,unit,source)
  SELECT p_bot_id, p_user_id,
         COALESCE(NULLIF(m->>'measured_on','')::date, current_date),
         m->>'metric', (m->>'value')::numeric, NULLIF(m->>'unit',''), 'extracted'
  FROM jsonb_array_elements(COALESCE(p_payload->'measurements','[]'::jsonb)) m
  WHERE (m->>'metric') IS NOT NULL AND (m->>'value') ~ '^-?[0-9.]+$';

  -- Аллергены (confirmed=false, дедуп)
  INSERT INTO allergen (bot_id,user_id,substance,severity,confirmed)
  SELECT p_bot_id,p_user_id, a->>'substance',
         CASE WHEN a->>'severity'='intolerance' THEN 'intolerance' ELSE 'allergy' END, false
  FROM jsonb_array_elements(COALESCE(p_payload->'allergens','[]'::jsonb)) a
  WHERE (a->>'substance') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM allergen x WHERE x.bot_id=p_bot_id AND x.user_id=p_user_id AND lower(x.substance)=lower(a->>'substance'));

  -- Состояния
  INSERT INTO condition (bot_id,user_id,name,confirmed)
  SELECT p_bot_id,p_user_id, c->>'name', false
  FROM jsonb_array_elements(COALESCE(p_payload->'conditions','[]'::jsonb)) c
  WHERE (c->>'name') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM condition x WHERE x.bot_id=p_bot_id AND x.user_id=p_user_id AND lower(x.name)=lower(c->>'name') AND x.active);

  -- Травмы
  INSERT INTO injury (bot_id,user_id,area,status,confirmed)
  SELECT p_bot_id,p_user_id, i->>'area',
         CASE WHEN i->>'status' IN ('active','rehab','resolved') THEN i->>'status' ELSE 'active' END, false
  FROM jsonb_array_elements(COALESCE(p_payload->'injuries','[]'::jsonb)) i
  WHERE (i->>'area') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM injury x WHERE x.bot_id=p_bot_id AND x.user_id=p_user_id AND lower(x.area)=lower(i->>'area') AND x.status<>'resolved');

  -- Препараты
  INSERT INTO medication (bot_id,user_id,name,dose,confirmed)
  SELECT p_bot_id,p_user_id, me->>'name', NULLIF(me->>'dose',''), false
  FROM jsonb_array_elements(COALESCE(p_payload->'medications','[]'::jsonb)) me
  WHERE (me->>'name') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM medication x WHERE x.bot_id=p_bot_id AND x.user_id=p_user_id AND lower(x.name)=lower(me->>'name') AND x.active);

  -- Предпочтения (бытовые, без confirmed)
  INSERT INTO food_preference (bot_id,user_id,item,stance)
  SELECT p_bot_id,p_user_id, pr->>'item',
         CASE WHEN pr->>'stance'='dislike' THEN 'dislike' ELSE 'like' END
  FROM jsonb_array_elements(COALESCE(p_payload->'preferences','[]'::jsonb)) pr
  WHERE (pr->>'item') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM food_preference x WHERE x.bot_id=p_bot_id AND x.user_id=p_user_id AND lower(x.item)=lower(pr->>'item'));

  -- Выжимка (полная, перезаписывается)
  IF COALESCE(length(p_payload->>'summary'),0) > 0 THEN
    INSERT INTO client_summary (bot_id,user_id,summary_text,covers_through,updated_at)
    VALUES (p_bot_id,p_user_id, p_payload->>'summary', now(), now())
    ON CONFLICT (bot_id,user_id) DO UPDATE SET summary_text=EXCLUDED.summary_text, covers_through=now(), updated_at=now();
  END IF;

  -- Водяной знак
  INSERT INTO extraction_state (bot_id,user_id,last_message_id,last_extracted_at,updated_at)
  VALUES (p_bot_id,p_user_id,p_max_id,now(),now())
  ON CONFLICT (bot_id,user_id) DO UPDATE SET last_message_id=EXCLUDED.last_message_id, last_extracted_at=now(), updated_at=now();
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION fn_apply_extraction(text,bigint,jsonb,int) OWNER TO n8n_user;
