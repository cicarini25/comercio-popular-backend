// Converte uma planilha CSV da SHEIN em JSON pronto para o endpoint de importação.
// Uso: node scripts/prepare-shein-feed.mjs produtos-shein.csv > shein-import.json
// Colunas: id,titulo,preco,preco_original,imagem_url,link_afiliado,link_produto,categoria
// Aceita separador vírgula ou ponto e vírgula (padrão do Excel em português).
import fs from 'node:fs';

function parseCsv(text) {
  const firstLine = text.split(/\r?\n/, 1)[0];
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(value => value.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some(value => value.trim() !== '')) rows.push(row);
  return rows;
}

const file = process.argv[2];
if (!file) {
  console.error('Uso: node scripts/prepare-shein-feed.mjs arquivo.csv > shein-import.json');
  process.exit(1);
}

const [header, ...lines] = parseCsv(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const keys = header.map(name => name.trim());
const items = lines.map(cells =>
  Object.fromEntries(keys.map((key, index) => [key, (cells[index] ?? '').trim()]).filter(([, value]) => value !== ''))
);

console.log(JSON.stringify({ dryRun: true, items }, null, 2));
