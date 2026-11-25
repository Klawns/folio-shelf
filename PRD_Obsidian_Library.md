# PRD — Obsidian Library (nome provisório)

**Versão:** 1.0 (proposta de implementação)  
**Data:** 24/11/2026  
**Status:** Especificação para desenvolvimento — hipóteses e dependências explícitas  
**Alvo:** Obsidian Desktop (Windows) e Obsidian Mobile (iPhone/iOS)  
**Idioma da interface:** Português do Brasil  

## 1. Resumo executivo

Construir um **plugin do Obsidian** para catalogar, descobrir, abrir e acompanhar livros técnicos em **PDF** armazenados **fora do vault** em um servidor pessoal Raspberry Pi 3. O plugin reutilizará o **PDF++** para leitura, seleção, referências e anotações, mantendo as notas em Markdown no vault e utilizando a sincronização já existente do usuário, **Fast Note Sync**, para documentos e arquivos pequenos de metadados.

**Decisão arquitetural principal:** os PDFs originais **não são sincronizados junto ao cofre**. O plugin mantém um catálogo e pequenos arquivos locais de referência compatíveis com o recurso de **PDFs externos (“dummy PDF”)** do PDF++, apontando para URLs do servidor. Isso precisa de validação real no iPhone, sobretudo em rede remota, arquivos grandes e autenticação. Para contingência, permitir **importar temporariamente um livro para o vault** por ação explícita do usuário, evitando sincronização indevida desse PDF via Fast Note Sync.

O MVP não cria novo leitor PDF, não reimplementa recursos do PDF++, não altera o vault inteiro e não depende de Komga, Java ou banco de dados pesado.

## 2. Problema

O usuário estuda livros técnicos de programação, utiliza PDF++ no Obsidian e mantém anotações Markdown sincronizadas. A biblioteca está/ficará em um HD conectado ao Raspberry Pi; os livros devem permanecer fora do cofre, sem exigir copiar toda a coleção para cada dispositivo. Atualmente falta uma experiência única para navegar por capas/categorias, localizar um livro, continuar a leitura no PC e iPhone e relacioná-lo às notas existentes.

## 3. Objetivos e indicadores de sucesso

1. Abrir PDFs do Raspberry no PDF++ em Windows e iPhone, permanecendo no Obsidian.
2. Mostrar biblioteca visual, busca, filtros, status e **Continuar lendo**.
3. Criar e abrir a nota Markdown vinculada a cada livro sem interferir no fluxo de anotação do PDF++.
4. Sincronizar **catálogo e progresso** via arquivos pequenos do vault / Fast Note Sync, sem sincronizar os PDFs originais.
5. Priorizar leveza no Raspberry Pi 3 (1 GB RAM, ARMv7) que já executa outros serviços.
6. Funcionar sem rede para consultar catálogo/notas; indicar claramente que livros não armazenados localmente exigem conexão.

**Aceite mensurável:** importar uma pasta de ≥100 livros sem travar a interface; abrir PDF de teste no Windows e iPhone; retomar a página correta após sincronização; notas e links PDF++ persistirem ao alternar dispositivos; exclusão ou falha de rede não apagar notas; nenhuma transferência automática de PDFs pelo Fast Note Sync durante uso normal. Metas de latência e uso de memória serão medidas no hardware real, não presumidas.

## 4. Público e cenários de uso

**Usuário primário:** estudante/desenvolvedor que consulta livros de Java, APIs, Spring, arquitetura, redes e outras disciplinas.  
**Ambientes:** Windows + Obsidian Desktop, iPhone + Obsidian Mobile, Raspberry Pi 3 + HDD USB + Docker + Tailscale.  
**Fluxo A — estudo no computador:** abre a biblioteca, escolhe livro, visualiza PDF++ e uma nota Markdown lado a lado; usa seleção/referência do PDF++ e toma notas.  
**Fluxo B — retomar no iPhone:** abre a biblioteca, escolhe “Continuar lendo”, consulta o mesmo PDF via rede e acessa as mesmas notas sincronizadas.  
**Fluxo C — sem internet/Tailscale:** consulta catálogo e notas, mas recebe estado claro “Livro não disponível offline”; se tiver importado cópia local, pode abri-la.  
**Fluxo D — novos livros:** adiciona arquivo ao diretório do Raspberry; após reindexação, capa/título aparecem na biblioteca.

## 5. Escopo

