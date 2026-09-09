// Трансформ основного workflow под подэтап 6 (инъекция выжимки client_summary в контекст).
// Поверх текущего main. Идемпотентно.
// Запуск: node transform-main-substep6.js <in.json> <out.json>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const nodes = wf.nodes;
const byName = {}; nodes.forEach(n => byName[n.name] = n);

// --- Load Profile: добавить summary в общий запрос ---
byName['Load Profile'].parameters.query =
  "SELECT (SELECT to_jsonb(p) FROM client_profile p WHERE p.bot_id=$1 AND p.user_id=$2) AS profile, " +
  "(SELECT json_agg(jsonb_build_object('substance',substance,'severity',severity,'confirmed',confirmed)) FROM allergen WHERE bot_id=$1 AND user_id=$2) AS allergens, " +
  "(SELECT json_agg(jsonb_build_object('id',id,'area',area,'status',status)) FROM injury WHERE bot_id=$1 AND user_id=$2 AND status<>'resolved') AS injuries, " +
  "(SELECT json_agg(jsonb_build_object('name',name)) FROM condition WHERE bot_id=$1 AND user_id=$2 AND active) AS conditions, " +
  "(SELECT json_agg(jsonb_build_object('name',name,'dose',dose)) FROM medication WHERE bot_id=$1 AND user_id=$2 AND active) AS medications, " +
  "(SELECT json_agg(jsonb_build_object('item',item,'stance',stance)) FROM food_preference WHERE bot_id=$1 AND user_id=$2) AS preferences, " +
  "(SELECT json_agg(jsonb_build_object('scope',scope,'value',value,'source',source_type)) FROM exclusion WHERE bot_id=$1 AND user_id=$2 AND active) AS exclusions, " +
  "(SELECT summary_text FROM client_summary WHERE bot_id=$1 AND user_id=$2) AS summary;";

// --- Build Profile Context: рендер выжимки в начало блока ---
let bpc = byName['Build Profile Context'].parameters.jsCode;
if (!bpc.includes('row.summary')) {
  bpc = bpc.replace(
    "const exclusions = asObj(row.exclusions) || [];",
    "const exclusions = asObj(row.exclusions) || [];\nconst summary = (row.summary == null) ? '' : String(row.summary);"
  );
  bpc = bpc.replace(
    "return [{ json: { message: msg, profile_block: block } }];",
    "if (summary && summary.trim()) block = 'ВЫЖИМКА О КЛИЕНТЕ (долговременная память — опирайся на неё, это сжатая история общения):\\n' + summary.trim() + '\\n\\n' + block;\nreturn [{ json: { message: msg, profile_block: block } }];"
  );
  byName['Build Profile Context'].parameters.jsCode = bpc;
}

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK: LoadProfile.summary=' + byName['Load Profile'].parameters.query.includes('AS summary') + ', bpc.summary=' + byName['Build Profile Context'].parameters.jsCode.includes('row.summary'));
