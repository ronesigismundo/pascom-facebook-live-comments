// Content script: captura comentários dentro do painel lateral da live do Facebook.

// Classes atômicas geradas pelo Facebook — mudam sem aviso a cada deploy deles.
// Por isso o seletor prioriza o atributo semântico role="complementary" e usa
// as classes apenas como reforço opcional. Se a captura parar de funcionar,
// ajuste PANEL_CLASSES conforme o novo markup.
const PANEL_CLASSES = [
  "x2bj2ny",
  "x78zum5",
  "x2lah0s",
  "x1t2pt76",
  "x1n2onr6",
  "x1cvmir6",
];

const MAX_SEEN = 5000; // limite para não deixar o Map crescer indefinidamente
// hash do comentário -> número sequencial. Nunca é limpo durante a vida da
// página (só num reload de verdade, ver CLEAR_COMMENTS no fim do arquivo):
// evita reenviar pro storage um comentário já persistido quando o painel é
// recriado (ex: ao desativar/reativar ou navegar pra fora e voltar via SPA),
// e mantém o número de cada comentário estável entre essas reconexões.
const commentSequence = new Map();
let sequenceCounter = 0;
let observer = null;
let panelEl = null;

function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return hash;
}

function findPanel() {
  const candidates = document.querySelectorAll('div[role="complementary"]');
  for (const el of candidates) {
    const classList = el.className.split(/\s+/);
    const matches = PANEL_CLASSES.filter((c) => classList.includes(c)).length;
    if (matches >= PANEL_CLASSES.length - 1) {
      return el;
    }
  }
  // Fallback: aceita o primeiro complementary encontrado se nenhum bater nas classes
  return candidates[0] || null;
}

// Um comentário de verdade sempre tem as ações "Curtir" e "Responder" — isso
// distingue um comentário da barra de reações do post ou do card de link
// compartilhado, que também acabam caindo num role="article" genérico.
//
// Usamos textContent (não innerText) em todo este arquivo: innerText depende
// da renderização/layout do elemento, e como escondemos os comentários
// nativos com display:none (ver hideNativeComments), innerText passa a
// retornar tudo colado sem quebra de linha nenhuma. textContent não sofre
// desse problema. Por isso também extraímos autor e mensagem lendo
// diretamente os elementos estruturais do comentário (os mesmos usados nos
// seletores de CSS de legibilidade), em vez de tentar separar por linha um
// texto corrido.
function isCommentNode(el) {
  const text = el.textContent || "";
  return text.includes("Responder") && text.includes("Curtir");
}

function queryIncludingSelf(root, selector) {
  const results = Array.from(root.querySelectorAll(selector));
  if (root.matches?.(selector)) results.unshift(root);
  return results;
}

function extractCommentUnits(root) {
  const candidates = queryIncludingSelf(root, '[role="article"]').filter(
    isCommentNode,
  );
  // Respostas a comentários também têm role="article", ficando aninhadas
  // dentro do comentário pai. Mantemos apenas o nó mais interno (a folha)
  // para não duplicar o texto do pai junto com o da resposta.
  return candidates.filter(
    (el) => !candidates.some((other) => other !== el && el.contains(other)),
  );
}

// O nome do autor está sempre dentro de um <a role="link">; o corpo da
// mensagem está sempre num span com atributo lang (Facebook detecta o
// idioma do comentário) — mesmos sinais estruturais usados no CSS.
function parseComment(node) {
  const authorEl = node.querySelector('a[role="link"] span.x1nxh6w3');
  const messageEl = node.querySelector("span.x6prxxf[lang]");

  const author = authorEl?.textContent?.trim() || "";
  const message = messageEl?.textContent?.trim() || "";
  return { author, message };
}