### 5.1 MVP obrigatório (P0)
- Painel/biblioteca dentro do Obsidian, em aba própria e comando/ribbon.
- Listagem em grade de cartões, busca textual, categorias, status, recentes e progresso.
- Configuração de um endpoint HTTPS do servidor e teste de conexão.
- Catálogo remoto de PDFs com ID persistente, título, autor opcional, categoria, capa opcional, tamanho, hash/ETag e URL de leitura.
- Criação automatizada de referências `.pdf` leves (PDF++ dummy files) no vault, com URL de origem; armazenamento em pasta dedicada e sincronizada, sujeito ao teste de compatibilidade.
- Abertura dos arquivos de referência pelo leitor nativo/PDF++.
- Notas Markdown vinculadas por livro com template e navegação bidirecional (livro → nota; nota → livro).
- Progresso: **última página confirmada**, data e dispositivo; sincronização via pequeno arquivo Markdown/JSON no vault; consistência e resolução explícita de conflitos.
- Estados de carregamento, não encontrado, sem acesso, offline, PDF incompatível, PDF++ desativado.
- Segurança mínima: biblioteca privada via Tailscale HTTPS ou endpoint privado equivalente; diretórios de livros somente leitura; validação estrita de paths.

### 5.2 Pós-MVP (P1)
- Download local **seletivo** por livro para leitura offline (com regras de exclusão do Fast Note Sync).
- Capas geradas no servidor e thumbnails cacheadas com limite.
- Favoritos, coleções, tags e ordenações avançadas.
- Indicador de leitura por percentagem quando número de páginas puder ser obtido com confiabilidade.
- Importação/atualização incremental e detecção de renomeações por hash/ID.
- Atalho de contexto no PDF++ para “Abrir nota do livro”, se a extensão for estável.

### 5.3 Futuro (P2)
- EPUB, **dependente de escolha e verificação de leitor EPUB separado**. Não atribuir ao PDF++ suporte a EPUB.
- Busca no conteúdo de PDFs com texto selecionável, se indexação leve for viável.
- Exportação de índice de destaques, estatísticas de leitura, OCR opt-in (fora do Pi 3, preferencialmente).

### 5.4 Fora do escopo
- Substituir PDF++, editar os PDFs originais, reescrever highlights do PDF++ ou sincronizar PDFs grandes por padrão.
- Edição colaborativa em tempo real, DRM, servidor público na internet, e-book store, recomendação por IA.
- Prometer sincronização de rolagem exata sem teste: o marco estável inicial é **página**, com zoom/posição como melhoria condicional.

## 6. Arquitetura

```text
Raspberry Pi 3 (ARMv7, HDD USB)
  /srv/biblioteca/livros/       PDFs originais (read-only)
  /srv/obsidian-library/        pequeno serviço de catálogo + arquivo de índices
  HTTPS privado (Tailscale Serve / proxy local)
         │ catálogo JSON + URL privada de PDF
         ▼
Obsidian Plugin (Windows/iPhone)
  ├─ Painel biblioteca, filtros, estado, nota vinculada
  ├─ PDF++ -> referência .pdf pequena -> PDF remoto no Raspberry
  └─ Vault:
       Biblioteca/_refs/<book-id>.pdf  (arquivo texto URL, não PDF binário)
       Biblioteca/_state/<book-id>.md (estado sincronizável)
       Biblioteca/Notas/<slug>.md     (notas humanas)
       Biblioteca/catalogo.json      (snapshot sincronizável, se compatível)
                │
                ▼
        Fast Note Sync existente
        (sincroniza notas e metadados, não originais)
```

### 6.1 Servidor de catálogo (leve, separado do plugin)
**Proposta:** serviço HTTP pequeno, preferencialmente Go compilado para ARMv7 ou Python com dependências mínimas, executável como container ARMv7 ou serviço systemd. **Não presumir imagem Docker multiarch disponível** antes do teste. Sem Redis, PostgreSQL, Java ou indexação pesada.

Endpoints propostos:
- `GET /health` -> status e versão.
- `GET /api/v1/books?cursor=&q=&category=` -> catálogo paginado.
- `GET /api/v1/books/{id}` -> metadados.
- `GET /api/v1/books/{id}/file` -> resposta `application/pdf` com `Content-Length`, **HTTP Range** (`206 Partial Content`, `Accept-Ranges: bytes`) e ETag; somente leitura.
- `GET /api/v1/books/{id}/cover` -> miniatura se disponível; fallback no cliente.
- `POST /api/v1/admin/rescan` -> reindexação protegida; apenas se necessário, preferir varredura agendada leve.

