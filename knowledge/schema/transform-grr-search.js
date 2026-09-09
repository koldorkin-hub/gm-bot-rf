#!/usr/bin/env node
/*
 * GetResearchRep01 (get_research_report): поиск по ОСНОВАМ СЛОВ вместо сырой подстроки
 * («препаратам для похудения» находит «Доказательные препараты для снижения веса…»),
 * стоп-слова, скоринг; при промахе — агенту отдаётся СПИСОК сохранённых тем клиента
 * (новый PG-узел «Список тем» на ветке Найден?[нет]).
 * Идемпотентно (маркер: scored в запросе «Найти»). Запуск: node transform-grr-search.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/deploy/grr-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const find = byName['Найти']; if (!find) throw new Error('нет узла Найти');
if (find.parameters.query.includes('scored')) { console.log('уже применено — пропуск'); process.exit(0); }
const answerNo = byName['Ответ: нет']; if (!answerNo) throw new Error('нет узла Ответ: нет');
const cond = byName['Найден?']; if (!cond) throw new Error('нет узла Найден?');

find.parameters.query = `WITH words AS (
  SELECT CASE WHEN length(w) >= 6 THEN left(w, length(w)-2) WHEN length(w) >= 5 THEN left(w, length(w)-1) ELSE w END AS w
  FROM (SELECT DISTINCT lower(trim(w)) AS w FROM regexp_split_to_table($3, '\\s+') w) t
  WHERE length(w) >= 3 AND w NOT IN ('для','как','что','или','при','его','это','эта','этот','разбор','разбора','разборы','отчёт','отчет','скинь','пришли','дай','поводу','тема','теме')
),
scored AS (
  SELECT r.topic, r.summary, r.report_text, r.report_json, c.bot_token, r.created_at,
         COALESCE((SELECT count(*) FROM words WHERE (r.topic || ' ' || COALESCE(r.summary,'')) ILIKE '%'||words.w||'%'), 0) AS score
  FROM research_report r JOIN clients c ON c.bot_id=r.bot_id
  WHERE r.bot_id=$1 AND r.user_id=$2
)
SELECT topic, summary, report_text, report_json, bot_token, to_char(created_at,'YYYY-MM-DD') AS on_date
FROM scored
WHERE ($3 = '' OR NOT EXISTS (SELECT 1 FROM words) OR score > 0)
ORDER BY score DESC, created_at DESC
LIMIT 1;`;

const listNode = {
  parameters: {
    operation: 'executeQuery',
    query: "SELECT COALESCE(string_agg(to_char(created_at,'YYYY-MM-DD')||' — '||topic, E'\\n' ORDER BY created_at DESC), '') AS topics FROM (SELECT topic, created_at FROM research_report WHERE bot_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 10) t;",
    options: { queryReplacement: "={{ [$('When Executed by Another Workflow').first().json.bot_id, $('When Executed by Another Workflow').first().json.user_id] }}" }
  },
  id: 'g2000000-0000-4000-8000-000000000001',
  name: 'Список тем',
  type: 'n8n-nodes-base.postgres',
  typeVersion: 2.6,
  position: [answerNo.position[0] - 220, answerNo.position[1] + 120],
  alwaysOutputData: true,
  credentials: { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } }
};
wf.nodes.push(listNode);

answerNo.parameters.jsCode = `const t = String(($input.first().json || {}).topics || '').trim();
if (!t) return [{ json: { response: 'Сохранённых разборов у клиента пока нет. Новый разбор — через /research (тратит суточный лимит и токены).' } }];
return [{ json: { response: 'Точного совпадения по запросу не нашёл. В библиотеке клиента сохранены разборы:\\n' + t + '\\nВызови get_research_report ещё раз с 1–2 ключевыми словами нужной темы (или с пустым query — отдам самый свежий), либо уточни у клиента, какой из списка нужен.' } }];`;

// Переводка: Найден?[нет] → Список тем → Ответ: нет
const outs = wf.connections['Найден?'].main;
if (!outs || outs.length < 2) throw new Error('у Найден? нет второго выхода');
outs[1] = [{ node: 'Список тем', type: 'main', index: 0 }];
wf.connections['Список тем'] = { main: [[{ node: 'Ответ: нет', type: 'main', index: 0 }]] };

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: GetResearchRep01 — поиск по основам слов + список тем при промахе');
