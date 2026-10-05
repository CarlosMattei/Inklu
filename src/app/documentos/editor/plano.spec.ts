import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { PlanField, PlanFixed } from './plan-nodes';
import { PlanoService } from './services/plano.service';

describe('Planos educacionais', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('mantém a identificação em leitura e serializa a resposta sem duplicar a pergunta', () => {
    const element = document.createElement('div');
    document.body.append(element);
    const editor = new Editor({
      element, extensions: [StarterKit, PlanFixed, PlanField],
      content: '<div data-plan-fixed="header"><h1>PEI</h1><p>Nome: Maria</p></div><div data-plan-field="estrategias"><h3>Estratégias *</h3><div data-plan-hint="true"><p>Orientação do modelo</p></div><div data-plan-content="true"><p>Jogos acessíveis</p></div></div>',
    });
    try {
      expect(element.querySelector('[data-plan-fixed]')?.getAttribute('contenteditable')).toBe('false');
      expect(element.querySelector('[data-plan-field] > h3')?.getAttribute('contenteditable')).toBe('false');
      expect(element.querySelector('[data-plan-content]')?.textContent).toBe('Jogos acessíveis');
      const html = editor.getHTML();
      expect((html.match(/data-plan-field="estrategias"/g) || []).length).toBe(1);
      expect(html).toContain('data-plan-content="true"');
      expect(html).toContain('Orientação do modelo');
      expect(html).toContain('Jogos acessíveis');
      editor.setEditable(false);
      expect(editor.isEditable).toBe(false);
    } finally { editor.destroy(); element.remove(); }
  });

  it('propaga falha ao salvar e envia a versão base e o aluno corretos', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const service = TestBed.inject(PlanoService);
    const http = TestBed.inject(HttpTestingController);
    const promise = service.save('aluno-a', 'paee', {
      name: 'PAEE', bimestre: '2', anoLetivo: 2026, status: 'rascunho',
      htmlContent: '<p>Resposta</p>', baseVersionId: 'versao-anterior', originalFormat: 'docx',
    });
    const failed = expect(promise).rejects.toMatchObject({ status: 500 });
    const request = http.expectOne('http://localhost:3000/api/alunos/aluno-a/planos/paee');
    expect(request.request.body.baseVersionId).toBe('versao-anterior');
    expect(request.request.body.status).toBe('rascunho');
    request.flush({ erro: 'Falha no banco' }, { status: 500, statusText: 'Server Error' });
    await failed; http.verify();
  });

  it('busca o histórico exclusivamente pelo aluno e recebe o arquivo exportado como blob', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const service = TestBed.inject(PlanoService); const http = TestBed.inject(HttpTestingController);
    const list = service.list('aluno-a');
    http.expectOne('http://localhost:3000/api/alunos/aluno-a/planos').flush([]);
    expect(await list).toEqual([]);
    const download = service.export('aluno-a', 'pei', 'versao', 'pdf');
    const request = http.expectOne('http://localhost:3000/api/alunos/aluno-a/planos/pei/versao/exportar');
    expect(request.request.responseType).toBe('blob');
    expect(request.request.body).toEqual({ format: 'pdf' });
    const pdf = new Blob(['%PDF-'], { type: 'application/pdf' }); request.flush(pdf);
    expect(await download).toBe(pdf); http.verify();
  });
});
