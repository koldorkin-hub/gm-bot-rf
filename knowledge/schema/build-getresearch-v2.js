// Билдер подворкфлоу get_research_report v2: пересборка PDF из report_json + отправка файлом.
// jsCode узлов задаём реальными функциями и берём тело через toString() — чтобы HTML-шаблон
// с бэктиками/${} не экранировать в JSON. Функции здесь НЕ вызываются (только сериализуются).
// Запуск в контейнере: node build-getresearch-v2.js <out.json>
const fs = require('fs');
const outp = process.argv[2] || '/tmp/getresearch-v2.json';
const body = fn => { const s = fn.toString(); return s.slice(s.indexOf('{') + 1, s.lastIndexOf('}')).trim(); };

// ── Code: HTML разбора (из report_json, тот же шаблон, что у свежего research) ──
function fnHtml() {
  const src = $('Найти').first().json;
  let d = src.report_json;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = {}; } }
  d = d || {};
  const rep = d.report || {};
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const dateStr = src.on_date || '';
  const disclaimer = d.is_pharma
    ? 'Это информационная справка по научным публикациям, а НЕ медицинская рекомендация. Здесь приведены данные исследований, включая дозировки, которые применялись в научных протоколах, — это описание экспериментов, а не назначение. Препараты, гормоны и добавки имеют противопоказания и побочные эффекты. Любые решения принимайте только вместе с лечащим врачом.'
    : 'Это информационная справка по научным публикациям, а НЕ медицинская рекомендация. Данные приведены как факты исследований. Решения о своём здоровье принимайте вместе с врачом.';
  const discBlock = d.is_owner ? '' : '<div class="disc"><b>ВАЖНО, ПРОЧТИТЕ ПЕРЕД ЧТЕНИЕМ ОТЧЁТА</b>' + esc(disclaimer) + '</div>';
  const footNote = d.is_owner
    ? 'Отчёт собран автоматически по публикациям PubMed.'
    : 'Отчёт собран автоматически по публикациям PubMed. Факты исследований, не персональные рекомендации.';
  const sourcesCount = d.sources_count || (d.sources || []).length;
  const sections = (rep.sections || []).map(s =>
    '<h2>' + esc(s.heading) + '</h2><p>' + esc(s.body).replace(/\n/g, '<br>') + '</p>'
  ).join('\n');
  const sources = (d.sources || []).map(s =>
    '<li><b>[' + s.n + ']</b> ' + esc(s.title) +
    '<br><span class="meta">' + esc(s.journal) + ', ' + esc(s.year) +
    (s.types && s.types.length ? ' · ' + esc(s.types.slice(0, 3).join(', ')) : '') +
    '</span><br><span class="meta">PMID ' + esc(s.pmid) + ' — ' + esc(s.url) + '</span></li>'
  ).join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Разбор</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: 'DejaVu Sans', sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1a1a1a; }
  h1 { font-size: 17pt; margin: 0 0 4px; }
  h2 { font-size: 12.5pt; margin: 18px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 3px; }
  .date { color: #666; font-size: 9.5pt; margin-bottom: 16px; }
  .disc { border: 2px solid #a00; background: #fff6f6; padding: 12px 14px; margin: 0 0 20px; }
  .disc b { color: #a00; display: block; margin-bottom: 5px; font-size: 11pt; }
  .sum { background: #f4f7fb; border-left: 4px solid #35638f; padding: 11px 14px; margin-bottom: 14px; }
  .warn { background: #fffdf0; border-left: 4px solid #c89000; padding: 10px 13px; margin: 14px 0; }
  .prac { background: #f2f9f2; border-left: 4px solid #3a7d44; padding: 11px 14px; margin: 12px 0; }
  ol { padding-left: 20px; } li { margin-bottom: 9px; }
  .meta { color: #666; font-size: 9pt; }
  .foot { margin-top: 22px; border-top: 1px solid #ddd; padding-top: 8px; color: #777; font-size: 8.5pt; }
</style></head><body>

<h1>${esc(d.topic_ru || d.topic)}</h1>
<div class="date">Доказательный разбор · ${esc(dateStr)} · источников: ${sourcesCount}</div>

${discBlock}

<h2>Краткое резюме</h2>
<div class="sum">${esc(rep.summary).replace(/\n/g, '<br>')}</div>

${sections}

<h2>Противоречия и неопределённость</h2>
<div class="warn">${esc(rep.contradictions || 'не указано').replace(/\n/g, '<br>')}</div>

<h2>Ограничения доказательной базы</h2>
<div class="warn">${esc(rep.limitations || 'не указано').replace(/\n/g, '<br>')}</div>

${rep.practical ? '<h2>Практические выводы</h2><div class="prac">' + esc(rep.practical).replace(/\n/g, '<br>') + '</div>' : ''}

<h2>Источники</h2>
<ol>${sources}</ol>

<div class="foot">${esc(footNote)}</div>
</body></html>`;
  return [{
    json: {
      bot_token: src.bot_token,
      chat_id: $('When Executed by Another Workflow').first().json.user_id,
      topic_ru: d.topic_ru || d.topic,
      on_date: dateStr,
      sources_count: sourcesCount
    },
    binary: { index: { data: Buffer.from(html, 'utf8').toString('base64'), mimeType: 'text/html', fileName: 'index.html' } }
  }];
}

// ── Code: имя PDF (тема + дата, обрезка ~38 по границе слова) ──
function fnName() {
  const j = $('HTML разбора').first().json;
  const bin = $input.first().binary.pdf;
  let base = String(j.topic_ru || 'Разбор').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  if (base.length > 38) { base = base.slice(0, 38); const sp = base.lastIndexOf(' '); if (sp > 20) base = base.slice(0, sp); }
  const fname = (base + ' ' + (j.on_date || '')).trim() + '.pdf';
  return [{ json: j, binary: { pdf: Object.assign({}, bin, { fileName: fname }) } }];
}

// ── Code: ответ агенту после отправки (проверяем ok Телеграма) ──
function fnRespSent() {
  const j = $('Имя PDF').first().json;
  let ok = false;
  try { const r = $input.first().json; ok = !!(r && (r.ok === true || r.result)); } catch (e) {}
  if (ok) return [{ json: { response: 'Отправил готовый разбор «' + (j.topic_ru || '') + '» файлом из памяти (' + (j.on_date || '') + '). Новый /research не нужен — суточный лимит и токены не потрачены. Клиенту скажи коротко, что прислал файл с полным разбором.' } }];
  return [{ json: { response: 'Нашёл сохранённый разбор «' + (j.topic_ru || '') + '», но отправить файл прямо сейчас не получилось. Извинись по-человечески и предложи повторить чуть позже; при необходимости клиент может запустить свежий /research.' } }];
}

// ── Code: fallback текстом (если у записи нет report_json — старый формат) ──
function fnRespText() {
  const r = $('Найти').first().json;
  return [{ json: { response: 'Нашёл сохранённый разбор «' + (r.topic || '') + '» (' + (r.on_date || '') + '). PDF по нему пересобрать нельзя (старый формат без структуры) — вот полный текст:\n\n' + (r.report_text || '') + '\n\nНовый /research запускать не нужно.' } }];
}

// ── Code: разборов нет ──
function fnRespNone() {
  return [{ json: { response: 'Сохранённых разборов по этой теме нет. Если нужен новый — клиент может запустить /research (это тратит суточный лимит и токены).' } }];
}

const PG = { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } };
function ifBool(id, name, expr, pos) {
  return {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ id: id + '-c', leftValue: expr, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      },
      options: {}
    },
    id, name, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: pos
  };
}
function code(id, name, fn, pos) {
  return { parameters: { jsCode: body(fn) }, id, name, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos };
}

const wf = {
  id: 'GetResearchRep01',
  name: 'Инструмент — Найти разбор',
  active: false,
  settings: { executionOrder: 'v1' },
  nodes: [
    {
      parameters: {
        inputSource: 'workflowInputs',
        workflowInputs: { values: [ { name: 'bot_id', type: 'string' }, { name: 'user_id', type: 'number' }, { name: 'query', type: 'string' } ] }
      },
      id: 'd3000000-0000-4000-8000-000000000001',
      name: 'When Executed by Another Workflow',
      type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.2, position: [-720, 0]
    },
    {
      parameters: {
        operation: 'executeQuery',
        query: "SELECT r.topic, r.summary, r.report_text, r.report_json, c.bot_token, to_char(r.created_at,'YYYY-MM-DD') AS on_date FROM research_report r JOIN clients c ON c.bot_id=r.bot_id WHERE r.bot_id=$1 AND r.user_id=$2 AND ($3='' OR r.topic ILIKE '%'||$3||'%') ORDER BY r.created_at DESC LIMIT 1;",
        options: { queryReplacement: "={{ [$json.bot_id, $json.user_id, String($json.query || '').trim()] }}" }
      },
      id: 'd3000000-0000-4000-8000-000000000002',
      name: 'Найти', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [-500, 0],
      alwaysOutputData: true, credentials: PG
    },
    ifBool('d3000000-0000-4000-8000-000000000003', 'Найден?', '={{ !!$json.topic }}', [-280, 0]),
    ifBool('d3000000-0000-4000-8000-000000000004', 'Есть структура?', '={{ $json.report_json != null }}', [-60, -80]),
    code('d3000000-0000-4000-8000-000000000005', 'HTML разбора', fnHtml, [160, -160]),
    {
      parameters: {
        method: 'POST', url: 'http://gotenberg:3000/forms/chromium/convert/html',
        sendBody: true, contentType: 'multipart-form-data',
        bodyParameters: { parameters: [ { parameterType: 'formBinaryData', name: 'files', inputDataFieldName: 'index' } ] },
        options: { timeout: 120000, response: { response: { responseFormat: 'file', outputPropertyName: 'pdf' } } }
      },
      id: 'd3000000-0000-4000-8000-000000000006',
      name: 'Gotenberg PDF', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [380, -160]
    },
    code('d3000000-0000-4000-8000-000000000007', 'Имя PDF', fnName, [600, -160]),
    {
      parameters: {
        method: 'POST', url: '=https://api.telegram.org/bot{{ $json.bot_token }}/sendDocument',
        sendBody: true, contentType: 'multipart-form-data',
        bodyParameters: { parameters: [
          { name: 'chat_id', value: '={{ $json.chat_id }}' },
          { name: 'caption', value: "={{ 'Разбор из памяти: ' + ($json.topic_ru || '') + ' · ' + $json.on_date + ' · источников: ' + $json.sources_count }}" },
          { parameterType: 'formBinaryData', name: 'document', inputDataFieldName: 'pdf' }
        ] },
        options: { timeout: 120000 }
      },
      id: 'd3000000-0000-4000-8000-000000000008',
      name: 'Отправить PDF', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [820, -160],
      onError: 'continueRegularOutput'
    },
    code('d3000000-0000-4000-8000-000000000009', 'Ответ: отправлен', fnRespSent, [1040, -160]),
    code('d3000000-0000-4000-8000-00000000000a', 'Ответ: текст', fnRespText, [160, 40]),
    code('d3000000-0000-4000-8000-00000000000b', 'Ответ: нет', fnRespNone, [-60, 140])
  ],
  connections: {
    'When Executed by Another Workflow': { main: [[{ node: 'Найти', type: 'main', index: 0 }]] },
    'Найти': { main: [[{ node: 'Найден?', type: 'main', index: 0 }]] },
    'Найден?': { main: [ [{ node: 'Есть структура?', type: 'main', index: 0 }], [{ node: 'Ответ: нет', type: 'main', index: 0 }] ] },
    'Есть структура?': { main: [ [{ node: 'HTML разбора', type: 'main', index: 0 }], [{ node: 'Ответ: текст', type: 'main', index: 0 }] ] },
    'HTML разбора': { main: [[{ node: 'Gotenberg PDF', type: 'main', index: 0 }]] },
    'Gotenberg PDF': { main: [[{ node: 'Имя PDF', type: 'main', index: 0 }]] },
    'Имя PDF': { main: [[{ node: 'Отправить PDF', type: 'main', index: 0 }]] },
    'Отправить PDF': { main: [[{ node: 'Ответ: отправлен', type: 'main', index: 0 }]] }
  }
};

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK: узлов=' + wf.nodes.length + ', out=' + outp);
