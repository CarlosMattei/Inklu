import { randomUUID } from 'node:crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { parse } from 'node-html-parser';
import { ConteudoPlano, PlanoError, PlanoRow, TipoPlano, validarUuid } from '../models/plano.model';
import { PlanoTemplateService, perfilAluno } from './plano-template.service';
import { DocumentParserService, escapeHtml } from './document-parser.service';

export class PlanoService {
  constructor(private readonly db: SupabaseClient, readonly templates = new PlanoTemplateService(), private readonly parser = new DocumentParserService()) {}

  private async aluno(alunoId: string) {
    validarUuid(alunoId);
    const { data, error } = await this.db.from('aluno').select('*, turma(*, escola(*))').eq('id', alunoId).maybeSingle();
    if (error) throw new PlanoError(500, 'Não foi possível consultar o aluno.');
    if (!data) throw new PlanoError(404, 'Aluno não encontrado.');
    return data;
  }

  private content(type: TipoPlano, row: PlanoRow): ConteudoPlano {
    const text = type === 'pei' ? row.contexto : row.conteudo;
    try {
      const parsed = JSON.parse(text || '');
      if (parsed.schemaVersion === 1 && parsed.fields && parsed.perfil) return parsed;
    } catch { /* Suporte aos planos existentes em texto livre. */ }
    return {
      schemaVersion: 1, rootId: this.id(type, row), parentId: null, status: 'rascunho', name: `${type.toUpperCase()} ${row.ano_letivo} · ${row.bimestre}º bimestre`,
      perfil: perfilAluno({}), originalFormat: 'docx', warnings: ['Plano legado: confira os dados e complete as seções do modelo.'],
      fields: type === 'pei'
        ? { estrategias: `<p>${escapeHtml(row.contexto || '')}</p>`, conteudosHabilidades: `<p>${escapeHtml(row.metas || '')}</p>` }
        : { planejamento: `<p>${escapeHtml(row.conteudo || '')}</p>`, habilidades: `<p>${escapeHtml(row.habilidades || '')}</p>` },
    };
  }

  private id(type: TipoPlano, row: PlanoRow) { return (type === 'pei' ? row.id_pei : row.id_paee)!; }

  private summary(type: TipoPlano, row: PlanoRow) {
    const content = this.content(type, row);
    return {
      id: this.id(type, row), type, alunoId: row.id_aluno, bimestre: row.bimestre, anoLetivo: row.ano_letivo,
      name: content.name, status: content.status, rootId: content.rootId, parentId: content.parentId,
      createdAt: row.data_de_criacao, modifiedAt: row.data_de_alteracao,
    };
  }

