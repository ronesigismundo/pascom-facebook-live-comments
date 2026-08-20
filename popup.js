const listEl = document.getElementById("list");
const countEl = document.getElementById("count");

function render(comments) {
  countEl.textContent = comments.length;
  listEl.innerHTML = "";

  if (comments.length === 0) {
    listEl.innerHTML = '<div class="empty">Nenhum comentário capturado ainda.</div>';
    return;
  }

  comments.forEach((c, index) => {
    const div = document.createElement("div");
    div.className = "comment";
    const seq = c.sequence ?? index + 1;
    div.innerHTML = `<span class="time">#${seq}</span> <span class="author">${escapeHtml(
      c.author
    )}</span>: ${escapeHtml(c.message)}`;
    listEl.appendChild(div);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename }, () => URL.revokeObjectURL(url));
}

function toCsv(comments) {
  const header = "sequence,author,message\n";
  const rows = comments.map(
    (c, index) =>
      `"${c.sequence ?? index + 1}","${(c.author || "").replace(/"/g, '""')}","${(
        c.message || ""
      ).replace(/"/g, '""')}"`
  );
  return header + rows.join("\n");
}

function loadComments() {
  chrome.runtime.sendMessage({ type: "GET_COMMENTS" }, (comments) => {
    render(comments || []);
    window.__comments = comments || [];
  });
}

document.getElementById("exportJson").addEventListener("click", () => {
  downloadFile(
    `comentarios-live-${Date.now()}.json`,
    JSON.stringify(window.__comments || [], null, 2),
    "application/json"
  );
});

document.getElementById("exportCsv").addEventListener("click", () => {
  downloadFile(
    `comentarios-live-${Date.now()}.csv`,
    toCsv(window.__comments || []),
    "text/csv"
  );
});

document.getElementById("clear").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CLEAR_COMMENTS" }, () => loadComments());
});

loadComments();

// Configuração: interruptor geral e lista de URLs permitidas. Guardados no
// chrome.storage.local e lidos pelo content.js a cada carregamento de página.
const enabledToggleEl = document.getElementById("enabledToggle");
const urlInputEl = document.getElementById("urlInput");
const urlListEl = document.getElementById("urlList");

function renderUrlList(urls) {
  urlListEl.innerHTML = "";
  urls.forEach((url, index) => {
    const row = document.createElement("div");
    row.className = "url-item";

    const span = document.createElement("span");
    span.textContent = url;
    span.title = url;

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "x";
    removeBtn.addEventListener("click", () => {
      const next = urls.slice();
      next.splice(index, 1);
      chrome.storage.local.set({ allowedUrls: next }, () => renderUrlList(next));
    });

    row.appendChild(span);
    row.appendChild(removeBtn);
    urlListEl.appendChild(row);
  });
}

function loadConfig() {
  chrome.storage.local.get(["extensionEnabled", "allowedUrls"], (result) => {
    enabledToggleEl.checked = result.extensionEnabled !== false;
    renderUrlList(result.allowedUrls || []);
  });
}

enabledToggleEl.addEventListener("change", () => {
  chrome.storage.local.set({ extensionEnabled: enabledToggleEl.checked });
});

function addUrl(rawUrl) {
  const url = rawUrl.trim();
  if (!url) return;

  chrome.storage.local.get(["allowedUrls"], (result) => {
    const urls = result.allowedUrls || [];
    if (urls.includes(url)) return;
    const next = [...urls, url];
    chrome.storage.local.set({ allowedUrls: next }, () => renderUrlList(next));
  });
}

document.getElementById("addUrl").addEventListener("click", () => {
  addUrl(urlInputEl.value);
  urlInputEl.value = "";
});

urlInputEl.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  addUrl(urlInputEl.value);
  urlInputEl.value = "";
});

// Importante: a extensão deve valer só para a URL exata cadastrada. O
// Facebook mostra a mesma live sob URLs diferentes dependendo de como você
// chegou nela (ex: ".../suapagina/videos/123456" vs
// ".../watch/live/?v=123456") — essas páginas têm estrutura de DOM
// diferente, e rodar nas duas causava captura de comentários errados. Por
// isso guardamos hostname+pathname exatos (sem tentar unificar por ID de
// vídeo), o que naturalmente já exclui variantes como "/watch/live/".
document.getElementById("addCurrentUrl").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabUrl = tabs[0]?.url;
    if (!tabUrl) return;

    try {
      const { hostname, pathname } = new URL(tabUrl);
      addUrl(`${hostname}${pathname}`);
    } catch {
      addUrl(tabUrl);
    }
  });
});

loadConfig();