// Tentamos anteriormente ler o horário real do Facebook simulando hover
// sobre o texto relativo ("21 min") pra capturar o tooltip com a data
// completa. Não funciona: o tooltip do Facebook é ativado por estado real
// de :hover do navegador (ou eventos de ponteiro confiáveis), e eventos de
// mouse disparados via JavaScript não colocam o navegador nesse estado —
// só movimento de mouse genuíno do usuário faz isso. Como não dá pra
// confiar nem no horário local (não reflete quando o comentário foi
// postado de verdade), usamos um contador sequencial simples (#1, #2, ...)
// que reflete a ordem de captura.
function captureComment(node) {
  const { author, message } = parseComment(node);
  if (!message) {
    console.info(
      "[pascom-face-live-comments] sem elemento de mensagem, ignorado",
      node,
    );
    return;
  }

  const rawText = `${author}: ${message}`;
  const hash = hashText(rawText);

  let sequence = commentSequence.get(hash);
  const isNew = sequence === undefined;

  if (isNew) {
    sequence = ++sequenceCounter;
    commentSequence.set(hash, sequence);
    if (commentSequence.size > MAX_SEEN) {
      const first = commentSequence.keys().next().value;
      commentSequence.delete(first);
    }

    chrome.runtime.sendMessage({
      type: "NEW_COMMENT",
      payload: {
        author,
        message,
        raw: rawText,
        sequence,
      },
    });
  }

  renderFloatingComment(author, message, sequence, hash);
}

function scanExisting(root) {
  extractCommentUnits(root).forEach(captureComment);
}

function attachObserver(root) {
  if (observer) observer.disconnect();

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        extractCommentUnits(node).forEach(captureComment);
      });
    }
  });

  observer.observe(root, { childList: true, subtree: true });
}

// Ajustes visuais que o apresentador aplicava manualmente via DevTools para
// dar mais destaque aos comentários durante a live (o layout padrão do
// Facebook privilegia o vídeo e deixa os comentários quase ilegíveis).
//
// As classes atômicas do Facebook são reaproveitadas em elementos sem relação
// nenhuma entre si (ex.: a mesma classe de fonte aparece no texto do
// comentário E no rótulo "53 min"; a mesma classe de min-height aparece em
// TODOS os botões de ação). Por isso os seletores abaixo usam sinais
// estruturais para não vazar para outros elementos:
//   - o texto do comentário sempre tem atributo lang="..." (FB detecta idioma
//     do comentário); textos de botão/rótulo não têm.
//   - o nome do autor está sempre dentro de um <a role="link">; o timestamp
//     ("53 min") usa a mesma classe de fonte mas não está dentro de link.
//   - a largura é aplicada no próprio elemento role="complementary", sem
//     depender do nome da classe.
//
// Usamos um valor fixo em px (não flex-grow): deixar o painel crescer via
// flex fez o Facebook entender que havia pouco espaço reservado para os
// comentários e ativar o modo "teatro" (vídeo full-bleed com comentários
// sobrepostos), que não é o que queremos.
//
// O override precisa mirar a classe .x1cvmir6 (não só o atributo
// role="complementary"): sobrescrever somente pelo atributo role deixava uma
// sobra de espaço em branco à direita porque o player de vídeo (irmão flex
// com flex-grow:1) não recalculava seu tamanho. A classe x1cvmir6 aparece
// duas vezes dentro do painel (no elemento raiz e num wrapper interno) e
// sobrescrever as duas é o que faz o Facebook recalcular o layout do vídeo
// corretamente. Fora do painel de comentários essa mesma classe também é
// reaproveitada em elementos sem relação nenhuma (ex.: a navegação lateral
// do Facebook) — por isso escopamos com o descendente de
// div[role="complementary"] em vez de sobrescrever a classe globalmente.
const READABILITY_CSS = `
  div[role="complementary"].x1cvmir6,
  div[role="complementary"] .x1cvmir6 {
    width: 1036px !important;
  }
  div[role="complementary"] [role="article"] a[role="link"] span.x1nxh6w3 {
    font-size: 1.35rem !important;
  }
  div[role="complementary"] [role="article"] span.x6prxxf[lang] {
    font-size: 1.35rem !important;
  }
`;

function injectReadabilityCss() {
  if (document.getElementById("pascom-live-comments-readability")) return;
  const style = document.createElement("style");
  style.id = "pascom-live-comments-readability";
  style.textContent = READABILITY_CSS;
  document.head.appendChild(style);
}

