-- /list: добавлен ИТОГО (число активных доступов) в шапку списка. Идемпотентно (полная замена функции).
CREATE OR REPLACE FUNCTION public.fn_admin_access(p_action text, p_bot text, p_uid bigint, p_until date)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE r text; cnt int; okbot int;
BEGIN
  IF p_action IN ('grant','revoke','access') AND (p_bot IS NULL OR p_uid IS NULL) THEN
    RETURN 'Формат: /'||p_action||' <bot_id> <telegram_id>'||CASE WHEN p_action='grant' THEN ' <free|30d|ГГГГ-ММ-ДД>' ELSE '' END;
  END IF;
  IF p_bot IS NOT NULL THEN
    SELECT count(*) INTO okbot FROM clients WHERE bot_id=p_bot;
    IF okbot=0 THEN RETURN 'Бот «'||p_bot||'» не найден. Доступные: '||(SELECT string_agg(bot_id,', ') FROM clients); END IF;
  END IF;

  IF p_action='grant' THEN
    INSERT INTO user_access (bot_id,user_id,access_until,note,updated_at)
    VALUES (p_bot,p_uid,p_until, CASE WHEN p_until IS NULL THEN 'free/бессрочно' ELSE 'до '||p_until END, now())
    ON CONFLICT (bot_id,user_id) DO UPDATE SET access_until=EXCLUDED.access_until, note=EXCLUDED.note, updated_at=now();
    RETURN '✅ Доступ выдан: id '||p_uid||' на «'||p_bot||'» '||COALESCE('до '||p_until, 'бессрочно')||'.';
  ELSIF p_action='revoke' THEN
    DELETE FROM user_access WHERE bot_id=p_bot AND user_id=p_uid;
    GET DIAGNOSTICS cnt = ROW_COUNT;
    RETURN CASE WHEN cnt>0 THEN '🚫 Доступ отозван: id '||p_uid||' на «'||p_bot||'».' ELSE 'Такого доступа нет — нечего отзывать.' END;
  ELSIF p_action='access' THEN
    SELECT CASE WHEN access_until IS NULL THEN 'бессрочно' ELSE 'до '||access_until||CASE WHEN access_until<current_date THEN ' (ПРОСРОЧЕН)' ELSE '' END END
      INTO r FROM user_access WHERE bot_id=p_bot AND user_id=p_uid;
    RETURN 'id '||p_uid||' на «'||p_bot||'»: '||COALESCE(r, 'доступа НЕТ');
  ELSIF p_action='list' THEN
    SELECT count(*), COALESCE(string_agg(user_id::text||COALESCE(' — до '||access_until, ' — бессрочно'), E'\n' ORDER BY user_id), '(никого)')
      INTO cnt, r FROM user_access WHERE (p_bot IS NULL OR bot_id=p_bot) AND (access_until IS NULL OR access_until>=current_date);
    RETURN '👥 Активные'||COALESCE(' на «'||p_bot||'»','')||' — ИТОГО: '||cnt||E'\n'||r;
  ELSE
    RETURN 'Неизвестная команда. Доступно: /grant /revoke /access /list';
  END IF;
END; $function$;

-- Ставка расчёта затрат $/сообщение для недельного отчёта (правится UPDATE-ом без редеплоя)
INSERT INTO app_config (key, value) VALUES ('cost_per_msg_usd', '0.14') ON CONFLICT (key) DO NOTHING;