**Identidade estável:** `bookId` derivado de UUID persistido no catálogo; não usar o caminho como ID. Guardar caminho relativo interno (nunca aceitar caminhos arbitrários do cliente), checksum opcional calculado sob demanda e `mtime/size` para reindexação incremental. Pasta não navegável fora da biblioteca configurada. Bloquear `..`, symlinks para fora da raiz, traversal e upload/alteração dos livros.

**Catálogo:** exportação de título a partir de metadata PDF quando disponível; fallback nome do arquivo. Categoria inicial pela pasta pai, editável no cliente como metadado pessoal. Não exigir extração de texto nem gerar thumbnails no primeiro scan.

### 6.2 Acesso e autenticação
- Padrão: endpoint privado no Tailnet, com HTTPS confiável por Tailscale Serve ou proxy aprovado, sem exposição pública e sem necessidade de abrir portas.
- O **PDF dummy do PDF++ aponta diretamente à URL**; por isso, **não é seguro presumir que ele envie cabeçalhos Authorization personalizados**. Não usar um bearer token secreto embutido em URLs sincronizadas.
- MVP: só aceitar leitura remota se o endereço for acessível pela rede privada e a política de acesso puder ser validada em Windows **e iPhone**. Testar requisitos reais de sessão, cookies e acesso do PDF.js.
- Se o acesso ao PDF falhar no iPhone por política de autenticação, TLS, cache ou Tailscale, usar **fallback de importação local seletiva**; não remover proteção para “fazer funcionar”.
- Configurações secretas, se houver, ficam por dispositivo e nunca dentro de arquivos sincronizados nem logs.

### 6.3 Integração com PDF++
**Caminho preferido:** recurso documentado pelo PDF++ de “external PDF files”/`dummy PDF`: arquivo `.pdf` pequeno contendo apenas URL HTTPS. O PDF++ usa o leitor PDF do Obsidian para renderizar essa referência e permite links a páginas/seleções, com restrições de edição. Esses arquivos especiais são **dependentes do PDF++**; outros leitores os interpretarão como PDF inválido.

**Requisitos:**
- Gerar uma referência por livro com nome baseado no ID para que o caminho interno permaneça estável.
- Verificar se o PDF++ está instalado/ativado e se o mecanismo funciona no iOS real.
- Não chamar APIs internas de `PDFView` sem verificação de versão e fallback.
- Eventualmente usar o evento `pdf-menu` e helpers documentados no wiki de desenvolvedores para UX adicional; tratá-los como integração de risco médio, não contrato estável.
- O modo de anotação **por backlinks Markdown** deve ser priorizado: não alterar original remoto. Escrita de anotação dentro do PDF remoto fica desabilitada.
- Abrir em nova aba com Obsidian Workspace API; permitir opção “Abrir nota ao lado” no desktop, sem impor layout lado a lado no mobile.

### 6.4 Fast Note Sync e esquema de arquivos
- Presumir **Fast Note Sync já instalado/configurado**; não instalar outro sincronizador.
- O Fast Note Sync informa sincronização de notas/anexos, exclusões e compatibilidade iOS; **confirmar em teste** se os arquivos `.pdf` de referência (texto) e `.json` pequenos são incluídos nas regras atuais.
- Preferir metadados em **Markdown com YAML frontmatter** quando JSON não for incluído pela configuração atual; usar API `FileManager.processFrontMatter` e `Vault.process` para escrita.
- Progresso por livro em `Biblioteca/_state/<id>.md` com `bookId`, página, total opcional, `updatedAt` ISO UTC, `deviceId` e `revision`. Data do dispositivo não é fonte perfeita de ordenação; tratar divergências e oferecer escolha.
- Debounce para registrar página somente após estabilidade; flush ao fechar documento e ao perder foco quando possível, evitando regravações por scroll.
- Não alterar regras de exclusão do Fast Note Sync automaticamente.
- **Cópias binárias offline** em pasta explicitamente excluída da sincronização, ou em cache local privado do plugin se implementável no iOS. Validar o comportamento antes de lançar esta função.

## 7. Especificação visual e de UX