  async list(alunoId: string) {
    await this.aluno(alunoId);
    const results = await Promise.all((['pei', 'paee'] as const).map(async type => {
      const { data, error } = await this.db.from(type).select('*').eq('id_aluno', alunoId).order('data_de_criacao', { ascending: false });
      if (error) throw new PlanoError(500, 'Não foi possível consultar os planos.');
      return (data as PlanoRow[]).map(row => this.summary(type, row));
    }));
    return results.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async fresh(alunoId: string, type: TipoPlano) {
    const aluno = await this.aluno(alunoId);
    const content: ConteudoPlano = {
      schemaVersion: 1, rootId: randomUUID(), parentId: null, status: 'rascunho',
      name: `${type.toUpperCase()} – ${aluno.nome_completo}`, perfil: perfilAluno(aluno), fields: {}, originalFormat: 'docx', warnings: [],
    };
    return content;
  }

  async editable(alunoId: string, type: TipoPlano, content: ConteudoPlano, bimestre: string, ano: number, id?: string, createdAt?: string) {
    return {
      id: id || 'novo', type, alunoId, bimestre, anoLetivo: ano, name: content.name,
      originalFormat: content.originalFormat, status: content.status,
      rootId: content.rootId, parentId: content.parentId, createdAt,
      warnings: content.warnings, ...(await this.templates.render(type, content, bimestre, ano)),
    };
  }

  async get(alunoId: string, type: TipoPlano, id: string) {
    validarUuid(alunoId); validarUuid(id);
    const { data, error } = await this.db.from(type).select('*').eq(`id_${type}`, id).eq('id_aluno', alunoId).maybeSingle();
    if (error) throw new PlanoError(500, 'Não foi possível carregar o plano.');
    if (!data) throw new PlanoError(404, 'Plano não encontrado para este aluno.');
    const row = data as PlanoRow;
    const content = this.content(type, row);
    // Registros legados não possuíam um retrato do perfil.
    if (!content.perfil.nome) content.perfil = perfilAluno(await this.aluno(alunoId));
    return { row, content, document: await this.editable(alunoId, type, content, row.bimestre, row.ano_letivo, id, row.data_de_criacao) };
  }

  async import(alunoId: string, type: TipoPlano, body: Record<string, unknown>) {
    const content = await this.fresh(alunoId, type);
    const { bimestre, ano } = this.period(body);
    if (typeof body.fileName !== 'string' || typeof body.fileBase64 !== 'string') throw new PlanoError(400, 'Nome e conteúdo do arquivo são obrigatórios.');
    const extension = body.fileName.split('.').pop()?.toLowerCase();
    if (extension !== 'pdf' && extension !== 'docx') throw new PlanoError(400, 'Envie um arquivo PDF ou DOCX.');
    if (body.fileBase64.length > 21 * 1024 * 1024) throw new PlanoError(400, 'O arquivo deve ter até 15 MB.');
    const raw = body.fileBase64.replace(/^data:[^;]+;base64,/, '');
    if (!/^[a-z0-9+/]+={0,2}$/i.test(raw)) throw new PlanoError(400, 'Arquivo inválido.');
    let parsed;
    try { parsed = await this.parser.parse(Buffer.from(raw, 'base64'), extension); }
    catch (error) { if (error instanceof PlanoError) throw error; throw new PlanoError(422, 'Não foi possível converter o arquivo. Confira se ele está íntegro e sem senha.'); }
    content.fields = await this.templates.importFields(type, parsed.html);
    content.originalFormat = extension;
    content.warnings = parsed.warnings;
    if (content.fields.importado) content.warnings.push(Object.keys(content.fields).length === 1
      ? 'O arquivo não foi reconhecido como o modelo padrão. Distribua seu conteúdo nos campos antes de finalizar.'
      : 'Imagens adicionais do arquivo foram preservadas na seção de conteúdo importado. Revise antes de finalizar.');
    return this.editable(alunoId, type, content, bimestre, ano);
  }

  period(body: Record<string, unknown>) {
    const bimestre = String(body.bimestre ?? '');
    const ano = body.anoLetivo;
    if (!/^[1-4]$/.test(bimestre) || typeof ano !== 'number' || !Number.isInteger(ano) || ano < 2000 || ano > 2100) {
      throw new PlanoError(400, 'Informe um bimestre de 1 a 4 e um ano letivo de 2000 a 2100.');
    }
    return { bimestre, ano };
  }

  async save(alunoId: string, type: TipoPlano, body: Record<string, unknown>) {
    const { bimestre, ano } = this.period(body);
    if (body.status !== 'rascunho' && body.status !== 'finalizado') throw new PlanoError(400, 'Status inválido.');
    if (typeof body.htmlContent !== 'string') throw new PlanoError(400, 'Conteúdo do plano obrigatório.');
    const fields = await this.templates.extractFields(type, body.htmlContent, body.status === 'finalizado');
    let content: ConteudoPlano;
    if (body.baseVersionId) {
      validarUuid(body.baseVersionId);
      const base = await this.get(alunoId, type, body.baseVersionId);
      if (base.row.bimestre !== bimestre || base.row.ano_letivo !== ano) throw new PlanoError(409, 'Para outro período, crie um novo plano.');
      // Cada salvamento é INSERT. Nem uma versão antiga nem uma finalizada é sobrescrita.
      content = { ...base.content, parentId: body.baseVersionId };
    } else { content = await this.fresh(alunoId, type); }
    const id = randomUUID();
    if (!body.baseVersionId) content.rootId = id;
    content.fields = fields;
    content.status = body.status;
    if (typeof body.name === 'string' && body.name.trim()) content.name = body.name.trim().slice(0, 200);
    if (!body.baseVersionId && (body.originalFormat === 'docx' || body.originalFormat === 'pdf')) {
      content.originalFormat = body.originalFormat;
      content.warnings = content.originalFormat === 'pdf' ? ['PDF importado: revise a formatação.'] : [];
    }
    const now = new Date().toISOString();
    const text = JSON.stringify(content);
    const secondary = parse(fields[type === 'pei' ? 'conteudosHabilidades' : 'habilidades'] || '').textContent;
    const payload: Record<string, unknown> = {
      [`id_${type}`]: id, id_aluno: alunoId, id_professor: null, bimestre, ano_letivo: ano,
      ...(type === 'pei' ? { contexto: text, metas: secondary } : { conteudo: text, habilidades: secondary }),
      data_de_criacao: now, data_de_alteracao: now,
    };
    const { data, error } = await this.db.from(type).insert(payload).select('*').single();
    if (error) throw new PlanoError(500, 'Não foi possível salvar o plano. Tente novamente.');
    return this.editable(alunoId, type, content, bimestre, ano, this.id(type, data), data.data_de_criacao);
  }
}
