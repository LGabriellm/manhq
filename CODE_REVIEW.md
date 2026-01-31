# Code Review — manhq

## Visão geral
Este relatório foca em **robustez**, **segurança**, **performance** e possíveis **bugs** com base nos arquivos atuais do backend (Fastify + Prisma). Ele também sugere ajustes de design e observabilidade.

## Riscos e bugs potenciais (prioridade alta)

1. **JWT secret com fallback inseguro**
   - `AuthController` e `authMiddleware` usam valores padrão hard-coded quando `JWT_SECRET` não está definido. Isso permite que um ambiente mal configurado rode com segredo conhecido. **Sugestão:** falhar o boot caso `JWT_SECRET` não exista e remover defaults.
   - Arquivos: `src/controllers/AuthController.ts`, `src/middlewares/auth.ts`.

2. **`rateLimit` registrado depois das rotas**
   - O plugin é registrado após `app.register(appRoutes)`, o que pode não aplicar o rate limit às rotas já registradas (ordem importa no Fastify). **Sugestão:** registrar antes das rotas ou aplicar por routeOptions.
   - Arquivo: `src/server.ts`.

3. **`getPage` pode não responder em PDF**
   - Quando o PDF não é encontrado ou `pdfLib` é `null`, o handler não retorna resposta (request pendente). **Sugestão:** responder com 404/501 quando `pdfLib` não está disponível ou quando o índice não existe.
   - Arquivo: `src/controllers/ReaderController.ts`.

4. **`ScannerService` usa `upsert` com chave artificial "new"**
   - O `upsert` usa `id: 'new'` quando não encontra série existente. Isso não garante exclusividade e pode gerar comportamento estranho se o `id` coincidir (mesmo que improvável). **Sugestão:** criar índice único (`title`, `libraryId`) e usar `upsert` por chave composta.
   - Arquivo: `src/services/Scanner.ts`.

5. **`MetadataExtractor` parece usar `pdf-parse` com API incorreta**
   - A biblioteca `pdf-parse` é geralmente usada como função (`pdfParse(buffer)`), não como `new PDFParse(...)`. Isso pode gerar erro em runtime. **Sugestão:** validar a API ou trocar pelo uso padrão.
   - Arquivo: `src/utils/MetadataExtractor.ts`.

## Melhorias de segurança e robustez

1. **Validação e schemas Zod nas rotas restantes**
   - Apenas `/register` tem schema Zod. **Sugestão:** adicionar schemas em `/login`, `/read/:id/progress`, `/scan`, etc., para evitar `any` e dados malformados.

2. **Upload: validação de tipo e path traversal**
   - `data.filename` é usado diretamente para formar path temporário. **Sugestão:** normalizar/sanitizar nomes e validar extensões permitidas.
   - Arquivo: `src/controllers/UploadController.ts`.

3. **Upload: tratamento de erros do background**
   - O processamento background ignora o resultado do scanner e não atualiza status de processamento no banco. **Sugestão:** persistir status e permitir reprocessamento.

4. **JWT: melhor ergonomia e revogação**
   - Tokens de 7 dias sem refresh/revogação. **Sugestão:** usar refresh tokens e/ou invalidar tokens no logout ou troca de senha.

5. **CORS aberto para todas as origens**
   - `origin: true` permite qualquer origem. **Sugestão:** restringir via env para domínios confiáveis.

## Melhorias de performance

1. **Cache do Reader não tem limite de tamanho**
   - `structureCache` expira por tempo, mas pode crescer muito em bibliotecas grandes. **Sugestão:** implementar limite máximo (LRU) ou tamanho máximo de chaves.
   - Arquivo: `src/controllers/ReaderController.ts`.

2. **`countPages` usa `AdmZip` em arquivos grandes**
   - Ler e enumerar entradas grandes pode consumir RAM. **Sugestão:** streaming ou cache incremental no banco.

3. **`ScannerService` faz `findFirst` por arquivo em loop**
   - Em bibliotecas grandes, isso pode gerar muitas queries. **Sugestão:** listar paths existentes uma vez e comparar em memória, ou usar `findMany` por lote.

4. **`OptimizerService` converte tudo para WebP sem heurística**
   - Pode gerar custo de CPU alto. **Sugestão:** configurar qualidade e tamanho por env, ou evitar reconversão se já for WebP.

## Melhorias de observabilidade e manutenção

1. **Logs muito verbosos em produção**
   - `console.log` em Upload e Scanner podem expor dados sensíveis. **Sugestão:** usar logger do Fastify e níveis controlados por env.

2. **Erros do Prisma deveriam ser normalizados**
   - O `setErrorHandler` trata somente `P2025`. **Sugestão:** mapear erros comuns (e.g. `P2002` para conflito).

3. **Retornos inconsistentes**
   - Alguns endpoints retornam string simples, outros JSON. **Sugestão:** padronizar com `{ error, message }`.

## Sugestões de refatoração

1. **Centralizar config**
   - Mover `JWT_SECRET`, `rateLimit`, `bodyLimit` e diretórios (`library_data`, `temp`) para um módulo de config com validação de env.

2. **Separar domínio do controller**
   - Services já existem para Scanner/Optimizer, mas Library/Reader ainda executam lógica pesada. **Sugestão:** mover lógica de cache e leitura para serviços dedicados.

3. **Adicionar testes unitários**
   - O parser e metadata extractor são bons candidatos para testes isolados (regex + edge cases).

---

Se quiser, posso aplicar as correções sugeridas e criar um checklist de testes automatizados.
