import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { PlanoService } from '../src/services/plano.service';
import { DocumentParserService, sanitizeDocument } from '../src/services/document-parser.service';
import { DocumentGeneratorService } from '../src/services/document-generator.service';
import { createPlanoRouter } from '../src/routes/plano.routes';

const studentId = '10000000-0000-0000-0000-000000000001';
const otherId = '10000000-0000-0000-0000-000000000002';
const student = {
  id: studentId, nome_completo: 'Estudante de teste', data_de_nascimento: '2016-02-03', genero: 'Feminino',
  diagnostico: JSON.stringify([{ diagnostico: 'TEA', descricao: 'Apoio à comunicação' }]),
  preferencias: 'Aprender com imagens', interesses: '["Jogos"]',
  turma: { nome: 'A', serie: '5º ano', periodo: 'Manhã', escola: { nome: 'Escola de teste' } },
};

function memoryDb() {
  const tables: Record<string, any[]> = { aluno: [structuredClone(student), { id: otherId, nome_completo: 'Outro aluno' }], pei: [], paee: [] };
  const db = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let payload: any; let desc = false;
      const query: any = {
        select() { return query; },
        eq(key: string, value: unknown) { filters.push([key, value]); return query; },
        order() { desc = true; return query; },
        insert(value: any) { payload = value; return query; },
        async maybeSingle() { return { data: tables[table].find(row => filters.every(([k, v]) => row[k] === v)) ?? null, error: null }; },
        async single() { tables[table].push(structuredClone(payload)); return { data: structuredClone(payload), error: null }; },
        then(resolve: (value: unknown) => unknown) {
          const rows = tables[table].filter(row => filters.every(([k, v]) => row[k] === v));
          if (desc) rows.reverse();
          return Promise.resolve({ data: structuredClone(rows), error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  return { db: db as unknown as SupabaseClient, tables };
}

for (const type of ['pei', 'paee'] as const) {
  test(`${type}: modelo real, perfil automático, rascunhos, finalização e versões imutáveis`, async () => {
    const { db, tables } = memoryDb();
    const service = new PlanoService(db);
    const initial = await service.fresh(studentId, type);
    const editable = await service.editable(studentId, type, initial, '1', 2026);
    assert.match(editable.htmlContent, /Estudante de teste/);
    assert.match(editable.htmlContent, /Aprender com imagens/);
    assert.match(editable.htmlContent, /TEA/);
    assert.match(editable.htmlContent, /5º ano/);
    assert.equal(editable.fields.length, type === 'pei' ? 5 : 14);
    const draft = await service.save(studentId, type, { htmlContent: editable.htmlContent, bimestre: '1', anoLetivo: 2026, status: 'rascunho' });
    assert.equal(tables[type][0].id_professor, null);
    const immutableRow = JSON.stringify(tables[type][0]);
    await assert.rejects(service.save(studentId, type, { htmlContent: draft.htmlContent, bimestre: '1', anoLetivo: 2026, status: 'finalizado', baseVersionId: draft.id }), /Preencha os campos/);
    assert.equal(tables[type].length, 1);
    const filled = draft.htmlContent.replaceAll('<div data-plan-content="true"><p></p></div>', '<div data-plan-content="true"><p>Resposta pedagógica de teste</p></div>');
    const final = await service.save(studentId, type, { htmlContent: filled, bimestre: '1', anoLetivo: 2026, status: 'finalizado', baseVersionId: draft.id });
    assert.equal(final.parentId, draft.id);
    assert.equal(final.rootId, draft.rootId);
    assert.equal(final.status, 'finalizado');
    assert.equal(JSON.stringify(tables[type][0]), immutableRow);
    tables.aluno[0].nome_completo = 'Nome atualizado no perfil';
    const historical = (await service.get(studentId, type, draft.id)).document;
    assert.match(historical.htmlContent, /Estudante de teste/);
    assert.doesNotMatch(historical.htmlContent, /Nome atualizado/);
    await assert.rejects(service.get(otherId, type, draft.id), /Plano não encontrado/);
    await assert.rejects(service.save(otherId, type, { htmlContent: filled, bimestre: '1', anoLetivo: 2026, status: 'rascunho', baseVersionId: draft.id }), /Plano não encontrado/);
    await assert.rejects(service.save(studentId, type, { htmlContent: filled, bimestre: '2', anoLetivo: 2026, status: 'rascunho', baseVersionId: draft.id }), /outro período/);
    const secondPeriod = await service.save(studentId, type, { htmlContent: editable.htmlContent, bimestre: '2', anoLetivo: 2026, status: 'rascunho' });
    assert.notEqual(secondPeriod.rootId, draft.rootId);
    const summaries = await service.list(studentId);
    assert.equal(summaries.length, 3);
    assert.ok(summaries.every(plan => !!plan.createdAt && !!plan.bimestre));
    assert.deepEqual(await service.list(otherId), []);
  });
}

test('campos duplicados, conteúdo malicioso, períodos inválidos e aluno inexistente', async () => {
  const { db } = memoryDb(); const service = new PlanoService(db);
  const template = service.templates;
  const duplicate = '<div data-plan-field="estrategias"><div data-plan-content="true"><p>A</p></div></div>'.repeat(2);
  await assert.rejects(template.extractFields('pei', duplicate), /duplicados/);
  const safe = sanitizeDocument('<script>alert(1)</script><p onclick="x()">Resposta</p><img src="http://localhost/secreto"><img src="data:image/svg+xml;base64,AA">');
  assert.doesNotMatch(safe, /script|onclick|localhost|svg/);
  assert.match(safe, /Resposta/);
  assert.throws(() => service.period({ bimestre: '5', anoLetivo: 2026 }), /bimestre/);
  assert.throws(() => service.period({ bimestre: '1', anoLetivo: '2026' }), /ano letivo/);
  await assert.rejects(service.fresh('10000000-0000-0000-0000-000000000099', 'pei'), /Aluno não encontrado/);
});

test('importação DOCX do modelo e retorno de erro para arquivo inválido', async () => {
  const { db } = memoryDb(); const service = new PlanoService(db);
  for (const type of ['pei', 'paee'] as const) {
    const buffer = await readFile(new URL(`../templates/${type}.docx`, import.meta.url));
    const result = await service.import(studentId, type, { fileName: `${type}.docx`, fileBase64: buffer.toString('base64'), bimestre: '3', anoLetivo: 2026 });
    assert.match(result.htmlContent, /Estudante de teste/);
    assert.equal(result.originalFormat, 'docx');
    assert.equal(result.id, 'novo');
  }
  await assert.rejects(service.import(studentId, 'pei', { fileName: 'arquivo.exe', fileBase64: 'AA==', bimestre: '1', anoLetivo: 2026 }), /PDF ou DOCX/);
  await assert.rejects(service.import(studentId, 'pei', { fileName: 'arquivo.docx', fileBase64: 'AA==', bimestre: '1', anoLetivo: 2026 }), /DOCX inválido/);
});

test('geração real de DOCX e PDF A4, com texto, tabela e importação do PDF', async () => {
  const generator = new DocumentGeneratorService(); const parser = new DocumentParserService();
  const html = '<h1>Plano de teste</h1><p><strong>Aprender com imagens</strong></p><table><tr><th>Meta</th></tr><tr><td>Comunicação</td></tr></table>';
  const docx = await generator.generateFromHtml(html, 'docx');
  assert.equal(docx.subarray(0, 2).toString(), 'PK');
  const parsed = await parser.parse(docx, 'docx');
  assert.match(parsed.html, /<table>/); assert.match(parsed.html, /Comunicação/);
  const pdf = await generator.generateFromHtml(html, 'pdf');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const text = await parser.parse(pdf, 'pdf');
  assert.match(text.html, /Plano de teste/); assert.match(text.html, /Comunicação/);
  const imagePdf = await generator.generateFromHtml('<div style="height:100px"></div>', 'pdf');
  const scanned = await parser.parse(imagePdf, 'pdf');
  assert.match(scanned.html, /data:image\/png;base64/);
  assert.ok(scanned.warnings.some(warning => warning.includes('digitalizado')));
  const mixedPdf = await generator.generateFromHtml('<p>Texto com imagem</p>' + scanned.html, 'pdf');
  const mixed = await parser.parse(mixedPdf, 'pdf');
  assert.match(mixed.html, /Texto com imagem/);
  assert.match(mixed.html, /data:image\/png;base64/);
  const { PDFParse } = await import('pdf-parse');
  const info = new PDFParse({ data: pdf });
  try { const screenshot = await info.getScreenshot({ scale: 1 }); assert.ok(Math.abs(screenshot.pages[0].width / screenshot.pages[0].height - 210 / 297) < .005); }
  finally { await info.destroy(); }
});

test('rotas isolam alunos, recusam exportar rascunho e exportam finalizados', async () => {
  const { db } = memoryDb(); const service = new PlanoService(db);
  const app = express(); app.use(express.json()); app.use('/api/alunos/:alunoId/planos', createPlanoRouter(service));
  const server = app.listen(0);
  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as { port: number };
    const base = `http://localhost:${address.port}/api/alunos/${studentId}/planos`;
    const response = await fetch(`${base}/pei/modelo?bimestre=1&anoLetivo=2026`);
    assert.equal(response.status, 200); const initial = await response.json();
    const body = { htmlContent: initial.htmlContent, bimestre: '1', anoLetivo: 2026, status: 'rascunho' };
    const savedResponse = await fetch(`${base}/pei`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(savedResponse.status, 201); const draft = await savedResponse.json();
    const exportDraft = await fetch(`${base}/pei/${draft.id}/exportar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"format":"docx"}' });
    assert.equal(exportDraft.status, 409);
    const crossStudent = await fetch(`${base.replace(studentId, otherId)}/pei/${draft.id}`);
    assert.equal(crossStudent.status, 404);
    const final = await service.save(studentId, 'pei', { ...body, status: 'finalizado', baseVersionId: draft.id, htmlContent: body.htmlContent.replaceAll('<p></p>', '<p>Resposta</p>') });
    const exportFinal = await fetch(`${base}/pei/${final.id}/exportar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"format":"docx"}' });
    assert.equal(exportFinal.status, 200); assert.equal(Buffer.from(await exportFinal.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
