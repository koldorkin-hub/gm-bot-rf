// Фикс: claude-opus-4-8 кладёт в строковые значения JSON сырые управляющие символы
// (непроэкранированные \n и т.п.) → JSON.parse падает «Bad control character in string literal».
// Ломало КАЖДЫЙ разбор на узле «Собрать отчёт» (и потенциально «Разобрать план/аудит»).
// Чиним parseLoose во всех трёх: при ошибке парсинга — второй заход с экранированием
// управляющих символов ВНУТРИ строковых литералов (структуру JSON не трогаем).
// Идемпотентно (признак '__sanitizeCtrl'). Запуск: node transform-research-json-sanitize.js <in> <out>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;

const HELPER =
"function __sanitizeCtrl(s){let o='',inStr=false,esc=false;for(let i=0;i<s.length;i++){const ch=s[i],code=s.charCodeAt(i);" +
"if(esc){o+=ch;esc=false;continue;}if(ch==='\\\\'){o+=ch;esc=true;continue;}if(ch==='\"'){inStr=!inStr;o+=ch;continue;}" +
"if(inStr&&code<0x20){o+=(ch==='\\n'?'\\\\n':ch==='\\r'?'\\\\r':ch==='\\t'?'\\\\t':'\\\\u'+code.toString(16).padStart(4,'0'));continue;}o+=ch;}return o;}\n";

const FIND = "try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }";
const REPL = "try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { try { return JSON.parse(__sanitizeCtrl(s.slice(a, b + 1))); } catch (e2) { return null; } }";

let patched = 0, skipped = 0;
for (const nm of ['Собрать отчёт', 'Разобрать план', 'Разобрать аудит']) {
  const n = wf.nodes.find(x => x.name === nm);
  if (!n || !n.parameters || !n.parameters.jsCode) { console.log(nm + ': нет узла/кода'); continue; }
  let code = n.parameters.jsCode;
  if (code.includes('__sanitizeCtrl')) { console.log(nm + ': уже пропатчен'); skipped++; continue; }
  if (!code.includes(FIND)) { console.log(nm + ': ⚠️ шаблон JSON.parse не найден — пропуск'); continue; }
  code = HELPER + code.replace(FIND, REPL);
  n.parameters.jsCode = code;
  patched++;
  console.log(nm + ': ✓ пропатчен');
}
fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK sanitize: пропатчено ' + patched + ', уже было ' + skipped);
