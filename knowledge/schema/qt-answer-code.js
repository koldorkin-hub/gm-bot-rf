const a = $input.first().json || {};
const p = $('Параметры').first().json;
const per = p.period_days;
const WD = ['','пн','вт','ср','чт','пт','сб','вс'];
const parse = v => { if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return null; } } return v; };
const HINT = ' Отвечай клиенту ПО ДНЯМ, с датами и днями недели. Нужен другой день или диапазон — вызови get_progress ещё раз с date=ГГГГ-ММ-ДД или date_from/date_to.';
if (p.domain === 'measurement') {
  if (p.error === 'no_metric') return [{ json: { response: 'Уточни, какую метрику показать (вес, талия, % жира и т.п.).' } }];
  if (a.n === undefined || a.n === null || Number(a.n) === 0) return [{ json: { response: 'В базе НЕТ записей по метрике ' + p.metric + ' за ' + per + ' дн. Так и скажи клиенту, не выдумывай.' } }];
  let arr = a.series; if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch (e) { arr = null; } }
  let s = 'Метрика ' + a.metric + ' за ' + per + ' дн: последнее ' + a.last_value + ' (' + a.last_date + '), записей ' + a.n + ', мин ' + a.min_v + ', макс ' + a.max_v + ', среднее ' + a.avg_v + '.';
  if (Array.isArray(arr) && arr.length) s += ' Ряд: ' + arr.map(x => x.d + '=' + x.v).join(', ') + '.';
  return [{ json: { response: s } }];
}
if (p.domain === 'records') {
  let recs = a.records; if (typeof recs === 'string') { try { recs = JSON.parse(recs); } catch (e) { recs = []; } }
  recs = Array.isArray(recs) ? recs : [];
  if (!recs.length) return [{ json: { response: 'Личных рекордов в базе пока НЕТ. Так и скажи клиенту — рекорды появятся, когда он запишет силовые тренировки (бот фиксирует рекорд, когда расчётный 1ПМ по упражнению превышает прежний максимум).' } }];
  const label = m => m === 'est_1rm' ? 'расч. 1ПМ' : m;
  const line = recs.map(r => r.exercise + ' — ' + r.value + (r.unit ? ' ' + r.unit : '') + ' (' + label(r.metric) + ', ' + r.date + ')').join('; ');
  return [{ json: { response: 'Личные рекорды клиента (из базы, лучшие по каждому упражнению): ' + line + '. Отвечай строго по этим данным, не выдумывай. Поздравь с достижениями и при желании отметь, над чем ещё можно поработать.' } }];
}
const rangeStr = ' с ' + a.from_d + ' по ' + a.to_d;
const nDays = (Date.parse(a.to_d) && Date.parse(a.from_d)) ? Math.round((Date.parse(a.to_d) - Date.parse(a.from_d)) / 86400000) + 1 : 31;
const detail = nDays <= 14;
if (p.domain === 'workout') {
  let ss = parse(a.sessions) || [];
  if (!ss.length) return [{ json: { response: (p.req_date ? 'За ' + p.req_date + ' тренировок в журнале НЕТ (этот день не логировался).' : 'Тренировок в журнале' + rangeStr + ' НЕТ.') + ' Так и скажи клиенту честно.' } }];
  let totVol = 0, totDist = 0;
  const lines = ss.map(s => {
    const es = Array.isArray(s.entries) ? s.entries : [];
    let vol = 0, dist = 0;
    const byEx = {}; const order = [];
    es.forEach(e => {
      const key = e.ex || (e.k === 'cardio' ? 'кардио' : '?');
      if (!byEx[key]) { byEx[key] = []; order.push(key); }
      byEx[key].push(e);
      if (e.k === 'strength') vol += (Number(e.reps) || 0) * (Number(e.w) || 0);
      else dist += Number(e.dist) || 0;
    });
    totVol += vol; totDist += dist;
    const head = WD[s.dow] + ' ' + s.d + ': ' + (s.type || 'тренировка') + (s.dur ? ' ' + s.dur + ' мин' : '');
    if (!detail) {
      const parts = [];
      if (vol) parts.push('объём ' + Math.round(vol) + ' кг');
      if (dist) parts.push((Math.round(dist / 10) / 100) + ' км');
      parts.push('упражнений ' + order.length);
      return head + ' — ' + parts.join(', ');
    }
    const exLines = order.map(name => {
      const arr = byEx[name];
      const st = arr.filter(e => e.k === 'strength');
      if (st.length) {
        return name + ': ' + st.map(e => { const w = Number(e.w) || 0; const rp = Number(e.reps) || 0; return w > 0 ? w + ' кг×' + rp : '×' + rp; }).join(', ');
      }
      const dd = arr.reduce((s2, e) => s2 + (Number(e.dist) || 0), 0);
      const sc = arr.reduce((s2, e) => s2 + (Number(e.sec) || 0), 0);
      const pieces = [];
      if (dd) pieces.push((Math.round(dd / 10) / 100) + ' км');
      if (sc) pieces.push(Math.round(sc / 60) + ' мин');
      return name + (pieces.length ? ' ' + pieces.join(', ') : '');
    });
    return head + ' — ' + exLines.join('; ') + (vol ? ' (объём ' + Math.round(vol) + ' кг)' : '');
  });
  let s = 'Тренировки' + rangeStr + ' (из базы, по дням):\n' + lines.join('\n');
  s += '\nИтого: сессий ' + ss.length + (totVol ? ', силовой объём (Σ повторы×вес) ' + Math.round(totVol) + ' кг' : '') + (totDist ? ', кардио ' + (Math.round(totDist / 10) / 100) + ' км' : '') + '.' + HINT;
  return [{ json: { response: s } }];
}
let days = parse(a.days) || [];
if (!days.length) return [{ json: { response: (p.req_date ? 'За ' + p.req_date + ' записей о еде НЕТ (этот день не логировался).' : 'Записей о еде' + rangeStr + ' НЕТ.') + ' Так и скажи клиенту честно.' } }];
let tk = 0, tp = 0, tf = 0, tc = 0, tn = 0;
days.forEach(dd => { tk += Number(dd.kcal) || 0; tp += Number(dd.p) || 0; tf += Number(dd.f) || 0; tc += Number(dd.c) || 0; tn += Number(dd.n) || 0; });
let body;
if (nDays > 35) {
  const wk = {};
  days.forEach(dd => {
    const t = new Date(dd.d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const y = t.getUTCFullYear();
    const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
    const key = y + ' неделя ' + (w < 10 ? '0' : '') + w;
    if (!wk[key]) wk[key] = { k: 0, n: 0, days: 0 };
    wk[key].k += Number(dd.kcal) || 0; wk[key].n += Number(dd.n) || 0; wk[key].days++;
  });
  body = Object.entries(wk).sort().map(([k, v]) => k + ': дней с записями ' + v.days + ', ' + Math.round(v.k) + ' ккал (в среднем ' + Math.round(v.k / v.days) + '/день)').join('\n');
  body += '\n(диапазон больше 35 дней — показаны итоги по неделям; для состава конкретного дня вызови с date)';
} else {
  body = days.map(dd => {
    let line = WD[dd.dow] + ' ' + dd.d + ': ' + Math.round(dd.kcal || 0) + ' ккал (Б' + Math.round(dd.p || 0) + ' Ж' + Math.round(dd.f || 0) + ' У' + Math.round(dd.c || 0) + '), записей ' + dd.n;
    if (detail && Array.isArray(dd.items)) line += ': ' + dd.items.map(it => (it.m ? it.m + ' — ' : '') + (it.t || '?') + (it.k != null ? ' (' + it.k + ' ккал)' : '')).join('; ');
    return line;
  }).join('\n');
}
let s = 'Еда' + rangeStr + ' (из базы, по дням):\n' + body;
s += '\nИтого: дней с записями ' + days.length + ', записей ' + tn + ', ' + Math.round(tk) + ' ккал (в среднем ' + Math.round(tk / days.length) + '/день), Б' + Math.round(tp) + ' Ж' + Math.round(tf) + ' У' + Math.round(tc) + '.' + HINT;
return [{ json: { response: s } }];
