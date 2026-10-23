import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ACCESSORY_TITLE_PATTERNS,
  COMPLETE_APPLIANCE_TITLE_PATTERNS,
} from '../src/catalog-category-overrides.js';

function matchesSqlPrefix(title, patterns) {
  const normalized = title.trim().toLocaleLowerCase('pt-BR');
  return patterns.some((pattern) => normalized.startsWith(pattern.slice(0, -1)));
}

test('prefixos confirmados de peças deslocam apenas títulos que vieram como Eletrodomésticos', () => {
  for (const title of [
    'Tirante Lavadora Brastemp 7kg A 11kg 4 Peças',
    'Pressostato Lavadora Roupas Consul Facilite Cwe11 Cwe10',
    'Micro Chave Lavadora Brastemp Bwc10a Bwf08b Bwf09a Bwh09a',
    'Eletrobomba Bomba Drenagem 127v Lavadora Electrolux Lt12b',
    'Kit Mica Micro-ondas 14x14cm + Ponta Ponteira Bico Magnetron Microondas Triangular',
    'Polia Agitador Tanquinho Colormaq Lcm 9 / 10 / 13 / 15kg',
  ]) {
    assert.equal(matchesSqlPrefix(title, ACCESSORY_TITLE_PATTERNS), true, title);
  }
});

test('prefixos confirmados de aparelhos completos deslocam apenas títulos que vieram como ELETRO & ACESSÓRIOS', () => {
  for (const title of [
    'Tanquinho Britânia 15kg Semi Automático BLT15A 510W Silencioso Dispenser Duplo 110/220V',
    'Máquina de lavar 12Kg Philco 16 Modos de operação PLR12A',
    'Micro-Ondas Mondial 21 Litros MO-01-21-B Preto 1200W Display Digital',
    'Fogão a Gás 4 Bocas Inox Embutir e Mesa Cozinha e Restaurante 4 Queimadores',
    'Fogão Itatiaia Star New 4 Bocas Com Acendimento Automático Branco/Preto - Cozinha Fogões',
  ]) {
    assert.equal(matchesSqlPrefix(title, COMPLETE_APPLIANCE_TITLE_PATTERNS), true, title);
  }
});

test('SQL aplica overrides somente quando a categoria de origem é uma das duas categorias eletro', async () => {
  const route = await readFile(new URL('../src/routes/catalog.js', import.meta.url), 'utf8');
  assert.match(route, /ACCESSORY_TITLE_PATTERNS/);
  assert.match(route, /COMPLETE_APPLIANCE_TITLE_PATTERNS/);
  assert.match(route, /WHEN p\.category = 'Eletrodomésticos'[\s\S]*?THEN 'ELETRO & ACESSÓRIOS'/);
  assert.match(route, /WHEN p\.category = 'ELETRO & ACESSÓRIOS'[\s\S]*?THEN 'Eletrodomésticos'/);
  assert.match(route, /ELSE p\.category/);
});
