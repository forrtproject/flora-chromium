import { getSettings, saveSettings } from "../shared/settings";
import { getBlockedDomains, saveBlockedDomains } from "../shared/domains";
import {
  getHiddenCommenters,
  isHiddenCommenter,
  saveHiddenCommenters,
} from "../shared/pubpeer-filter";

// ── Email form ──────────────────────────────────────────────────────

const form = document.getElementById("settings-form") as HTMLFormElement;
const emailInput = document.getElementById("email-input") as HTMLInputElement;
const saveBtn = document.getElementById("save-btn") as HTMLButtonElement;
const statusMsg = document.getElementById("status-msg") as HTMLParagraphElement;

getSettings().then(({ email }) => {
  emailInput.value = email;
  if (email) saveBtn.textContent = "Save";
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();
  if (!email) return;

  saveBtn.disabled = true;
  try {
    await saveSettings({ email });
    statusMsg.textContent =
      "Saved! FLoRA is now active — reload any open tabs to start tracking.";
    statusMsg.className = "status success";
    statusMsg.hidden = false;
    saveBtn.textContent = "Save";
  } catch {
    statusMsg.textContent = "Failed to save — please try again.";
    statusMsg.className = "status error";
    statusMsg.hidden = false;
  } finally {
    saveBtn.disabled = false;
  }
});

// ── DOI pill display ────────────────────────────────────────────────

const allRefsToggle = document.getElementById("all-refs-toggle") as HTMLInputElement;

getSettings().then(({ showDoiPillsOnAllReferences }) => {
  allRefsToggle.checked = showDoiPillsOnAllReferences;
});

allRefsToggle.addEventListener("change", () => {
  void saveSettings({ showDoiPillsOnAllReferences: allRefsToggle.checked });
});

// ── Cache storage quota ─────────────────────────────────────────────

const cacheQuotaInput = document.getElementById("cache-quota-input") as HTMLInputElement;
const cacheQuotaSaveBtn = document.getElementById("cache-quota-save-btn") as HTMLButtonElement;
const cacheQuotaStatus = document.getElementById("cache-quota-status") as HTMLParagraphElement;

getSettings().then(({ cacheQuotaMb }) => {
  cacheQuotaInput.value = String(cacheQuotaMb);
});

cacheQuotaSaveBtn.addEventListener("click", async () => {
  const raw = parseInt(cacheQuotaInput.value, 10);
  const cacheQuotaMb = isNaN(raw) || raw < 0 ? 50 : raw;
  cacheQuotaInput.value = String(cacheQuotaMb);
  cacheQuotaSaveBtn.disabled = true;
  try {
    await saveSettings({ cacheQuotaMb });
    cacheQuotaStatus.textContent = cacheQuotaMb === 0
      ? "Storage limit removed — cache is unlimited."
      : `Storage limit set to ${cacheQuotaMb} MB.`;
    cacheQuotaStatus.className = "status domain-status success";
    cacheQuotaStatus.hidden = false;
    setTimeout(() => { cacheQuotaStatus.hidden = true; }, 3000);
  } catch {
    cacheQuotaStatus.textContent = "Failed to save — please try again.";
    cacheQuotaStatus.className = "status domain-status error";
    cacheQuotaStatus.hidden = false;
  } finally {
    cacheQuotaSaveBtn.disabled = false;
  }
});

// ── Domain blocklist ────────────────────────────────────────────────

const domainInput = document.getElementById("domain-input") as HTMLInputElement;
const addDomainBtn = document.getElementById("add-domain-btn") as HTMLButtonElement;
const domainList = document.getElementById("domain-list") as HTMLDivElement;
const domainStatusMsg = document.getElementById("domain-status-msg") as HTMLParagraphElement;

let blocked: string[] = [];

function renderBlockedList(): void {
  domainList.innerHTML = "";

  if (blocked.length === 0) {
    const empty = document.createElement("div");
    empty.className = "domain-empty";
    empty.textContent = "No domains blocked — FLoRA is active on all sites.";
    domainList.appendChild(empty);
    return;
  }

  const sorted = [...blocked].sort((a, b) => a.localeCompare(b));

  for (const domain of sorted) {
    const row = document.createElement("div");
    row.className = "domain-row";

    const label = document.createElement("span");
    label.className = "domain-name";
    label.textContent = domain;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "domain-remove";
    removeBtn.setAttribute("aria-label", "Unblock");
    removeBtn.innerHTML = "&times;";
    removeBtn.addEventListener("click", () => unblockDomain(domain));

    row.appendChild(label);
    row.appendChild(removeBtn);
    domainList.appendChild(row);
  }
}

