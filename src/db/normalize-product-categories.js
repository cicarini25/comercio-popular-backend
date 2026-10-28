import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pool from './pool.js';
import {
  SITE_CATEGORIES,
  inferSiteCategoryFromText,
  resolveSiteCategory
} from '../integrations/core/site-category-resolver.js';
import { AUDITED_PRODUCT_CATEGORY_OVERRIDES } from '../catalog-product-category-overrides.js';

const APPLY = process.argv.includes('--apply');
const reportArgument = process.argv.find((argument) => argument.startsWith('--report='));
const approvalArgument = process.argv.find((argument) => argument.startsWith('--approved-from='));
const reportPath = reportArgument ? resolve(process.cwd(), reportArgument.slice('--report='.length)) : null;
const approvalPath = approvalArgument ? resolve(process.cwd(), approvalArgument.slice('--approved-from='.length)) : null;
const CHUNK_SIZE = 500;

if (APPLY && !approvalPath) {
  console.error('Para gravar, informe o CSV revisado: --apply --approved-from=category-review.csv');
  process.exitCode = 1;
} else {
  function normalizeProduct(row) {
    const current = typeof row.category === 'string' ? row.category.trim() : '';
    const auditedCategory = row.source === 'proprio'
      ? undefined
      : AUDITED_PRODUCT_CATEGORY_OVERRIDES[row.id];
    if (auditedCategory) return auditedCategory;
    return resolveSiteCategory({
      category: current,
      title: row.title || '',
      description: row.description || '',
      currentCategory: current
    });
  }

  function csvCell(value) {
    const text = value == null ? '' : String(value);
    return '"' + text.replaceAll('"', '""') + '"';
  }

  function parseCsv(content) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    const input = content.replace(/^\uFEFF/, '');
    for (let index = 0; index < input.length; index += 1) {
      const char = input[index];
      if (quoted) {
        if (char === '"' && input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          field += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ',') {
        row.push(field);
        field = '';
      } else if (char === '\n') {
        row.push(field.replace(/\r$/, ''));
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += char;
      }
    }
    if (field || row.length) {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
    }
    if (!rows.length) return [];
    const headers = rows.shift();
    return rows.filter((values) => values.some(Boolean)).map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
    );
  }

  function createAuditRow(row) {
    const current = typeof row.category === 'string' ? row.category.trim() : '';
    const auditedCategory = row.source === 'proprio'
      ? undefined
      : AUDITED_PRODUCT_CATEGORY_OVERRIDES[row.id];
    const titleSuggestion = inferSiteCategoryFromText(row.title || '');
    const proposed = normalizeProduct(row);
    const currentIsCanonical = SITE_CATEGORIES.includes(current);
    const reason = auditedCategory
      ? 'Correção manual revisada para este produto; validar antes de aprovar'
      : titleSuggestion && titleSuggestion !== current
      ? 'O título sugere outra categoria; confirme antes de aprovar'
      : !currentIsCanonical && proposed === 'Outros'
        ? 'Categoria não reconhecida; classifique manualmente'
        : titleSuggestion
          ? 'Título e categoria atual coincidem'
          : currentIsCanonical
            ? 'Sem evidência suficiente no título; categoria atual preservada'
            : 'Categoria de origem convertida para a lista oficial';

    return {
      id: row.id,
      source: row.source,
      title: row.title,
      current,
      previousValue: row.category,
      previousIsNull: row.category == null,
      proposed,
      reason
    };
  }

  function buildSummary(rows) {
    return rows.reduce((summary, row) => {
      const key = `${row.current || '(sem categoria)'} → ${row.proposed}`;
      summary[key] = (summary[key] || 0) + 1;
      return summary;
    }, {});
  }

  const client = await pool.connect();
  let transactionOpen = false;
  try {
    const result = await client.query(
      'SELECT id::text AS id, source, title, description, category FROM products ORDER BY created_at, id'
    );
    const audit = result.rows.map(createAuditRow);
    const suggestedChanges = audit.filter((row) => row.current !== row.proposed);
    let approvedChanges = [];
    let skippedStale = 0;

    if (reportPath) {
      const headers = ['id', 'source', 'title', 'category_before', 'previous_category_is_null', 'category_suggested', 'approved_category', 'reason'];
      const csv = [headers.map(csvCell).join(',')].concat(audit.map((row) => [
        row.id, row.source, row.title, row.current, row.previousIsNull ? '1' : '0', row.proposed, '', row.reason
      ].map(csvCell).join(','))).join('\n');
      await writeFile(reportPath, '\uFEFF' + csv, 'utf8');
    }

    if (APPLY) {
      if (reportPath && reportPath === approvalPath) {
        throw new Error('O arquivo de aprovação não pode ser sobrescrito pelo relatório da mesma execução.');
      }
      const approvedRows = parseCsv(await readFile(approvalPath, 'utf8'));
      const requiredHeaders = ['id', 'category_before', 'previous_category_is_null', 'approved_category'];
      if (!approvedRows.length || requiredHeaders.some((header) => !(header in approvedRows[0]))) {
        throw new Error('CSV inválido: use o arquivo de prévia e preencha a coluna approved_category.');
      }
      const productsById = new Map(result.rows.map((row) => [row.id, row]));
      for (const [index, approved] of approvedRows.entries()) {
        const category = String(approved.approved_category || '').trim();
        if (!category) continue;
        if (!SITE_CATEGORIES.includes(category)) {
          throw new Error(`Linha ${index + 2}: categoria aprovada não pertence à taxonomia oficial.`);
        }
        const currentProduct = productsById.get(approved.id);
        if (!currentProduct) {
          skippedStale += 1;
          continue;
        }
        const previousCategory = approved.previous_category_is_null === '1' ? null : approved.category_before;
        if (currentProduct.category !== previousCategory) {
          skippedStale += 1;
          continue;
        }
        if (currentProduct.category === category) continue;
        approvedChanges.push({ id: currentProduct.id, previousValue: currentProduct.category, proposed: category });
      }
    }

    let applied = 0;
    if (APPLY && approvedChanges.length) {
      await client.query('BEGIN');
      transactionOpen = true;
      // A revisão altera somente products.category; product_offers.affiliate_url e os links de afiliado não são tocados.
      for (let index = 0; index < approvedChanges.length; index += CHUNK_SIZE) {
        const chunk = approvedChanges.slice(index, index + CHUNK_SIZE).map(({ id, proposed, previousValue }) => ({
          id,
          previousCategory: previousValue,
          category: proposed
        }));
        const update = await client.query(
          "UPDATE products AS p SET category = changes.category, updated_at = now() " +
          "FROM jsonb_to_recordset($1::jsonb) AS changes(id uuid, previousCategory text, category text) " +
          "WHERE p.id = changes.id AND p.category IS NOT DISTINCT FROM changes.previousCategory",
          [JSON.stringify(chunk)]
        );
        applied += update.rowCount || 0;
      }
      await client.query('COMMIT');
      transactionOpen = false;
    }

    console.log(JSON.stringify({
      mode: APPLY ? 'applied_reviewed_categories' : 'preview_only',
      scanned: result.rows.length,
      suggestedChanges: suggestedChanges.length,
      approvedChanges: approvedChanges.length,
      applied,
      skippedStale,
      categorySuggestions: buildSummary(suggestedChanges),
      examples: suggestedChanges.slice(0, 100).map(({ id, source, title, current, proposed, reason }) => ({ id, source, title, current, proposed, reason })),
      remainingExamples: Math.max(0, suggestedChanges.length - 100),
      reviewCsv: reportPath || null,
      approvedCsv: APPLY ? approvalPath : null
    }, null, 2));
  } catch (error) {
    if (transactionOpen) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    console.error('Não foi possível revisar as categorias:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

