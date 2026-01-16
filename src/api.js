import { readStoredThreadId, writeStoredThreadId } from "./chatThread.js";

const DEFAULT_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://med-helper-v1.onrender.com/api";
//const DEFAULT_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";

// openFDA Drug Label endpoint
const OPENFDA_LABEL_ENDPOINT =
  import.meta.env.VITE_OPENFDA_LABEL_ENDPOINT || "https://api.fda.gov/drug/label.json";
const OPENFDA_API_KEY = import.meta.env.VITE_OPENFDA_API_KEY;

function resolveThreadIdInput(input, { fallbackToStored = true } = {}) {
  if (input !== undefined) {
    const trimmed = String(input ?? "").trim();
    return trimmed;
  }

  if (!fallbackToStored) return "";

  const stored = readStoredThreadId();
  return stored ? String(stored).trim() : "";
}

function persistThreadId(threadId) {
  const trimmed = String(threadId || "").trim();
  if (trimmed) writeStoredThreadId(trimmed);
}

function ensureThreadId(threadId) {
  if (!threadId) {
    throw new Error("Missing thread id. Please reload the app to start a new session.");
  }
  return threadId;
}

// Helper to build query params safely
function toQuery(params) {
  const usp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    const s = String(v).trim();
    if (!s) return;
    usp.set(k, s);
  });
  return usp.toString();
}

function quoteOpenFdaTerm(term) {
  // openFDA uses Lucene query syntax; quoting is the safest default for user input.
  const escaped = String(term)
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/\"/g, '\\"');
  return `"${escaped}"`;
}

function joinText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.filter(Boolean).join("\n\n");
  if (typeof value === "string") return value;
  return String(value);
}

