import { getSettings, saveSettings } from "../shared/settings";

const form = document.getElementById("settings-form") as HTMLFormElement;
const emailInput = document.getElementById("email-input") as HTMLInputElement;
const saveBtn = document.getElementById("save-btn") as HTMLButtonElement;
const statusMsg = document.getElementById("status-msg") as HTMLParagraphElement;

// Populate existing value
getSettings().then(({ email }) => {
  emailInput.value = email;
  if (email) {
    saveBtn.textContent = "Save";
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();
  if (!email) return;

  saveBtn.disabled = true;
  try {
    await saveSettings({ email });
    statusMsg.textContent = "Saved! FLoRA is now active — reload any open tabs to start tracking.";
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
