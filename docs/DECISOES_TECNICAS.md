# Decisões técnicas do Obsidian Library

O plugin será escrito em TypeScript e o servidor em Go. O primeiro marco é uma prova de integração com o PDF++ e o Fast Note Sync em um iPhone real. O [PRD](PRD_Obsidian_Library.md) define os requisitos de produto.

## Plugin Obsidian

- **TypeScript em modo estrito, npm e esbuild**, a partir do template oficial do Obsidian. Usar `tsc --noEmit` para checagem, versionar o lockfile e gerar `main.js`, `manifest.json` e `styles.css` para instalação. O manifesto terá `isDesktopOnly: false`. A versão mínima do Obsidian será definida com as versões efetivamente validadas. [Template oficial](https://github.com/obsidianmd/obsidian-sample-plugin)
- **Interface com DOM nativo, `ItemView`, CSS Grid e variáveis do tema**, sem framework de UI. A biblioteca abre numa aba, em português do Brasil, com busca e filtros locais e renderização em lotes. Capas ausentes usam um placeholder. Percentuais só aparecem quando houver contagem confiável de páginas.
- **APIs públicas de Workspace, Vault e FileManager** para abas, arquivos e frontmatter. Usar `requestUrl` para a API de catálogo e deixar a leitura de PDFs com o PDF++. Manter a integração com o leitor isolada da lógica de catálogo e progresso. Evitar APIs de Node e Electron no código executado pelo plugin.

## Servidor Raspberry Pi

- **Go, biblioteca padrão e Docker Compose com build multi-stage.** A imagem final contém um binário estático e roda com usuário sem privilégios. Montar os livros somente para leitura e persistir o índice em um volume separado. O unit systemd fica disponível para implantação direta. Compilar para Linux ARMv7 com `GOOS=linux`, `GOARCH=arm`, `GOARM=7` e `CGO_ENABLED=0`. Usar `linux/arm64` se o sistema instalado for de 64 bits. [Alvos de compilação do Go](https://go.dev/doc/install/source) · [Build multiplataforma do Docker](https://docs.docker.com/build/building/multi-platform/)
- **Índice JSON versionado em disco**, com leitura em memória. Um scan por vez, iniciado no boot e executado periodicamente. Gravar o novo índice em arquivo temporário no mesmo diretório e publicar por renomeação após a varredura bem-sucedida. Falha ao acessar o HDD ou confirmar sua montagem preserva o catálogo anterior. Medir o índice com 100, 500 e 1.000 livros antes de considerar um banco.
- **UUID persistido no índice** e caminho relativo interno. Manter o ID quando a entrada continuar no mesmo caminho. Reconhecer renomeações quando houver correspondência única de hash completo entre um arquivo removido e um novo. Calcular hashes em segundo plano, com concorrência limitada, e reaproveitá-los enquanto tamanho e data de modificação forem consistentes. Se ainda faltar hash ou houver ambiguidade, preservar o registro antigo como indisponível e manter os vínculos. Incluir o índice no backup. No MVP, inferir título pelo nome do arquivo e categoria pela pasta pai. Autor e capa são opcionais.
- **API REST em `/api/v1`**, com `GET /health`, listagem paginada por cursor, detalhes por UUID e leitura por UUID. Invalidar o cursor quando o índice mudar durante a paginação. Servir PDF por `http.ServeContent` sobre arquivo aberto, com `Content-Type: application/pdf`, ETag e suporte a `Range`. Vincular o acesso ao diretório raiz, recusar escapes por symlinks e limitar leituras simultâneas. Publicar a API em HTTPS privado via Tailscale Serve, com o serviço escutando em loopback e acesso restrito pela política da Tailnet. [Go ServeContent](https://pkg.go.dev/net/http#ServeContent) · [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)

## Vault e sincronização

| Dados | Local e política |
| --- | --- |
| PDFs originais | HDD do Raspberry Pi. A abertura normal usa leitura remota. |
| Referências | `Biblioteca/_refs/<id>.pdf`, com uma única URL HTTPS, sem credenciais e dentro do limite da versão do PDF++. Se o Fast Note Sync excluir esses arquivos, testar a regeneração local no mesmo caminho a partir do catálogo sincronizado, inclusive sem acesso ao Pi. |
| Notas | `Biblioteca/Notas/<slug>-<id>.md`, identificadas por `bookId` no frontmatter. Localizar a nota existente por ID mesmo após renomeação. Criar uma vez e preservar o texto do usuário. |
| Catálogo offline | Snapshot versionado em Markdown com frontmatter em `Biblioteca/_state/catalogo.md`. Atualizar só após receber todas as páginas da mesma versão do índice. Preservar o último snapshot válido em falhas ou respostas incompletas. |
| Metadados pessoais | Markdown por livro em `Biblioteca/_state/livros/`, com título e categoria personalizados e separados do catálogo do servidor. |
| Configuração local | Endpoint e identificador do dispositivo. Validar que o identificador é distinto em cada aparelho e gerá-lo localmente se a configuração do plugin for copiada pelo sincronizador. |

O PDF++ documenta o recurso de PDF externo como experimental. A referência estável por ID mantém o destino dos links de página e seleção ao renomear livros. A compatibilidade dessa referência e do snapshot depende das regras reais do sincronizador. [PDF++ e PDFs externos](https://ryotaushio.github.io/obsidian-pdf-plus/external-pdf-files.html) · [Fast Note Sync](https://github.com/haierkeys/obsidian-fast-note-sync)

### Progresso e conflitos

Usar **registros Markdown imutáveis por atualização confirmada** em `Biblioteca/_state/progresso/<bookId>/<eventId>.md`. Cada registro tem página, estado de leitura, horário, aparelho e IDs dos registros anteriores que o aparelho conhecia. Esse formato é uma decisão em relação ao arquivo único por livro proposto pelo PRD. Um arquivo compartilhado pode perder uma edição concorrente no sincronizador antes que o plugin consiga detectar o conflito.

O plugin deduplica por ID e calcula a última atualização de cada linhagem. Quando dois aparelhos avançarem independentemente para páginas ou estados diferentes, exibe as alternativas. A escolha registra um novo evento que sucede ambos. Horário serve para exibição e ordenação de recentes. A captura automática requer validação no leitor e grava apenas após a página estabilizar. O fluxo manual permite confirmar a página e retomar por link de página quando o leitor aceitar. Se a navegação direta falhar, mostrar a página salva ao abrir o livro.

## Validação antes da implementação

1. **Abertura remota.** Criar uma referência PDF++ manual e abrir no Windows e no iPhone por HTTPS privado. Testar navegação para páginas distantes em PDFs de 5, 50 e 200 MB em rede local e remota. Conferir as respostas `206` e testar as exigências do visualizador para origem, CORS e cabeçalhos, mantendo o acesso restrito à Tailnet.
2. **Links, catálogo e sincronização.** Criar links reais de página e seleção no Windows e abri-los no iPhone. Testar sincronização dos arquivos Markdown e das referências, regeneração de referências se necessária, leitura do catálogo offline e duas edições de progresso feitas enquanto os aparelhos estiverem desconectados.
3. **Página ativa e retomada.** Medir a leitura da página ativa e a abertura na página salva nas versões instaladas. Se a captura automática for instável, usar confirmação manual no MVP.
4. **Carga no Raspberry Pi.** Medir RAM, CPU e I/O durante a indexação e a leitura simultânea, com os serviços existentes ativos. Verificar reindexação, renomeação e ausência temporária do HDD.

Registrar versões e resultados de A a E, conforme o PRD. Abertura remota e links entre dispositivos são condições de lançamento do MVP. Se falharem no iPhone, a cópia seletiva só entra como contingência de escopo, após validar que a pasta está excluída do Fast Note Sync. O modo offline do MVP cobre catálogo e notas.

## Estrutura e testes

Organizar o repositório em `plugin/` e `server/`. Usar Vitest para regras de estado, links e validação do contrato no cliente. Usar `go test` e `httptest` para persistência de IDs, renomeações, caminhos confinados, remoção do HDD e respostas parciais. Manter o teste no iPhone como aceite manual de release. Após a prova de integração, implementar nesta ordem: servidor, plugin de catálogo e notas, progresso sincronizado e empacotamento.