async function unblockDomain(domain: string): Promise<void> {
  blocked = blocked.filter((d) => d !== domain);
  await saveBlockedDomains(blocked);
  renderBlockedList();
  showDomainStatus(`Unblocked ${domain}`, "success");
}

async function blockDomain(): Promise<void> {
  const raw = domainInput.value.trim().toLowerCase();
  if (!raw) return;

  // Strip protocol & path
  const domain = raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  if (
    !domain ||
    !/^[a-z0-9]([a-z0-9\-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9\-]*[a-z0-9])?)+$/.test(domain)
  ) {
    showDomainStatus("Invalid domain format.", "error");
    return;
  }

  if (blocked.includes(domain)) {
    showDomainStatus(`${domain} is already blocked.`, "error");
    return;
  }

  blocked.push(domain);
  await saveBlockedDomains(blocked);
  domainInput.value = "";
  renderBlockedList();
  showDomainStatus(`Blocked ${domain}`, "success");
}

function showDomainStatus(msg: string, type: "success" | "error"): void {
  domainStatusMsg.textContent = msg;
  domainStatusMsg.className = `status domain-status ${type}`;
  domainStatusMsg.hidden = false;
  setTimeout(() => {
    domainStatusMsg.hidden = true;
  }, 3000);
}

// Listeners
addDomainBtn.addEventListener("click", blockDomain);
domainInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    blockDomain();
  }
});

// Init
getBlockedDomains().then((b) => {
  blocked = b;
  renderBlockedList();
});

// ── Muted PubPeer commenters ────────────────────────────────────────

const commenterInput = document.getElementById("commenter-input") as HTMLInputElement;
const addCommenterBtn = document.getElementById("add-commenter-btn") as HTMLButtonElement;
const commenterList = document.getElementById("commenter-list") as HTMLDivElement;
const commenterStatusMsg = document.getElementById("commenter-status-msg") as HTMLParagraphElement;

let mutedCommenters: string[] = [];

function renderCommenterList(): void {
  commenterList.innerHTML = "";

  if (mutedCommenters.length === 0) {
    const empty = document.createElement("div");
    empty.className = "domain-empty";
    empty.textContent = "No commenters muted — all PubPeer comments are shown.";
    commenterList.appendChild(empty);
    return;
  }

  const sorted = [...mutedCommenters].sort((a, b) => a.localeCompare(b));

  for (const id of sorted) {
    const row = document.createElement("div");
    row.className = "domain-row";

    const label = document.createElement("span");
    label.className = "domain-name";
    label.textContent = id;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "domain-remove";
    removeBtn.setAttribute("aria-label", `Unmute ${id}`);
    removeBtn.innerHTML = "&times;";
    removeBtn.addEventListener("click", () => unmuteCommenter(id));

    row.appendChild(label);
    row.appendChild(removeBtn);
    commenterList.appendChild(row);
  }
}

async function unmuteCommenter(id: string): Promise<void> {
  mutedCommenters = mutedCommenters.filter((c) => c !== id);
  await saveHiddenCommenters(mutedCommenters);
  renderCommenterList();
  showCommenterStatus(`Unmuted ${id}`, "success");
}

async function muteCommenter(): Promise<void> {
  const id = commenterInput.value.trim();
  if (!id) return;

  if (isHiddenCommenter(id, mutedCommenters)) {
    showCommenterStatus(`${id} is already muted.`, "error");
    return;
  }

  mutedCommenters.push(id);
  await saveHiddenCommenters(mutedCommenters);
  commenterInput.value = "";
  renderCommenterList();
  showCommenterStatus(`Muted ${id}`, "success");
}

function showCommenterStatus(msg: string, type: "success" | "error"): void {
  commenterStatusMsg.textContent = msg;
  commenterStatusMsg.className = `status domain-status ${type}`;
  commenterStatusMsg.hidden = false;
  setTimeout(() => {
    commenterStatusMsg.hidden = true;
  }, 3000);
}

addCommenterBtn.addEventListener("click", muteCommenter);
commenterInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    muteCommenter();
  }
});

getHiddenCommenters().then((ids) => {
  mutedCommenters = ids;
  renderCommenterList();
});