### 7.1 Direção de design
- Visual nativo do Obsidian, minimalista e sofisticado; seguir tema claro/escuro e variáveis CSS (`--background-primary`, `--text-normal`, `--interactive-accent` etc.).
- Biblioteca em **grade de capas**, como protótipo já aprovado na conversa: foco na capa, título, formato, progresso e botão de continuidade.
- Cor de destaque derivada do tema Obsidian (não fixar roxo); bordas discretas, ícones Lucide/Obsidian, tipografia padrão, poucos ornamentos.
- Sem CSS global invasivo: prefixar classes `.ol-*`; acessibilidade e navegação por teclado.

### 7.2 Layout desktop (aba principal)

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│  Biblioteca                                   [Atualizar] [⚙ Configurações] │
│  Seus livros técnicos — 128 livros                                        │
│                                                                             │
│  [🔍 Buscar título ou autor.................................] [Ordenar ▼] │
│  [Todos] [Lendo] [Não iniciados] [Concluídos]  [Categoria ▼]             │
│                                                                             │
│  Continuar lendo                                                            │
│  ┌──────────────────────────┐                                               │
│  │ Capa   Learning API...   │  [Continuar na página 29] [Abrir notas]     │
│  │        PDF · 7%          │                                               │
│  └──────────────────────────┘                                               │
│                                                                             │
│  Biblioteca                                                                 │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐          │
│  │   CAPA     │  │   CAPA     │  │   CAPA     │  │   CAPA     │          │
│  │ Clean Code │  │ Spring ... │  │ API Styles │  │ Networks   │          │
│  │ PDF · 42%  │  │ PDF · novo │  │ PDF · 7%   │  │ PDF · novo │          │
│  │ ▰▰▰▰▱▱▱▱  │  │ ▱▱▱▱▱▱▱▱  │  │ ▰▱▱▱▱▱▱▱  │  │ ▱▱▱▱▱▱▱▱  │          │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘          │
│                                                                             │
│  ● Conectado ao servidor                   Sincronização de notas externa  │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Cartão:** capa/fallback com iniciais, nome até duas linhas, autor opcional, badge “PDF”, barra de progresso, status disponível/indisponível, menu de três pontos. Clique abre livro; menu: Continuar, Abrir notas, Ver detalhes, Marcar concluído, Copiar link, Atualizar metadados. Não exibir ações inoperantes.

**Barra lateral:** vista compacta opcional “Recentes”, com lista de 5–10 livros e progresso, acionada por ícone ribbon. A grade completa abre em aba.

### 7.3 Detalhes do livro
- Título, autor, capa, formato, tamanho, categoria, último acesso, progresso, estado de conexão.
- Ações primárias: **Continuar lendo** e **Abrir notas**; secundárias: abrir página inicial, editar título/categoria, copiar referência, marcar concluído.
- Indicador “Livro no Raspberry Pi — disponível online”; em caso de fallback local, mostrar origem da cópia e espaço ocupado.
- Mini-histórico simples (última página e atualização); não rastrear tempo de leitura no MVP.

### 7.4 Leitura e anotações
**Desktop:** ao clicar “Estudar”, abrir o PDF++ à esquerda e a nota Markdown à direita (configurável); PDF++ mantém seus menus e atalhos originais. A seleção de texto com o PDF++ continua sendo o mecanismo recomendado de destaques/referências.  
**iPhone:** abrir PDF++ na tela inteira e oferecer comandos separados “Voltar à biblioteca”, “Abrir notas” e “Continuar”; não tentar impor split view.  
**Nota por livro:** arquivo Markdown em `Biblioteca/Notas/<slug>.md`, com frontmatter `bookId`, título, autor, tags, caminho da referência, e seções opcionais “Resumo”, “Conceitos”, “Exemplos de código”, “Dúvidas” e “Referências”; nunca sobrescrever conteúdo humano após criação.

### 7.5 Estados e mensagens
- Inicial sem servidor: “Conecte sua biblioteca do Raspberry Pi” + botão Configurar.
- Offline: “Servidor indisponível. Suas notas continuam acessíveis.”
- Sem PDF++: “Ative o PDF++ para abrir referências externas” + link para instruções.
- Falha de PDF remoto: “Não foi possível carregar este PDF do servidor” + Testar conexão + Importar cópia local (apenas quando recurso P1 habilitado).
- Sem resultados: “Nenhum livro corresponde à busca”.
- Arquivo removido: “Livro não encontrado no servidor” sem excluir notas/referências.
- Sync divergente: aviso com valores “Este aparelho: pág. 33 / Outro: pág. 29”, permitindo escolher qual manter.