// Painel flutuante sobreposto à página, mostrando os comentários capturados
// em tempo real. Usa Shadow DOM para isolar o CSS do Facebook (evita que
// classes atômicas deles vazem para dentro do nosso painel e vice-versa).
let floatingListEl = null;
let floatingPanelEl = null;
// Hashes já desenhados no painel ATUAL — diferente de commentSequence (que
// nunca é limpo), este reseta a cada painel novo, pra permitir redesenhar
// comentários que já existiam quando o painel foi recriado.
let renderedInPanel = new Set();

function createFloatingPanel() {
  if (floatingListEl) return;
  renderedInPanel = new Set();

  const host = document.createElement("div");
  host.id = "pascom-floating-comments-host";
  host.style.cssText =
    "position:fixed; bottom:16px; right:16px; z-index:2147483647;";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .panel {
        all: initial;
        display: flex;
        flex-direction: column;
        width: 800px;
        height: 600px;
        min-width: 220px;
        min-height: 120px;
        max-width: 90vw;
        max-height: 90vh;
        background: rgba(255, 255, 255, 0.97);
        border-radius: 10px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        font-family: system-ui, sans-serif;
        overflow: hidden;
        resize: both;
      }
      .header {
        flex-shrink: 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: #1877f2;
        color: #fff;
        font-size: 17px;
        font-weight: 600;
        cursor: move;
        user-select: none;
      }
      .header .title {
        flex: 1;
      }
      .header button {
        all: unset;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
        padding: 2px 6px;
        border-radius: 4px;
      }
      .header button:hover {
        background: rgba(255, 255, 255, 0.2);
      }
      .list {
        overflow-y: auto;
        padding: 8px 12px;
        flex: 1;
        min-height: 0;
      }
      .panel.collapsed {
        height: auto !important;
        min-height: 0 !important;
        resize: none;
      }
      .panel.collapsed .list,
      .panel.collapsed .font-controls {
        display: none;
      }
      .comment {
        padding: 6px 0;
        border-bottom: 1px solid #eee;
        font-size: var(--comment-font-size, 22px);
        color: #1c1e21;
      }
      .comment .author {
        font-weight: 600;
      }
      .comment .time {
        color: #90949c;
        font-size: 0.85em;
        margin-right: 4px;
      }
    </style>
    <div class="panel">
      <div class="header">
        <span class="title">Comentários ao vivo</span>
        <span class="font-controls">
          <button type="button" data-action="font-dec" title="Diminuir fonte">A-</button>
          <button type="button" data-action="font-inc" title="Aumentar fonte">A+</button>
        </span>
        <button type="button" data-action="toggle" title="Minimizar/expandir">–</button>
      </div>
      <div class="list"></div>
    </div>
  `;

  floatingPanelEl = shadow.querySelector(".panel");
  floatingListEl = shadow.querySelector(".list");

  shadow
    .querySelector('[data-action="toggle"]')
    .addEventListener("click", () => {
      floatingPanelEl.classList.toggle("collapsed");
    });

  let commentFontSize = 22;
  const applyFontSize = () => {
    floatingPanelEl.style.setProperty(
      "--comment-font-size",
      `${commentFontSize}px`,
    );
  };
  shadow
    .querySelector('[data-action="font-inc"]')
    .addEventListener("click", () => {
      commentFontSize = Math.min(commentFontSize + 1, 32);
      applyFontSize();
    });
  shadow
    .querySelector('[data-action="font-dec"]')
    .addEventListener("click", () => {
      commentFontSize = Math.max(commentFontSize - 1, 10);
      applyFontSize();
    });

  makeDraggable(host, shadow.querySelector(".header"));
}

// Arrasta o painel pelo cabeçalho. O painel começa posicionado com
// bottom/right (canto inferior direito); ao iniciar o arrasto, trocamos para
// left/top (mais simples de calcular o deslocamento do mouse).
function makeDraggable(host, handle) {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  handle.addEventListener("mousedown", (event) => {
    if (event.target.closest("button")) return;

    const rect = host.getBoundingClientRect();
    host.style.left = `${rect.left}px`;
    host.style.top = `${rect.top}px`;
    host.style.right = "auto";
    host.style.bottom = "auto";

    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    event.preventDefault();
  });

  document.addEventListener("mousemove", (event) => {
    if (!dragging) return;
    host.style.left = `${startLeft + (event.clientX - startX)}px`;
    host.style.top = `${startTop + (event.clientY - startY)}px`;
  });

  document.addEventListener("mouseup", () => {
    dragging = false;
  });
}

function renderFloatingComment(author, message, sequence, hash) {
  if (!floatingListEl) return;
  if (renderedInPanel.has(hash)) return;
  renderedInPanel.add(hash);

  const item = document.createElement("div");
  item.className = "comment";

  const seqSpan = document.createElement("span");
  seqSpan.className = "time";
  seqSpan.textContent = `#${sequence}`;

  const authorSpan = document.createElement("span");
  authorSpan.className = "author";
  authorSpan.textContent = author ? `${author}: ` : "";

  item.appendChild(seqSpan);
  item.appendChild(authorSpan);
  item.appendChild(document.createTextNode(message));
  floatingListEl.appendChild(item);
  floatingListEl.scrollTop = floatingListEl.scrollHeight;
}

