// Service worker: persiste os comentários recebidos do content script e os
// retransmite em tempo real para o app pascom-live-comments.

const STORAGE_KEY = "capturedComments";

// Endereço do app pascom-live-comments. Ajuste para a URL de produção
// quando o app não estiver mais rodando em localhost, e adicione o novo
// domínio em host_permissions no manifest.json.
const BRIDGE_URL = "http://localhost:3000/api/live-comments";

function forwardToBridge(payload) {
  fetch(BRIDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      authorName: payload.author,
      message: payload.message,
      // O content script não envia mais um horário (trocado por um
      // contador sequencial, ver payload.sequence) — o app pascom-live-
      // comments precisa de um timestamp real pra ordenar as mensagens,
      // então usamos o momento do repasse aqui no service worker.
      publishedAt: new Date().toISOString(),
    }),
  }).catch(() => {
    // O app pode estar fechado/offline — a captura local continua
    // funcionando normalmente, só a ponte em tempo real que falha.
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "NEW_COMMENT") {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const comments = result[STORAGE_KEY] || [];
      comments.push(message.payload);
      chrome.storage.local.set({ [STORAGE_KEY]: comments });
    });
    forwardToBridge(message.payload);
    return;
  }

  if (message.type === "GET_COMMENTS") {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      sendResponse(result[STORAGE_KEY] || []);
    });
    return true; // resposta assíncrona
  }

  if (message.type === "CLEAR_COMMENTS") {
    chrome.storage.local.set({ [STORAGE_KEY]: [] }, () => sendResponse(true));
    return true;
  }
});
