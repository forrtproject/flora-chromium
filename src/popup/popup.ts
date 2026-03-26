import { getBlockedDomains, saveBlockedDomains, isDomainBlocked } from "../shared/domains";

const domainEl = document.getElementById("current-domain")!;
const blockBtn = document.getElementById("block-btn")!;
const blockLabel = document.getElementById("block-btn-label")!;
const hideBtn = document.getElementById("hide-btn")!;
const hideLabel = document.getElementById("hide-btn-label")!;
const optionsBtn = document.getElementById("options-btn")!;
const statusEl = document.getElementById("popup-status")!;

let currentDomain = "";
let blocked = false;
let hidden = false;
let activeTabId: number | undefined;

function showStatus(msg: string, type: "success" | "error"): void {
  statusEl.textContent = msg;
  statusEl.className = `popup-status ${type}`;
  statusEl.hidden = false;
  setTimeout(() => {
    statusEl.hidden = true;
  }, 2500);
}

function updateBlockUI(): void {
  if (blocked) {
    blockLabel.textContent = "Remove from blacklist";
    blockBtn.classList.add("is-blocked");
  } else {
    blockLabel.textContent = "Blacklist this domain";
    blockBtn.classList.remove("is-blocked");
  }
}

function updateHideUI(): void {
  if (hidden) {
    hideLabel.textContent = "Show on this page";
    hideBtn.classList.add("is-hidden");
  } else {
    hideLabel.textContent = "Hide on this page";
    hideBtn.classList.remove("is-hidden");
  }
}

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    domainEl.textContent = "No active page";
    blockBtn.style.display = "none";
    hideBtn.style.display = "none";
    return;
  }

  activeTabId = tab.id;

  try {
    const url = new URL(tab.url);
    currentDomain = url.hostname;
    domainEl.textContent = currentDomain;
  } catch {
    domainEl.textContent = "Internal page";
    blockBtn.style.display = "none";
    hideBtn.style.display = "none";
    return;
  }

  blocked = await isDomainBlocked(currentDomain);
  updateBlockUI();

  // Ask the content script whether UI is currently hidden
  if (activeTabId != null) {
    try {
      const response = await chrome.tabs.sendMessage(activeTabId, { type: "FLORA_GET_STATE" });
      if (response?.hidden) {
        hidden = true;
        updateHideUI();
      }
    } catch {
      // Content script not running on this page — that's fine
    }
  }
}

// Block / unblock the current domain
blockBtn.addEventListener("click", async () => {
  if (!currentDomain) return;

  const domains = await getBlockedDomains();

  if (blocked) {
    const updated = domains.filter((d) => d !== currentDomain);
    await saveBlockedDomains(updated);
    blocked = false;
    showStatus(`Unblocked ${currentDomain}`, "success");
  } else {
    if (!domains.includes(currentDomain)) {
      domains.push(currentDomain);
      await saveBlockedDomains(domains);
    }
    blocked = true;
    showStatus(`Blocked ${currentDomain}`, "success");
  }

  updateBlockUI();
});

// Toggle FLoRA UI visibility on the current page (session only)
hideBtn.addEventListener("click", async () => {
  if (activeTabId == null) return;

  const messageType = hidden ? "FLORA_SHOW_UI" : "FLORA_HIDE_UI";

  try {
    await chrome.tabs.sendMessage(activeTabId, { type: messageType });
    hidden = !hidden;
    updateHideUI();
    showStatus(hidden ? "Hidden until page refresh" : "FLoRA restored", "success");
  } catch {
    showStatus("No FLoRA content on this page", "error");
  }
});

// Open settings page
optionsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

init();