### 7.6 Responsividade e acessibilidade
- Desktop: grade de 3–5 colunas conforme largura disponível; tablet 2–3; iPhone 1–2 colunas.
- Toques-alvo adequados no iOS; labels legíveis, contraste WCAG AA quando possível, estados foco/hover/pressed, `aria-label` em controles, suporte redução de movimento.
- Virtualização/paginação para bibliotecas grandes. Não renderizar todos os cartões e imagens em paralelo.

## 8. Requisitos funcionais rastreáveis

| ID | Prioridade | Requisito | Critério de aceite |
|---|---|---|---|
| RF-01 | P0 | Adicionar URL privada da biblioteca | Teste de conexão mostra servidor/erro detalhado |
| RF-02 | P0 | Indexação e listagem | Livro novo aparece após reindexação sem duplicação |
| RF-03 | P0 | Pesquisa e filtros | Busca título/autor, filtra categoria/status |
| RF-04 | P0 | Cartão de livro | Capa/fallback, título, PDF e progresso visíveis |
| RF-05 | P0 | Abrir pelo PDF++ | PDF remoto abre via referência em Windows |
| RF-06 | P0 | Verificar iOS | Mesmo fluxo funcional em dispositivo real; registrar limitações |
| RF-07 | P0 | Criar nota por livro | Nota é criada uma só vez e editável normalmente |
| RF-08 | P0 | Referências PDF++ | Link de página/seleção abre o arquivo de referência e página |
| RF-09 | P0 | Salvar progresso | Última página registrada e sincronizada |
| RF-10 | P0 | Retomar leitura | Abre na página salva quando API permitir; fallback abrir livro e indicar página |
| RF-11 | P0 | Offline e erro | Interface não trava; não elimina dados |
| RF-12 | P0 | Sem PDFs originais no cofre | Inspeção mostra apenas arquivos de referência pequenos |
| RF-13 | P0 | Segurança de acesso | API só lista/lê arquivos na raiz permitida, sem escrita |
| RF-14 | P1 | Baixar PDF selecionado | Usuário controla importação e pode removê-la sem perder notas |
| RF-15 | P1 | Capas | Não bloqueia carregamento se não existirem |
| RF-16 | P2 | EPUB | Só após validação do plugin leitor escolhido |

## 9. Modelo de dados (contrato inicial)

**Book (servidor):** `id`, `title`, `author?`, `category`, `format: 'pdf'`, `sizeBytes`, `lastModified`, `etag`, `pageCount?`, `coverUrl?`, `readUrl` (somente URL privada HTTPS), `availability`.

**Progress (arquivo por livro, no vault):** `bookId`, `page`, `pageCount?`, `updatedAt`, `deviceId`, `revision`, `completed?`, `source='obsidian-library'`. Evitar armazenar offsets internos PDF.js como único estado. **A leitura da página ativa pelo Obsidian/PDF++ pode requerer APIs internas instáveis**: desenvolver adapter de compatibilidade e expor fallback de atualização manual de página caso não funcione.

**PersonalMetadata (no vault):** `bookId`, `customTitle?`, `customCategory?`, `favorite`, `notePath`, `refPath`.

**Regras:** nunca usar título como chave; preservar ID quando arquivo for renomeado/movido; jamais excluir notas ao remover livro; desduplicar eventos; atualizar progresso com escrita atômica quando possível; nenhum dado pessoal enviado a serviços de terceiros.

## 10. Desempenho e qualidade

- Server ARMv7 e RAM 1 GB: leitura de catálogo paginada, scan limitado, cache pequeno, sem processamento de OCR, thumbnails opcionais.
- Servir PDF em streaming com suporte a `Range`; evitar buffering do PDF inteiro na RAM do Raspberry.
- Índice em JSON/SQLite leve; optar após benchmark real; catálogo de leitura pronto para iPhone via HTTPS.
- Plugin com carregamento adiado após `workspace.onLayoutReady`; sem trabalho pesado no `onload`.
- Requisições de API com `requestUrl` do Obsidian quando fizer sentido, mas o **leitor PDF remoto é outra pilha de carregamento**: testar end-to-end em vez de assumir que `requestUrl` controla o PDF++.
- Limites iniciais para teste: 100, 500, 1000 PDFs; arquivos de 5, 50, 200 MB; Wi-Fi local e Tailnet remota.