async function openFdaFetch(params) {
  const url = new URL(OPENFDA_LABEL_ENDPOINT);
  const usp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    const s = String(v).trim();
    if (!s) return;
    usp.set(k, s);
  });
  if (OPENFDA_API_KEY && !usp.has("api_key")) usp.set("api_key", OPENFDA_API_KEY);
  url.search = usp.toString();

  const res = await fetch(url.toString());
  let data;
  try {
    data = await res.json();
  } catch {
    // Non-JSON response
    throw new Error(`openFDA request failed (${res.status})`);
  }

  if (!res.ok || data?.error) {
    const msg =
      data?.error?.message ||
      data?.error?.code ||
      `openFDA request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

function buildOpenFdaSearchQuery({ name, manufacturer, extra }) {
  const clauses = [];

  const trimmedName = String(name || "").trim();
  if (trimmedName) {
    const t = quoteOpenFdaTerm(trimmedName);
    clauses.push(
      [
        `openfda.brand_name:${t}`,
        `openfda.generic_name:${t}`,
        `openfda.substance_name:${t}`,
        `openfda.product_ndc:${t}`,
        `openfda.package_ndc:${t}`,
      ].join(" OR ")
    );
  }

  const trimmedManufacturer = String(manufacturer || "").trim();
  if (trimmedManufacturer) {
    const t = quoteOpenFdaTerm(trimmedManufacturer);
    clauses.push(`openfda.manufacturer_name:${t}`);
  }

  const trimmedExtra = String(extra || "").trim();
  if (trimmedExtra) {
    const t = quoteOpenFdaTerm(trimmedExtra);
    // Extra info is user-provided; search a broad but relevant text field.
    clauses.push(`spl_product_data_elements:${t}`);
  }

  // If nothing was provided, openFDA will reject an empty search.
  return clauses.map((c) => `(${c})`).join(" AND ");
}

// ---- Search for drug candidates ----
// Expected backend response example:
// { results: [ { id, brandName, genericName, manufacturer, strength, dosageForm } ] }
export async function searchDrugs({ name, manufacturer, extra }) {
  const search = buildOpenFdaSearchQuery({ name, manufacturer, extra });
  if (!search) {
    return { results: [] };
  }

  const data = await openFdaFetch({
    search,
    limit: 25,
    skip: 0,
    // Prefer newest label if multiple
    sort: "effective_time:desc",
  });

  const results = (data?.results || []).map((r) => {
    const openfda = r?.openfda || {};
    const brandName = openfda?.brand_name?.[0] || "";
    const genericName = openfda?.generic_name?.[0] || "";
    const manufacturerName = openfda?.manufacturer_name?.[0] || "";

    return {
      // Use set_id as the stable identifier for loading the label later.
      id: r?.set_id || r?.id,
      brandName,
      genericName,
      manufacturer: manufacturerName,
      // Optional fields (UI will hide if empty)
      strength: "",
      dosageForm: "",
      name: brandName || genericName,
    };
  });

  return { results };
}

// ---- Fetch drug label sections ----
// Expected backend response example:
// { drug: {...}, sections: [ { key, title, sourceText } ] }
export async function getDrugLabel(drugId) {
  const setId = String(drugId || "").trim();
  if (!setId) throw new Error("Missing drug id.");

  const data = await openFdaFetch({
    search: `set_id:${quoteOpenFdaTerm(setId)}`,
    limit: 1,
    skip: 0,
    sort: "effective_time:desc",
  });

  const record = data?.results?.[0];
  if (!record) throw new Error("No label found for that drug.");

  const openfda = record?.openfda || {};

  const drug = {
    id: setId,
    brandName: openfda?.brand_name?.[0] || "",
    genericName: openfda?.generic_name?.[0] || "",
    manufacturer: openfda?.manufacturer_name?.[0] || "",
    route: openfda?.route?.[0] || "",
    productNdc: openfda?.product_ndc?.[0] || "",
    packageNdc: openfda?.package_ndc?.[0] || "",
    effectiveTime: record?.effective_time || "",
  };

  const sections = [
    { key: "indications_and_usage", title: "Indications and Usage" },
    { key: "dosage_and_administration", title: "Dosage and Administration" },
    { key: "contraindications", title: "Contraindications" },
    { key: "warnings_and_precautions", title: "Warnings and Precautions" },
    { key: "adverse_reactions", title: "Adverse Reactions" },
    { key: "drug_interactions", title: "Drug Interactions" },
    { key: "use_in_specific_populations", title: "Use in Specific Populations" },
    { key: "overdosage", title: "Overdosage" },
    { key: "how_supplied", title: "How Supplied/Storage and Handling" },
  ].map((s) => ({
    ...s,
    sourceText: joinText(record?.[s.key]),
  }));

  return { drug, sections };
}

// ---- Explain a label section via LLM ----
// Request: { drug_name, section, content }
// Response example: { drug_name, section, interpretation }
export async function explainSection({ drugId, sectionKey, sourceText, drugName, thread_id } = {}) {
  const threadId = ensureThreadId(resolveThreadIdInput(thread_id));
  const url = `${DEFAULT_BASE_URL}/interpret`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      drug_name: drugName || drugId,
      section_name: sectionKey,
      section_content: sourceText,
      thread_id: threadId,
    }),
  });
  if (!res.ok) throw new Error(`Explain failed (${res.status})`);
  const data = await res.json();
  // Map backend response to expected format
  return {
    explanation: data.interpretation,
    drug_name: data.drug_name,
    section_name: data.section_name,
  };
}

// ---- Chat ----
// Request: { message, thread_id }
// Response: { response, thread_id }
// export async function chat({ message, thread_id }) {
//   const url = `${DEFAULT_BASE_URL}/chat/batch`;
//   const res = await fetch(url, {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({ message, thread_id }),
//   });
//   if (!res.ok) throw new Error(`Chat failed (${res.status})`);
//   return res.json();
// }

export async function chat({ message, thread_id } = {}) {
  const threadId = ensureThreadId(resolveThreadIdInput(thread_id));
  const url = `${DEFAULT_BASE_URL}/chat/batch`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, thread_id: threadId }),
  });

  if (!res.ok) {
    const detail = await res.text(); // <-- this will include FastAPI's {"detail": "..."}
    throw new Error(`Chat failed (${res.status}): ${detail}`);
  }
  const data = await res.json();
  if (data?.thread_id || data?.threadId) persistThreadId(data.thread_id || data.threadId);
  return data;
}

// ---- Chat Stream ----
// Request: { message, thread_id }
// Response: Server-Sent Events stream
export async function chatStream({ message, thread_id } = {}) {
  const threadId = ensureThreadId(resolveThreadIdInput(thread_id));
  const url = `${DEFAULT_BASE_URL}/chat/stream`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, thread_id: threadId }),
  });
  if (!res.ok) throw new Error(`Chat stream failed (${res.status})`);
  return res;
}

// ---- Initialize Chat ----
// Request: { thread_id }
// Response: { thread_id, status, chat_initialized }
export async function initializeChat({ thread_id } = {}) {
  const resolvedThreadId = resolveThreadIdInput(thread_id);
  const url = `${DEFAULT_BASE_URL}/chat/initialize`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ thread_id: resolvedThreadId }),
  });
  if (!res.ok) throw new Error(`Chat initialization failed (${res.status})`);
  const data = await res.json();
  if (data?.thread_id || data?.threadId) persistThreadId(data.thread_id || data.threadId);
  return data;
}


// ---- Reset Chat Thread ----
// Request: { thread_id } (optional)
// Response: { thread_id, message, documents_cleared, cache_stats }
export async function resetChat({ thread_id } = {}) {
  const resolvedThreadId = ensureThreadId(resolveThreadIdInput(thread_id));
  const url = `${DEFAULT_BASE_URL}/chat/reset`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ thread_id: resolvedThreadId }),
  });
  if (!res.ok) throw new Error(`Chat reset failed (${res.status})`);
  const data = await res.json();
  if (data?.thread_id || data?.threadId) persistThreadId(data.thread_id || data.threadId);
  return data;
}

// ---- Upload Document ----
// Request: FormData with 'file' and 'thread_id'
// Response: { message, document, thread_id }
export async function uploadDocument({ file, thread_id } = {}) {
  const resolvedThreadId = ensureThreadId(resolveThreadIdInput(thread_id));
  const url = `${DEFAULT_BASE_URL}/chat/documents/upload`;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('thread_id', resolvedThreadId);
  
  const res = await fetch(url, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(`Document upload failed (${res.status})`);
  const data = await res.json();
  if (data?.thread_id || data?.threadId) persistThreadId(data.thread_id || data.threadId);
  return data;
}

// ---- List Documents ----
// Response: { thread_id, documents, count }
export async function listDocuments(thread_id) {
  const resolvedThreadId = ensureThreadId(resolveThreadIdInput(thread_id));
  const url = `${DEFAULT_BASE_URL}/chat/documents/list/${resolvedThreadId}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to list documents (${res.status})`);
  const data = await res.json();
  if (data?.thread_id || data?.threadId) persistThreadId(data.thread_id || data.threadId);
  return data;
}

// ---- Clear Documents ----
// Response: { thread_id, message, documents_removed }
export async function clearDocuments(thread_id) {
  const resolvedThreadId = ensureThreadId(resolveThreadIdInput(thread_id));
  const url = `${DEFAULT_BASE_URL}/chat/documents/clear/${resolvedThreadId}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to clear documents (${res.status})`);
  const data = await res.json();
  if (data?.thread_id || data?.threadId) persistThreadId(data.thread_id || data.threadId);
  return data;
}

// ---- Evidence Report ----
// This UI feature is optional; if the backend doesn't implement it yet,
// we return a clear error that the UI can display.
export async function generatePersonalReport({ drugId, drugName, context, thread_id } = {}) {
  const threadId = ensureThreadId(resolveThreadIdInput(thread_id));
  const trimmedId = String(drugId || "").trim();
  if (!trimmedId) throw new Error("Missing drug id for evidence report.");

  const ctx = context || {};
  const age = typeof ctx.ageRange === "string" ? ctx.ageRange : "";
  const sex = typeof ctx.sex === "string" ? ctx.sex : "";
  const rawWeight = ctx.weight != null ? String(ctx.weight).trim() : "";
  const unit = ctx.weightUnit === "lb" ? "lb" : "kg";
  const weight = rawWeight ? `${rawWeight} ${unit}` : "";

  const payload = {
    drug_set_id: trimmedId,
    drug_name: drugName || "",
    age,
    sex,
    weight,
    is_pregnant: ctx.pregnant === "yes",
    is_breastfeeding: ctx.breastfeeding === "yes",
  };

  const conditions = typeof ctx.conditions === "string" ? ctx.conditions.trim() : "";
  if (conditions) payload.conditions = conditions;
  const otherMeds = typeof ctx.otherMeds === "string" ? ctx.otherMeds.trim() : "";
  if (otherMeds) payload.other_medications = otherMeds;
  payload.thread_id = threadId;

  const url = `${DEFAULT_BASE_URL}/evidence`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    // Common case during local dev: backend route not implemented.
    if (res.status === 404) {
      throw new Error(
        "Evidence report endpoint is not available on the backend (expected POST /evidence)."
      );
    }
    throw new Error(`Evidence report failed (${res.status})`);
  }

  const data = await res.json();
  if (data?.thread_id || data?.threadId) persistThreadId(data.thread_id || data.threadId);
  const responseDrugId = data?.drug_set_id || "";
  const responseDrugName = data?.drug_name || "";
  const summary = typeof data?.summary === "string" ? data.summary.trim() : "";
  const faersReport = typeof data?.faers_report === "string" ? data.faers_report.trim() : "";
  const rweReport = typeof data?.rwe_report === "string" ? data.rwe_report.trim() : "";
  const trialsReport = typeof data?.clinical_trials_report === "string" ? data.clinical_trials_report.trim() : "";

  const sections = [];
  if (faersReport) sections.push({ key: "faers_report", title: "FAERS safety signals", content: faersReport });
  if (rweReport) sections.push({ key: "rwe_report", title: "Real-world evidence", content: rweReport });
  if (trialsReport) sections.push({ key: "clinical_trials_report", title: "Clinical trials", content: trialsReport });

  return {
    summary,
    drugSetId: responseDrugId || trimmedId,
    drugName: responseDrugName || drugName || "",
    faersReport: faersReport || null,
    rweReport: rweReport || null,
    clinicalTrialsReport: trialsReport || null,
    sections,
    raw: data,
  };
}