// Em vez de clicar no botão "Ocultar comentários" do próprio Facebook (que
// pode desmontar o feed de comentários do DOM e parar nossa captura), nós
// escondemos o bloco visualmente com nosso próprio CSS, mantendo o DOM
// montado para o MutationObserver continuar funcionando. O container da
// lista é sempre o irmão seguinte da linha que contém o botão "Ocultar
// comentários" — usamos essa relação estrutural em vez de classes atômicas
// (frágeis) para localizá-lo.
let nativeCommentsHidden = false;
let nativeHeaderRowEl = null;
let nativeListContainerEl = null;

function hideNativeComments() {
  if (nativeCommentsHidden) return true;

  const hideBtn = document.querySelector('[aria-label="Ocultar comentários"]');
  const headerRow = hideBtn?.parentElement;
  const listContainer = headerRow?.nextElementSibling;
  if (!headerRow || !listContainer) return false;

  headerRow.style.display = "none";
  listContainer.style.display = "none";
  nativeHeaderRowEl = headerRow;
  nativeListContainerEl = listContainer;
  nativeCommentsHidden = true;
  return true;
}

function restoreNativeComments() {
  if (nativeHeaderRowEl) nativeHeaderRowEl.style.display = "";
  if (nativeListContainerEl) nativeListContainerEl.style.display = "";
  nativeHeaderRowEl = null;
  nativeListContainerEl = null;
  nativeCommentsHidden = false;
}

function tryAttach() {
  const found = findPanel();
  if (found && found !== panelEl) {
    panelEl = found;
    const units = extractCommentUnits(panelEl);
    console.info(
      `[pascom-face-live-comments] painel conectado. unidades de comentário encontradas: ${units.length}`,
      units,
    );
    units.forEach(captureComment);
    attachObserver(panelEl);
  }
  return found;
}

// Lê a configuração salva pelo popup da extensão: um interruptor geral
// (extensionEnabled, controle de emergência para desligar tudo) e a lista
// de URLs permitidas (allowedUrls) — a extensão só atua nas URLs
// cadastradas; lista vazia = não atua em nenhuma página.
function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["extensionEnabled", "allowedUrls"], (result) => {
      resolve({
        enabled: result.extensionEnabled !== false,
        allowedUrls: result.allowedUrls || [],
      });
    });
  });
}

// Lista vazia = a extensão não atua em NENHUMA página. Ela só liga para as
// URLs que você cadastrar explicitamente no popup.
function isUrlAllowed(allowedUrls) {
  if (!allowedUrls || allowedUrls.length === 0) return false;
  return allowedUrls.some(
    (pattern) => pattern && location.href.includes(pattern),
  );
}

