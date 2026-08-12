const SIGNED_URL_ENDPOINT = "/.netlify/functions/signed-url";

const statusEl = document.getElementById("status");
const statusDetailEl = document.getElementById("status-detail");
const errorEl = document.getElementById("error");
const orbEl = document.getElementById("orb");
const startBtn = document.getElementById("start-btn");
const endBtn = document.getElementById("end-btn");
const clockEl = document.getElementById("clock");
const linkDot = document.getElementById("link-dot");
const widget = document.getElementById("jarvis-widget");

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
  if (state === "live") linkDot.classList.add("live");
  else if (state === "connecting") linkDot.classList.add("warn");
  else if (state === "error") linkDot.classList.add("err");
  else linkDot.classList.add("idle");
}

async function getWidget() {
  if (customElements.get("elevenlabs-convai")) return widget;
  await Promise.race([
    customElements.whenDefined("elevenlabs-convai"),
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error("Timed out waiting for the ElevenLabs widget.")),
        12000,
      );
    }),
  ]);
  return widget;
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

async function startConversation() {
  startBtn.disabled = true;
  setHud({
    state: "connecting",
    label: "AUTHORIZING",
    detail: "Requesting microphone access, then a short-lived signed URL.",
  });

  try {
    await unlockMicrophone();
    const signedUrl = await fetchSignedUrl();
    const convai = await getWidget();
    convai.removeAttribute("agent-id");
    convai.setAttribute("signed-url", signedUrl);

    if (typeof convai.startConversation === "function") {
      await convai.startConversation();
    }

    live = true;
    endBtn.disabled = false;
    setHud({
      state: "live",
      label: "ONLINE",
      detail: "Channel open. Speak when ready — Jarvis is listening.",
    });
  } catch (err) {
    live = false;
    startBtn.disabled = false;
    endBtn.disabled = true;
    setHud({
      state: "error",
      label: "FAULT",
      detail: "Session could not start. Check Netlify env vars and try again.",
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

async function endConversation() {
  endBtn.disabled = true;
  try {
    const convai = await getWidget();
    if (typeof convai.endConversation === "function") {
      await convai.endConversation();
    }
    convai.removeAttribute("signed-url");
  } catch {
    // Ending is best-effort; always return the HUD to standby.
  }

  live = false;
  startBtn.disabled = false;
  setHud({
    state: "idle",
    label: "STANDBY",
    detail: "Conversation closed. Initiate again when you need Jarvis.",
  });
}

function bindWidgetEvents(convai) {
  const onStart = () => {
    live = true;
    startBtn.disabled = true;
    endBtn.disabled = false;
    setHud({
      state: "live",
      label: "ONLINE",
      detail: "Channel open. Speak when ready — Jarvis is listening.",
    });
  };

  const onEnd = () => {
    live = false;
    startBtn.disabled = false;
    endBtn.disabled = true;
    setHud({
      state: "idle",
      label: "STANDBY",
      detail: "Conversation closed. Initiate again when you need Jarvis.",
    });
  };

  convai.addEventListener("conversationStarted", onStart);
  convai.addEventListener("conversationEnded", onEnd);
  convai.addEventListener("elevenlabs-convai:call", onStart);
}

startBtn.addEventListener("click", startConversation);
endBtn.addEventListener("click", endConversation);

getWidget()
  .then(bindWidgetEvents)
  .catch(() => {
    setHud({
      state: "error",
      label: "FAULT",
      detail: "The ElevenLabs widget failed to load.",
      error: "Widget script did not register elevenlabs-convai.",
    });
  });

window.addEventListener("beforeunload", () => {
  if (live && typeof widget.endConversation === "function") {
    widget.endConversation();
  }
});
