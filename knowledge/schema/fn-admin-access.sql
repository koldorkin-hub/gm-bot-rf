-- Админ-команды доступа одной функцией: grant/revoke/access/list. Возвращает человекочитаемый ответ.
-- Владелец n8n_user. Идемпотентна (CREATE OR REPLACE).
CREATE OR REPLACE FUNCTION fn_admin_access(p_action text, p_bot text, p_uid bigint, p_until date)
RETURNS text AS $$
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
    SELECT COALESCE(string_agg(user_id::text||COALESCE(' — до '||access_until, ' — бессрочно'), E'\n' ORDER BY user_id), '(никого)')
      INTO r FROM user_access WHERE (p_bot IS NULL OR bot_id=p_bot) AND (access_until IS NULL OR access_until>=current_date);
    RETURN '👥 Активные'||COALESCE(' на «'||p_bot||'»','')||':'||E'\n'||r;
  ELSE
    RETURN 'Неизвестная команда. Доступно: /grant /revoke /access /list';
  END IF;
END; $$ LANGUAGE plpgsql;
ALTER FUNCTION fn_admin_access(text,text,bigint,date) OWNER TO n8n_user;
