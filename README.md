# Pascom Face Live Comments

Extensão de navegador (Manifest V3) que captura em tempo real os comentários exibidos no painel lateral de uma live do Facebook, permitindo exportá-los ou encaminhá-los para um app externo.

## Funcionalidades

- Captura automática dos comentários do painel de comentários de uma live do Facebook (`https://www.facebook.com/*`).
- Persistência local dos comentários capturados via `chrome.storage.local`.
- Encaminhamento em tempo real de cada comentário para um app externo (bridge HTTP).
- Popup de controle com:
  - Interruptor para ativar/desativar a captura.
  - Lista de URLs permitidas (a extensão só atua nas páginas cadastradas).
  - Visualização dos comentários capturados na sessão.
  - Exportação dos comentários em JSON ou CSV.
  - Limpeza dos comentários armazenados.

## Estrutura do projeto

| Arquivo         | Responsabilidade                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| `manifest.json` | Configuração da extensão (Manifest V3), permissões e registro dos scripts.                                  |
| `content.js`    | Roda na página do Facebook. Localiza o painel de comentários, extrai autor/mensagem e envia para o background. |
| `background.js` | Service worker. Persiste os comentários recebidos e os repassa (via `fetch`) para o app externo (bridge).   |
| `popup.html`    | Interface do popup da extensão.                                                                             |
| `popup.js`      | Lógica do popup: configuração de URLs permitidas, listagem, exportação e limpeza dos comentários.           |
| `icons/`        | Ícones da extensão (16, 48 e 128px).                                                                        |

## Como funciona a captura

1. O `content.js` procura o painel de comentários da live via `div[role="complementary"]`, reforçando a busca com um conjunto de classes conhecidas do Facebook (que podem mudar sem aviso a cada deploy deles).
2. Cada comentário é identificado por conter as ações "Curtir" e "Responder", o que o distingue de outros elementos com `role="article"` (como reações ou cards de link).
3. Um hash do texto do comentário é usado para evitar duplicidade quando o painel é recriado (ex: ao desativar/reativar a captura ou navegar via SPA), mantendo um número sequencial estável por comentário.
4. Cada novo comentário é enviado ao `background.js`, que:
   - salva no `chrome.storage.local`;
   - envia via `fetch` (POST) para o app bridge configurado.

## Configuração de URLs permitidas

A extensão só captura comentários nas páginas cuja URL (hostname + pathname exatos) esteja cadastrada no popup. Isso é proposital: o Facebook exibe a mesma live sob URLs diferentes (ex: `.../suapagina/videos/123456` vs `.../watch/live/?v=123456`), e cada uma tem uma estrutura de DOM diferente — misturar as duas causa captura incorreta.

Use o botão **"Aba atual"** no popup para cadastrar rapidamente a URL da aba aberta.

## Integração com app externo (bridge)

O `background.js` encaminha cada comentário capturado, em tempo real, para:

```
http://localhost:3000/api/live-comments
```

Esse endereço está definido na constante `BRIDGE_URL` em `background.js`. Para apontar para um ambiente de produção:

1. Atualize `BRIDGE_URL` em `background.js`.
2. Adicione o novo domínio em `host_permissions` no `manifest.json`.

Caso o app bridge esteja indisponível, o `fetch` falha silenciosamente e a captura/armazenamento local continuam funcionando normalmente.

## Instalação (modo desenvolvedor)

1. Abra `chrome://extensions` (ou equivalente no navegador baseado em Chromium).
2. Ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione a pasta deste projeto.
4. Abra o popup da extensão, cadastre a URL da live do Facebook e ative a captura.

## Permissões utilizadas

- `storage`: persistir comentários e configurações localmente.
- `activeTab` / `scripting`: interagir com a aba ativa.
- `downloads`: exportar comentários em JSON/CSV.
- `host_permissions`: acesso ao Facebook e ao app bridge local.