## 11. Segurança, privacidade e recuperação

- Acesso somente pela rede privada; sem exposição pública aberta, sem tokens em URL persistente, sem credenciais em Markdown ou nome de arquivo.
- HTTPS validado em desktop e iOS; se cert não for confiável, informar erro, não desabilitar validação TLS.
- Biblioteca original read-only; logs sem conteúdo de livros, dados pessoais ou URLs sensíveis.
- Proteção contra path traversal, symlink escape, mass download abusivo e path injection.
- Não modificar arquivos de configuração de PDF++ ou Fast Note Sync automaticamente.
- Backup de notas/progresso junto ao cofre existente e do índice do servidor separadamente.
- Falhas durante rescan não destroem o índice anterior; remoção de livro marca indisponível em vez de excluir referência/nota silenciosamente.

## 12. Plano de validação técnica (spikes obrigatórios antes de codificar tudo)

**Spike A — PDF remoto:** criar manualmente `Biblioteca/_refs/teste.pdf` com uma URL HTTPS estável da Tailnet; confirmar abrir e navegar em Windows e iPhone, incluindo páginas aleatórias e HTTP range. **Bloqueador de lançamento** se falhar no iPhone.

**Spike B — PDF++ e links:** gerar link Markdown para a seleção e a página do PDF externo no Windows; sincronizar nota e dummy pelo Fast Note Sync; abrir o mesmo link no iPhone. Verificar sintaxe de links gerados pelo próprio PDF++.

**Spike C — progresso:** medir como detectar page change e abrir em página N nas versões instaladas do Obsidian/PDF++, desktop e iOS. Se API instável, limitar P0 a “última página manual / último link de posição” e não anunciar progresso automático.

**Spike D — Fast Note Sync:** testar sincronização de arquivos `.pdf` de texto, `.md` e `.json` nas regras configuradas, além de conflitos de estado e tamanho máximo de anexos. Confirmar não transferir PDFs originais.

**Spike E — Pi 3:** rodar servidor mínimo, escanear biblioteca e abrir PDF no iPhone enquanto Pi-hole/Unbound/Syncthing/Uptime Kuma seguem responsivos; medir RAM, CPU e I/O.

**Gate:** se A/B falharem por limitação do PDF++ no iOS, oferecer fallback P1 (importação de PDF local por livro com exclusão explícita da sincronização) e documentar que “100% remoto sem cópia” não foi atingido; nunca mascarar o desvio do requisito.

## 13. Testes e critérios de aceite final

1. Windows e iPhone com Obsidian, PDF++ e Fast Note Sync instalados.
2. Livro remoto abre pelo PDF++ em ambos e mostra conteúdo legível, inclusive código/diagramas.
3. Seleção gera referência Markdown; ao clicar no outro dispositivo, retorna ao PDF/página correta.
4. Página/progresso atualizado no Windows surge no iPhone após a sincronização, com conflito tratado explicitamente.
5. Interrupção da internet mostra erro explicativo e não corrompe metadados/notas.
6. Biblioteca continua utilizável com 100+ livros; não interfere no DNS e nos demais containers.
7. Ao examinar o vault, não há PDFs binários originais involuntários.
8. Atualizar ou reinstalar plugin preserva todas as notas/IDs/referências.
9. Renomear um livro no servidor não quebra associações quando o índice reconhece o mesmo ID.
10. No iPhone, todos os controles funcionam por toque, sem hover obrigatório.

## 14. Marcos de entrega

**M0 — PoC de integração:** validar PDF externo, iPhone, Fast Note Sync, links e progresso. Entregável: relatório de compatibilidade e decisão go/no-go.  
**M1 — Servidor:** catálogo leve, leitura Range, metadados, configuração de rede privada.  
**M2 — Plugin:** biblioteca visual, busca/filtros, geração de referências, abertura PDF++, notas.  
**M3 — Sync de progresso:** arquivos por livro, retomada, conflitos e compatibilidade mobile.  
**M4 — Robustez:** erros/offline, testes de carga, backup, documentação e empacotamento de plugin.  
**M5 — Opcional:** download seletivo, capas, favoritos.

## 15. Entregáveis do agente implementador

