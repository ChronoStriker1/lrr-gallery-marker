"use strict";

const DEFAULTS = {
  server: "",
  apiKey: "",
  enabled: true,
  matchByTitle: true,
  concurrency: 4,
  cacheMinutes: 10
};

const fields = {
  server: document.querySelector("#server"),
  apiKey: document.querySelector("#apiKey"),
  enabled: document.querySelector("#enabled"),
  matchByTitle: document.querySelector("#matchByTitle"),
  concurrency: document.querySelector("#concurrency"),
  cacheMinutes: document.querySelector("#cacheMinutes")
};

loadSettings();

document.querySelector("#save").addEventListener("click", saveSettings);
document.querySelector("#test").addEventListener("click", testConnection);

async function loadSettings() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  for (const [key, element] of Object.entries(fields)) {
    element[element.type === "checkbox" ? "checked" : "value"] = settings[key];
  }
}

async function saveSettings() {
  const status = document.querySelector("#saveStatus");
  status.classList.remove("error");
  await chrome.storage.local.set(readForm());
  status.textContent = "Saved. Reload open source-site tabs to apply immediately.";
}

async function testConnection() {
  const button = document.querySelector("#test");
  const status = document.querySelector("#connectionStatus");
  button.disabled = true;
  status.classList.remove("error");
  status.textContent = "Checking…";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "testConnection",
      server: fields.server.value,
      apiKey: fields.apiKey.value
    });
    if (!response?.ok) throw new Error(response?.error || "Connection failed.");
    status.textContent = `Connected to ${response.name || "LANraragi"} ${response.version || ""}.`;
  } catch (error) {
    status.classList.add("error");
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function readForm() {
  return {
    server: fields.server.value.trim().replace(/\/+$/, ""),
    apiKey: fields.apiKey.value,
    enabled: fields.enabled.checked,
    matchByTitle: fields.matchByTitle.checked,
    concurrency: clamp(fields.concurrency.value, 1, 10, DEFAULTS.concurrency),
    cacheMinutes: clamp(fields.cacheMinutes.value, 1, 1440, DEFAULTS.cacheMinutes)
  };
}

function clamp(value, minimum, maximum, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}
