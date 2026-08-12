const SIGNED_URL_ENDPOINT = "/.netlify/functions/signed-url";
const CLIENT_LOAD_TIMEOUT_MS = 12000;

const statusEl = document.getElementById("status");
const statusDetailEl = document.getElementById("status-detail");
const errorEl = document.getElementById("error");
const orbEl = document.getElementById("orb");
const startBtn = document.getElementById("start-btn");
const endBtn = document.getElementById("end-btn");
const clockEl = document.getElementById("clock");
const linkDot = document.getElementById("link-dot");

/** @type {null | { endSession: () => Promise<void> }} */
let conversation = null;
let sessionGen = 0;
let ending = false;
let live = false;

function setClock() {
  clockEl.textContent = new Date().toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

setClock();
setInterval(setClock, 1000);

function setHud({ state, label, detail, error }) {
  orbEl.dataset.state = state;
  statusEl.textContent = label;
  statusDetailEl.textContent = detail;
  if (error) {
    errorEl.hidden = false;
    errorEl.textContent = error;
  } else {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  linkDot.className = "dot";
  if (state === "listening" || state === "speaking") linkDot.classList.add("live");
  else if (state === "connecting") linkDot.classList.add("warn");
  else if (state === "error") linkDot.classList.add("err");
  else linkDot.classList.add("idle");
}

function setButtons({ startDisabled, endDisabled }) {
  startBtn.disabled = startDisabled;
  endBtn.disabled = endDisabled;
}

function errorMessage(err) {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return "Unknown error";
}

async function waitForConversationApi() {
  const started = Date.now();
  while (Date.now() - started < CLIENT_LOAD_TIMEOUT_MS) {
    const startSession = globalThis.ElevenLabsClient?.Conversation?.startSession;
    if (typeof startSession === "function") {
      return globalThis.ElevenLabsClient.Conversation;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for the ElevenLabs client.");
}

async function unlockMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser cannot access the microphone.");
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
  } catch (err) {
    if (err && typeof err === "object" && "name" in err && err.name === "NotAllowedError") {
      throw new Error("Microphone permission is required to talk to Jarvis.");
    }
    throw err;
  }
}

async function fetchSignedUrl() {
  const response = await fetch(SIGNED_URL_ENDPOINT, { method: "GET" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.signedUrl) {
    throw new Error(payload.error || "Could not authorize a Jarvis session.");
  }
  return payload.signedUrl;
}

function applyListeningHud() {
  setHud({
    state: "listening",
    label: "ONLINE",
    detail: "Channel open. Speak when ready — Jarvis is listening.",
  });
}

function applySpeakingHud() {
  setHud({
    state: "speaking",
    label: "SPEAKING",
    detail: "Jarvis is talking. Wait for the reply, then speak.",
  });
}

function applyStandbyHud(detail) {
  setHud({
    state: "idle",
    label: "STANDBY",
    detail: detail || "Conversation closed. Initiate again when you need Jarvis.",
  });
}

async function startConversation() {
  if (conversation || ending) return;

  const gen = ++sessionGen;
  setButtons({ startDisabled: true, endDisabled: false });
  setHud({
    state: "connecting",
    label: "AUTHORIZING",
    detail: "Requesting microphone access, then a short-lived signed URL.",
  });

  try {
    const Conversation = await waitForConversationApi();
    if (gen !== sessionGen) return;

    await unlockMicrophone();
    if (gen !== sessionGen) return;

    setHud({
      state: "connecting",
      label: "AUTHORIZING",
      detail: "Minting a signed conversation URL.",
    });

    const signedUrl = await fetchSignedUrl();
    if (gen !== sessionGen) return;

    setHud({
      state: "connecting",
      label: "CONNECTING",
      detail: "Opening the Jarvis voice channel.",
    });

    const session = await Conversation.startSession({
      signedUrl,
      connectionType: "websocket",
      onConversationCreated: (created) => {
        if (gen !== sessionGen) {
          void created.endSession();
          return;
        }
        conversation = created;
      },
      onConnect: () => {
        if (gen !== sessionGen) return;
        live = true;
        applyListeningHud();
        setButtons({ startDisabled: true, endDisabled: false });
      },
      onDisconnect: (details) => {
        if (gen !== sessionGen) return;
        conversation = null;
        live = false;
        ending = false;
        setButtons({ startDisabled: false, endDisabled: true });
        if (details?.reason === "error") {
          setHud({
            state: "error",
            label: "FAULT",
            detail: "The voice channel closed unexpectedly.",
            error: details.message || "Conversation disconnected.",
          });
          return;
        }
        applyStandbyHud(
          details?.reason === "agent"
            ? "Jarvis ended the conversation. Initiate again when you need him."
            : "Conversation closed. Initiate again when you need Jarvis.",
        );
      },
      onError: (message) => {
        if (gen !== sessionGen) return;
        errorEl.hidden = false;
        errorEl.textContent = errorMessage(message);
      },
      onStatusChange: ({ status }) => {
        if (gen !== sessionGen) return;
        if (status === "connecting" && !live) {
          setHud({
            state: "connecting",
            label: "CONNECTING",
            detail: "Opening the Jarvis voice channel.",
          });
        }
      },
      onModeChange: ({ mode }) => {
        if (gen !== sessionGen || !live) return;
        if (mode === "speaking") applySpeakingHud();
        else applyListeningHud();
      },
    });

    if (gen !== sessionGen) {
      await session.endSession().catch(() => {});
      return;
    }

    conversation = session;
    live = true;
    setButtons({ startDisabled: true, endDisabled: false });
    if (orbEl.dataset.state === "connecting") {
      applyListeningHud();
    }
  } catch (err) {
    if (gen !== sessionGen) return;
    const partial = conversation;
    conversation = null;
    live = false;
    ending = false;
    if (partial) await partial.endSession().catch(() => {});
    setButtons({ startDisabled: false, endDisabled: true });
    setHud({
      state: "error",
      label: "FAULT",
      detail: "Session could not start. Check Netlify env vars and try again.",
      error: errorMessage(err),
    });
  }
}

async function endConversation() {
  if (ending) return;
  ending = true;
  sessionGen += 1;
  setButtons({ startDisabled: true, endDisabled: true });
  setHud({
    state: "connecting",
    label: "ENDING",
    detail: "Closing the Jarvis voice channel.",
  });

  const current = conversation;
  conversation = null;
  live = false;
  try {
    if (current) await current.endSession();
  } catch {
    // Ending is best-effort; always return the HUD to standby.
  }

  ending = false;
  setButtons({ startDisabled: false, endDisabled: true });
  applyStandbyHud();
}

startBtn.addEventListener("click", () => {
  void startConversation();
});
endBtn.addEventListener("click", () => {
  void endConversation();
});

waitForConversationApi().catch(() => {
  setHud({
    state: "error",
    label: "FAULT",
    detail: "The ElevenLabs client failed to load.",
    error: "CDN script did not expose ElevenLabsClient.Conversation.",
  });
});

window.addEventListener("beforeunload", () => {
  if (conversation) {
    void conversation.endSession();
  }
});
