import { getSettings, saveSettings } from "../shared/settings";
import { getBlockedDomains, saveBlockedDomains } from "../shared/domains";

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