// O Facebook é uma SPA: navegar entre páginas (ex: abrir uma live a partir
// do feed) normalmente NÃO recarrega o content script. Por isso não basta
// ler a configuração uma vez no carregamento — precisamos reagir a mudanças
// no chrome.storage (popup ligando/desligando ou editando a lista de URLs)
// em tempo real, sem depender de um F5. `activeState` guarda tudo que
// precisa ser desfeito ao desativar.
let activeState = null;
// Controla quando limpar o storage: uma vez para cada URL diferente que a
// extensão ativa. Isso cobre tanto um F5/nova aba (href muda de null pra
// algo) quanto trocar de live via navegação da SPA sem reload (href muda de
// uma live pra outra) — mas NÃO limpa ao só desativar/reativar na MESMA
// live (toggle no popup, SPA nav pra fora e de volta), preservando o que já
// foi capturado nessa sessão de visualização.
let lastClearedForHref = null;

function activate() {
  if (activeState) return;

  if (lastClearedForHref !== location.href) {
    lastClearedForHref = location.href;
    chrome.runtime.sendMessage({ type: "CLEAR_COMMENTS" });
    // Reseta a numeração também, senão a nova live começaria em #8 em
    // diante mesmo com o storage zerado.
    commentSequence.clear();
    sequenceCounter = 0;
  }

  injectReadabilityCss();
  createFloatingPanel();

  // O painel da live pode carregar de forma assíncrona, então tentamos
  // periodicamente até encontrá-lo e observamos o body para reconectar caso
  // o painel seja recriado (ex: ao trocar de live).
  const rootObserver = new MutationObserver(() => tryAttach());
  rootObserver.observe(document.body, { childList: true, subtree: true });

  tryAttach();
  const retryInterval = setInterval(() => {
    const panelFound = tryAttach();
    // O botão "Ocultar comentários" costuma carregar um instante depois do
    // painel em si, então continuamos tentando escondê-lo neste mesmo retry
    // até conseguir.
    const hidden = hideNativeComments();
    if (panelFound && hidden) clearInterval(retryInterval);
  }, 2000);

  activeState = { rootObserver, retryInterval };
  console.info("[pascom-face-live-comments] ativada.");
}

function deactivate() {
  if (!activeState) return;

  activeState.rootObserver.disconnect();
  clearInterval(activeState.retryInterval);
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  panelEl = null;

  document.getElementById("pascom-live-comments-readability")?.remove();
  document.getElementById("pascom-floating-comments-host")?.remove();
  floatingPanelEl = null;
  floatingListEl = null;

  restoreNativeComments();

  // Não limpamos commentSequence aqui: ele existe justamente para
  // sobreviver a esse ciclo de desativar/reativar (evita reenviar pro
  // storage um comentário já persistido). O painel novo (criado no próximo
  // activate()) é repopulado do zero via renderedInPanel, que reseta
  // sozinho em createFloatingPanel().

  activeState = null;
  console.info("[pascom-face-live-comments] desativada.");
}

async function evaluateAndApply() {
  const config = await loadConfig();

  if (!config.enabled) {
    console.info(
      "[pascom-face-live-comments] desativada (extensão desligada no popup).",
    );
    deactivate();
    return;
  }
  if (!isUrlAllowed(config.allowedUrls)) {
    console.info(
      "[pascom-face-live-comments] URL atual não bate com nenhum item da lista de URLs permitidas:",
      location.href,
      config.allowedUrls,
    );
    deactivate();
    return;
  }

  activate();
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if ("extensionEnabled" in changes || "allowedUrls" in changes) {
    evaluateAndApply();
  }
});

if (document.body) {
  evaluateAndApply();
} else {
  document.addEventListener("DOMContentLoaded", evaluateAndApply);
}

// O Facebook é uma SPA: navegar de um vídeo pra outro (ex: pelo carrossel
// "Vídeos ao vivo para você") troca a URL via History API, sem recarregar a
// página — nada mais aqui reage a isso. Sem este monitor, se você sair de
// uma URL permitida e cair numa não permitida (ou vice-versa) dentro do
// mesmo carregamento de página, a extensão ficava presa na decisão antiga.
let lastCheckedHref = location.href;
setInterval(() => {
  if (location.href === lastCheckedHref) return;
  lastCheckedHref = location.href;
  console.info(
    "[pascom-face-live-comments] navegação da SPA detectada, reavaliando URL:",
    lastCheckedHref,
  );
  evaluateAndApply();
}, 1000);
