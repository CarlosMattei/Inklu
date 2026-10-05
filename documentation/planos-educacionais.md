# PEI e PAEE

No perfil do aluno, a seção **Planos educacionais** oferece **Criar PEI**, **Criar PAEE**, acesso aos planos atuais e a todas as versões anteriores. Cada documento pode ser aberto em leitura ou usado como base para uma nova versão.

O editor usa os modelos originais em `backend/templates/pei.docx` e `backend/templates/paee.docx`. As perguntas e assinaturas são extraídas desses arquivos com Mammoth. Nome, nascimento, gênero, escola, turno, turma, série, diagnóstico, preferências e interesses são preenchidos a partir do aluno e de seus vínculos. Informações ausentes ficam identificadas como não informadas. Os nomes de profissionais e assinaturas continuam disponíveis no modelo, sem exigir um cadastro de professor ou gestor.

## Uso

1. Escolha o bimestre e o ano letivo antes de salvar a primeira versão.
2. Digite as respostas nas áreas de cada pergunta, usando a barra de formatação, ou importe PDF/DOCX de até 15 MB.
3. **Salvar Rascunho** permanece visível e aceita respostas incompletas.
4. **Finalizar plano** exige os campos pedagógicos marcados com `*`. Campos não aplicáveis podem ser justificados na resposta; nível de apoio e observações do PAEE são opcionais.
5. Exporte uma versão finalizada em **PDF** ou **DOCX**. Quando houver alterações pendentes, salve/finalize a nova versão antes de exportar.

DOCX preserva estrutura semântica, tabelas, listas e imagens. Um arquivo reconhecido como o modelo é distribuído nas suas perguntas. Arquivos não reconhecidos aparecem em uma seção de conteúdo importado, que deve ser revisada e distribuída no modelo antes da finalização. PDFs com texto são convertidos para HTML e recebem aviso sobre fidelidade de layout. PDFs digitalizados de até 20 páginas são preservados como imagens; o texto das imagens não é editável e as respostas do modelo precisam ser digitadas.

## Persistência e versões

Não é necessária uma migração. As tabelas existentes permitem `id_professor = null`. A coluna `pei.contexto` ou `paee.conteudo` guarda JSON com `schemaVersion: 1`, campos HTML sanitizados, nome, status, retrato do perfil, formato de origem, raiz do plano e versão anterior. `pei.metas` contém o texto dos conteúdos/habilidades; `paee.habilidades` contém o texto das habilidades. Aluno, bimestre, ano e datas permanecem nas suas colunas existentes.

**Todo salvamento faz INSERT**, inclusive rascunhos. Não há rotas de atualização ou exclusão de versões. O retrato do perfil de uma versão salva não muda quando o aluno é editado. Outro bimestre/ano começa um novo plano. Um salvamento a partir de uma versão antiga cria uma nova versão e preserva também as versões posteriores àquela base. Salvamentos simultâneos preservam ambas as versões; não há sobrescrita. Campos duplicados ou desconhecidos são recusados, e respostas fora das áreas do modelo precisam ser movidas antes de salvar para evitar perda de texto.

Planos legados em texto livre continuam acessíveis, com aviso para completar o modelo ao criar uma nova versão. Todas as buscas, bases de versão e exportações são limitadas por `id_aluno`; um ID de plano de outro aluno retorna 404.

Os controles de autoria, vínculo e permissão por professor, coordenador e administrador ficam para a etapa de cadastro/autenticação desses perfis, conforme o escopo solicitado. O modo leitura já está disponível na interface; autorização por perfil ainda não é aplicada na API.

## API

Base: `/api/alunos/:alunoId/planos`

| Método | Caminho | Resultado |
| --- | --- | --- |
| GET | `/` | Histórico de PEI e PAEE do aluno |
| GET | `/:tipo/modelo?bimestre=1&anoLetivo=2026` | Modelo com dados do aluno |
| POST | `/:tipo/importar` | Conversão PDF/DOCX para o modelo editável |
| GET | `/:tipo/:id` | Uma versão do plano |
| POST | `/:tipo` | Nova versão, com `baseVersionId` opcional |
| POST | `/:tipo/:id/exportar` | Arquivo de versão finalizada, com `format: pdf/docx/html` |

O corpo do salvamento contém `name`, `bimestre` ("1" a "4"), `anoLetivo` (2000 a 2100), `status` ("rascunho" ou "finalizado"), `htmlContent`, `baseVersionId` e `originalFormat`. O servidor reconstrói identificação, perguntas e assinaturas a partir dos dados confiáveis, sanitiza respostas e valida os campos antes de gravar.

## Execução e validação

Inicie o backend com `npm run dev` em `backend/` e o frontend com `npm start` na raiz. Use as variáveis Supabase já existentes no `.env` do backend. A exportação PDF usa Chrome instalado no Windows, quando disponível, ou o navegador do Puppeteer. Para outro executável, configure `PUPPETEER_EXECUTABLE_PATH`.

```powershell
# Raiz
npm run build -- --configuration development
npm run test:planos

# backend/
npm run typecheck
npm test
```

A suíte específica Angular usa `tsconfig.planos.spec.json`, pois a suíte geral já contém um teste de alunos com Jasmine incompatível com a configuração Vitest. Os testes de backend usam um banco em memória, sem gravar dados no Supabase, e exercitam os modelos originais, versões, validações, isolamento por aluno, importação, geração binária e endpoints HTTP. O schema real e o SELECT dos vínculos do aluno foram conferidos em modo leitura.

Os critérios de PAEE foram equiparados aos de PEI com a confirmação do usuário, porque os itens do checklist não aparecem no PDF exportado do Trello.