- Repositório de código com `plugin/` (TypeScript), `server/` (serviço ARMv7), `docs/` e exemplos de configuração.
- `manifest.json`, `styles.css`, bundle `main.js`, instruções de instalação no Obsidian Mobile.
- `docker-compose.yml` ARMv7 **com imagem efetivamente validada** ou unit systemd equivalente; volume da biblioteca `:ro`.
- `.env.example` sem credenciais; configuração de root da biblioteca e endpoint.
- README para configurar Tailscale HTTPS, escanear pasta, adicionar livros e recuperar erros.
- Testes unitários para catálogo, IDs, segurança de caminhos, links, conflito; testes de integração e checklist manual iOS.
- Relatório de spikes com versões exatas de Obsidian/PDF++/Fast Note Sync utilizadas.
- Nenhuma migração destrutiva do cofre existente.

## 16. Premissas, riscos e decisões pendentes

### Confirmado pelo usuário
- Deseja **plugin dentro do Obsidian**, não PWA externa.
- Quer reutilizar o **PDF++**, já familiar.
- Livros técnicos, principalmente PDF; EPUB pode ser previsto para depois.
- PDFs originais no **Raspberry Pi fora do cofre**.
- Notas sincronizadas com **Fast Note Sync** já em uso.
- Desktop Windows + iPhone; biblioteca visual em cartões aprovada.

### Premissas propostas (reversíveis)
- Diretório de livros em `/srv/biblioteca/livros/` (ajustável).
- Recurso dummy PDF do PDF++ para referências a PDFs remotos.
- Acesso somente via Tailnet e TLS; endereço final ainda não definido.
- Catálogo de leitura rodando como serviço leve no Raspberry; sem API de edição de PDFs.
- Notas em `Biblioteca/Notas/` e arquivos de referência/estado em pastas ocultáveis dentro do vault.
- Progresso automático em página, condicionado ao spike C.

### Perguntas não bloqueantes, para confirmar na implantação
1. Qual a pasta real dos livros no HDD do Raspberry (não precisa responder para começar a PoC)?
2. Fast Note Sync sincroniza atualmente PDFs/anexos? Há regras de exclusão/tamanho? É importante para separar referências pequenas de cópias offline.
3. O Tailscale está instalado e conectado também no iPhone, ou só no servidor/PC?
4. No iPhone, precisa ler **sem internet** ou somente com acesso remoto?
5. Seu fluxo PDF++ utiliza backlinks Markdown (preferido) ou marcações gravadas diretamente no PDF? PDFs externos são tratados como leitura somente.

### Riscos principais
- **R1 alto:** URL de PDF externo funcionar no PDF++ desktop mas não no iOS; mitigação PoC antes de implementar UI.
- **R2 alto:** URL protegida necessitar headers/cookies que o mecanismo de dummy PDF não envia; resolver por acesso Tailnet privado ou fallback sem vazar token.
- **R3 médio:** APIs internas PDF++ mudarem e quebrarem rastreamento automático de página; usar adapter de versão e fallback explícito.
- **R4 médio:** FNS sincronizar referências `.pdf` de forma diferente de Markdown/JSON; validar whitelist/exclusion antes.
- **R5 médio:** conflitos de progresso entre aparelhos offline; não sobrescrever sem regra clara.
- **R6 médio:** múltiplos serviços no Pi 3 + HDD USB; reduzir scans, thumbnails e concorrência.

## 17. Referências verificadas em 24/11/2026

- PDF++: arquivos PDF externos (“dummy PDF”), comportamento read-only, importação: https://ryotaushio.github.io/obsidian-pdf-plus/external-pdf-files.html
- PDF++: wiki para desenvolvedores, `pdfPlus.lib` e evento `pdf-menu`: https://github.com/RyotaUshio/obsidian-pdf-plus/wiki/For-developers
- PDF++: repositório e funcionamento com o leitor PDF do Obsidian: https://github.com/RyotaUshio/obsidian-pdf-plus
- Fast Note Sync: README, sync iOS/anexos/exclusões e ressalvas sobre arquivos grandes: https://github.com/haierkeys/obsidian-fast-note-sync
- Obsidian: checklist oficial de API, `requestUrl`, Vault, mobile e CSS: https://docs.obsidian.md/oo/plugin
- Obsidian: desenvolvimento mobile: https://docs.obsidian.md/Plugins/Getting%20started/Mobile%20development

**Princípio de implementação:** os links oficiais comprovam que os recursos de referência externa e sincronização existem; **não comprovam que a combinação completa funciona no aparelho específico do usuário**. Isso é objetivo explícito dos spikes e critérios de aceite.
