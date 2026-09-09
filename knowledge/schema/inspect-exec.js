// Читает последнее исполнение workflow из sqlite n8n и вытаскивает контекст вокруг ключевых слов.
// Запуск в контейнере: node inspect-exec.js <workflowId> <kw1,kw2,...>
const path = '/usr/local/lib/node_modules/n8n/node_modules/sqlite3';
const sqlite3 = require(path).verbose();
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', sqlite3.OPEN_READONLY);
const wfId = process.argv[2];
const kws = (process.argv[3] || 'марципан,БЛОК,орех,response,output').split(',');

db.get('SELECT id,"workflowId",status,startedAt,stoppedAt FROM execution_entity WHERE "workflowId"=? ORDER BY id DESC LIMIT 1', [wfId], (e, row) => {
  if (e || !row) { console.log('нет исполнений:', e && e.message); db.close(); return; }
  console.log('exec id=' + row.id + ' status=' + row.status + ' started=' + row.startedAt);
  db.get('SELECT data FROM execution_data WHERE "executionId"=?', [row.id], (e2, dr) => {
    if (e2 || !dr) { console.log('нет данных:', e2 && e2.message); db.close(); return; }
    const data = String(dr.data || '');
    console.log('data length=' + data.length);
    for (const kw of kws) {
      const idxs = []; let i = data.indexOf(kw);
      while (i !== -1 && idxs.length < 4) { idxs.push(i); i = data.indexOf(kw, i + 1); }
      console.log('\n=== "' + kw + '" встреч: ' + (data.split(kw).length - 1) + ' ===');
      for (const p of idxs) {
        console.log('…' + data.slice(Math.max(0, p - 120), p + 180).replace(/\s+/g, ' ') + '…');
      }
    }
    db.close();
  });
});
