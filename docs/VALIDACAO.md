# Validação em Windows, iPhone e Raspberry Pi

Registre as versões exatas do Obsidian, PDF++, Fast Note Sync, Raspberry Pi OS e Tailscale antes de começar. Use um vault de teste se o fluxo ainda estiver em configuração.

## Implantação de teste no Pi

Em 24/11/2026, a imagem multi-stage foi compilada no Raspberry Pi ARMv7 e iniciada com Docker 26.1.5, Compose 2.26.1 e Tailscale 1.104.6. O teste usou o endpoint `/health` da origem privada na Tailnet. O Compose fica em `~/obsidian-library`, com um PDF sintético em `/srv/obsidian-library/books` e o índice em `/var/lib/obsidian-library`.

Um cliente no Windows recebeu HTTPS 200 em `/health`, no catálogo, no download completo e em `HEAD` do PDF. A requisição `Range: bytes=0-7` retornou 206 com `Content-Range: bytes 0-7/606` e o cabeçalho CORS para a origem de teste `capacitor://localhost`. O teste HTTP usou um cliente Node.js. O comportamento do WebView do Obsidian continua pendente.

A montagem dos livros estava somente para leitura. O container usava cerca de 1,35 MiB em repouso com um único livro. Os containers existentes de Uptime Kuma, Fast Note Sync, Pi-hole e Unbound reportavam estado saudável após a implantação. As rotas anteriores do Tailscale Serve em 443 e 8443 permaneceram ativas. A medição de carga com a biblioteca real segue pendente.

Na atualização 0.2.0, o build multi-stage com Poppler passou no Pi ARMv7. Pela Tailnet, o PDF de teste manteve o UUID anterior, retornou uma página extraída e serviu uma miniatura JPEG de 1.880 bytes com HTTP 200. A resposta parcial do PDF continuou retornando HTTP 206. O vinculo de pastas foi verificado em testes automatizados do plugin e aguarda confirmação no vault real.

| Teste | Procedimento e aceite | Estado |
| --- | --- | --- |
| A · PDF remoto | Grave uma única URL HTTPS em `Biblioteca/_refs/teste.pdf` e abra pelo PDF++ nos dois dispositivos. Navegue para páginas distantes em PDFs de 5, 50 e 200 MB, pelas redes local e remota. Confirme TLS e respostas HTTP 206. Registre a origem do WebView caso haja bloqueio CORS. | Pendente no ambiente real |
| B · Links | Crie links de página e seleção no Windows. Abra a nota no iPhone e confirme página e seleção. Repita com uma referência regenerada localmente se o Fast Note Sync excluir os dummies. | Pendente no ambiente real |
| C · Progresso | Confirme uma página, sincronize e retome pelo catálogo no outro dispositivo. Registre se a versão instalada do leitor expõe captura automática estável. | Fluxo manual implementado. Teste real pendente. |
| D · Sync e offline | Sincronize referências e Markdown de catálogo, notas e progresso. Faça confirmações diferentes com os aparelhos desconectados. Reconecte, escolha a página e confirme convergência. Verifique o envio de JSON pequeno para registrar o comportamento do Fast Note Sync. O catálogo do plugin usa Markdown. Confirme que os originais permaneceram no servidor. | Pendente no ambiente real |
| E · Raspberry Pi | Escaneie 100, 500 e 1.000 livros. Meça CPU, RAM e I/O enquanto os serviços existentes estão ativos. Renomeie um PDF, confira o mesmo ID e teste ausência controlada do HDD. O índice anterior e as notas devem permanecer. | Pendente no hardware real |

Teste também reinstalação, controles por toque, falha de conexão, arquivo removido, PDF++ desativado e abertura de uma nota renomeada. A abertura remota e os links entre dispositivos dependem da aprovação de A e B. Cópia seletiva offline e captura automática de página exigem validações próprias.

Para medir a abertura, registre separadamente o tempo do clique até a aba do PDF++ aparecer e até a página ficar visível. Repita o teste A na primeira abertura e na reabertura, tanto na página 1 quanto em uma página salva distante. Onde houver acesso às requisições do leitor, registre o status HTTP e quantos bytes foram transferidos até a página aparecer. Para a atualização automática com o catálogo já salvo e inalterado, confirme que o plugin consulta `/health` sem baixar as páginas de `/api/v1/books`.
