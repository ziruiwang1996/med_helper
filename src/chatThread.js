const CHAT_THREAD_STORAGE_KEY = "drug-helper:thread_id";

export function readStoredThreadId() {
  try {
    return sessionStorage.getItem(CHAT_THREAD_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function writeStoredThreadId(threadId) {
  try {
    const value = String(threadId || "").trim();
    if (!value) sessionStorage.removeItem(CHAT_THREAD_STORAGE_KEY);
    else sessionStorage.setItem(CHAT_THREAD_STORAGE_KEY, value);
  } catch {
    // Ignore storage failures (e.g., privacy mode)
  }
}

export function clearStoredThreadId() {
  try {
    sessionStorage.removeItem(CHAT_THREAD_STORAGE_KEY);
  } catch {
    // Ignore storage failures
  }
}

function generateThreadId() {
  try {
    if (typeof crypto === "object" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Ignore and fall back to manual generation
  }

  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `thread_${rand}_${time}`;
}

export function getOrCreateThreadId() {
  const existing = readStoredThreadId();
  if (existing) return existing;
  const next = generateThreadId();
  writeStoredThreadId(next);
  return next;
}

export { CHAT_THREAD_STORAGE_KEY };
