import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  getDrugLabel,
  explainSection,
  generatePersonalReport,
  chatStream,
  initializeChat,
  resetChat,
  uploadDocument,
  listDocuments,
  clearDocuments,
} from "../api.js";
import SectionCard from "../components/SectionCard.jsx";
import FloatingActions from "../components/FloatingActions.jsx";
import Drawer from "../components/Drawer.jsx";

const CHAT_THREAD_STORAGE_KEY = "drug-helper:thread_id";

function readStoredThreadId() {
  try {
    return sessionStorage.getItem(CHAT_THREAD_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function writeStoredThreadId(threadId) {
  try {
    const value = String(threadId || "").trim();
    if (!value) sessionStorage.removeItem(CHAT_THREAD_STORAGE_KEY);
    else sessionStorage.setItem(CHAT_THREAD_STORAGE_KEY, value);
  } catch {
    // Ignore storage failures (e.g., privacy mode)
  }
}

function normalizeSections(incomingSections) {
  // If backend doesn't provide sections yet, fall back to standard FDA headings
  if (Array.isArray(incomingSections) && incomingSections.length) return incomingSections;

  return [
    { key: "indications_and_usage", title: "Indications and Usage", sourceText: "" },
    { key: "dosage_and_administration", title: "Dosage and Administration", sourceText: "" },
    { key: "contraindications", title: "Contraindications", sourceText: "" },
    { key: "warnings_and_precautions", title: "Warnings and Precautions", sourceText: "" },
    { key: "adverse_reactions", title: "Adverse Reactions", sourceText: "" },
    { key: "drug_interactions", title: "Drug Interactions", sourceText: "" },
    { key: "use_in_specific_populations", title: "Use in Specific Populations", sourceText: "" },
    { key: "overdosage", title: "Overdosage", sourceText: "" },
    { key: "how_supplied", title: "How Supplied/Storage and Handling", sourceText: "" },
  ];
}

export default function DrugLabelPage() {
  const { drugId } = useParams();

  const [pageStatus, setPageStatus] = useState("loading"); // loading | error | ready
  const [pageError, setPageError] = useState("");
  const [drug, setDrug] = useState(null);
  const [sections, setSections] = useState([]);

  // Per-section UI state
  const [showSourceMap, setShowSourceMap] = useState({});
  const [showExplanationMap, setShowExplanationMap] = useState({});
  const [explainMap, setExplainMap] = useState({}); // { [key]: { status, data, error } }

  // Floating drawers
  const [reportOpen, setReportOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  // Personalized report state
  const [reportStatus, setReportStatus] = useState("idle");
  const [reportError, setReportError] = useState("");
  const [reportData, setReportData] = useState(null);
  const [context, setContext] = useState({
    ageRange: "",
    sex: "",
    weight: "",
    weightUnit: "kg",
    pregnant: "unknown",
    breastfeeding: "unknown",
    conditions: "",
    otherMeds: "",
  });

  // Chat state
  const [chatStatus, setChatStatus] = useState("idle");
  const [chatError, setChatError] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatThreadId, setChatThreadId] = useState(() => readStoredThreadId());
  const [docsStatus, setDocsStatus] = useState("idle");
  const [docsError, setDocsError] = useState("");
  const [documents, setDocuments] = useState([]);
  const [uploadStatus, setUploadStatus] = useState("idle");
  const [uploadError, setUploadError] = useState("");
  const [resetStatus, setResetStatus] = useState("idle");
  const [resetError, setResetError] = useState("");
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "I can help explain this medication’s FDA label sections and safety information. I cannot provide medical advice. What would you like to understand?",
    },
  ]);

  // --- Client-side "word streaming" ---
  // Even if the backend buffers and sends the assistant response in one large chunk,
  // this will reveal it progressively so it looks like streaming.
  const typingIntervalRef = useRef(null);
  const typingQueueRef = useRef("");
  const typingDoneRef = useRef(false);
  const typingResolveRef = useRef(null);

  function appendToLastAssistant(text) {
    if (!text) return;
    setMessages((prev) => {
      const next = [...prev];
      const lastIndex = next.length - 1;
      if (lastIndex >= 0 && next[lastIndex]?.role === "assistant") {
        next[lastIndex] = {
          ...next[lastIndex],
          content: String(next[lastIndex].content || "") + text,
        };
      } else {
        next.push({ role: "assistant", content: String(text) });
      }
      return next;
    });
  }

  function stopTyping({ resolve = true } = {}) {
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
    typingQueueRef.current = "";
    typingDoneRef.current = true;
    if (resolve && typeof typingResolveRef.current === "function") {
      typingResolveRef.current();
      typingResolveRef.current = null;
    }
  }

  function beginTyping() {
    stopTyping({ resolve: false });

    typingQueueRef.current = "";
    typingDoneRef.current = false;

    // Create a promise that resolves once the queue is empty and we mark done.
    const p = new Promise((resolve) => {
      typingResolveRef.current = resolve;
    });

    // Drain the queue every ~30ms, adding 1–6 tokens depending on backlog.
    typingIntervalRef.current = setInterval(() => {
      const queue = typingQueueRef.current;
      if (!queue) {
        if (typingDoneRef.current && typeof typingResolveRef.current === "function") {
          typingResolveRef.current();
          typingResolveRef.current = null;
          stopTyping({ resolve: false });
        }
        return;
      }

      const backlog = queue.length;
      const tokenCount = backlog > 800 ? 6 : backlog > 200 ? 3 : 1;

      let consumed = 0;
      let out = "";
      let rest = queue;

      for (let i = 0; i < tokenCount; i++) {
        if (!rest) break;
        const match = rest.match(/^\s*\S+\s*/);
        if (!match) break;
        out += match[0];
        consumed += match[0].length;
        rest = rest.slice(match[0].length);
      }

      // Fallback to a few characters if we couldn't find a token boundary.
      if (!out) {
        out = queue.slice(0, Math.min(12, queue.length));
        consumed = out.length;
      }

      typingQueueRef.current = queue.slice(consumed);
      appendToLastAssistant(out);

      if (!typingQueueRef.current && typingDoneRef.current && typeof typingResolveRef.current === "function") {
        typingResolveRef.current();
        typingResolveRef.current = null;
        stopTyping({ resolve: false });
      }
    }, 30);

    return p;
  }

  function enqueueAssistantText(text) {
    if (!text) return;
    typingQueueRef.current += String(text);
  }

  function markTypingDone() {
    typingDoneRef.current = true;
  }

  useEffect(() => {
    return () => {
      stopTyping({ resolve: false });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    writeStoredThreadId(chatThreadId);
  }, [chatThreadId]);

  async function ensureChatInitialized() {
    const data = await initializeChat({ thread_id: chatThreadId || "" });
    const nextId = data?.thread_id || data?.threadId || "";
    if (!nextId) throw new Error("Chat initialization failed (missing thread id).");
    if (nextId !== chatThreadId) setChatThreadId(nextId);
    return nextId;
  }

  async function refreshDocuments(thread_id) {
    setDocsError("");
    setDocsStatus("loading");
    try {
      const data = await listDocuments(thread_id);
      setDocuments(Array.isArray(data?.documents) ? data.documents : []);
      setDocsStatus("success");
    } catch (err) {
      setDocsStatus("error");
      setDocsError(err?.message || "Failed to load documents.");
    }
  }

  useEffect(() => {
    if (!chatOpen) return;
    let cancelled = false;

    (async () => {
      try {
        const thread_id = await ensureChatInitialized();
        if (cancelled) return;
        await refreshDocuments(thread_id);
      } catch (err) {
        if (cancelled) return;
        setChatError(err?.message || "Chat initialization failed.");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatOpen]);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setPageStatus("loading");
      setPageError("");
      try {
        const data = await getDrugLabel(drugId);
        if (!mounted) return;

        setDrug(data?.drug || { id: drugId });
        const normalized = normalizeSections(data?.sections);
        setSections(normalized);
        setPageStatus("ready");
      } catch (err) {
        if (!mounted) return;
        setPageStatus("error");
        setPageError(err?.message || "Failed to load label.");
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [drugId]);

  const drugTitle = useMemo(() => {
    if (!drug) return "Medication";
    return drug.brandName || drug.genericName || drug.name || "Medication";
  }, [drug]);

  function formatEvidenceLabel(label) {
    return String(label || "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (match) => match.toUpperCase());
  }

  function renderEvidenceContent(content) {
    if (content == null) return null;

    if (Array.isArray(content)) {
      const items = content
        .map((item) => (typeof item === "string" ? item.trim() : String(item)))
        .filter(Boolean);
      if (!items.length) return null;
      return (
        <ul className="bullets">
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      );
    }

    if (typeof content === "string") {
      const paragraphs = content
        .split(/\n+/)
        .map((text) => text.trim())
        .filter(Boolean);
      if (!paragraphs.length) return null;
      return paragraphs.map((text, index) => (
        <p key={index} className="para">
          {text}
        </p>
      ));
    }

    if (typeof content === "object") {
      const entries = Object.entries(content).filter(([, value]) => value != null && value !== "");
      if (!entries.length) return null;
      return (
        <div className="stack" style={{ gap: 8 }}>
          {entries.map(([key, value]) => (
            <div key={key}>
              <div className="muted small">{formatEvidenceLabel(key)}</div>
              {renderEvidenceContent(value) || (
                <p className="para">{String(value)}</p>
              )}
            </div>
          ))}
        </div>
      );
    }

    return <p className="para">{String(content)}</p>;
  }

  async function onExplain(section) {
    const key = section.key;
    setExplainMap((prev) => ({
      ...prev,
      [key]: { status: "loading", data: null, error: "" },
    }));

    try {
      const data = await explainSection({
        drugId,
        sectionKey: key,
        sourceText: section.sourceText || "",
      });

      setExplainMap((prev) => ({
        ...prev,
        [key]: { status: "success", data, error: "" },
      }));
    } catch (err) {
      setExplainMap((prev) => ({
        ...prev,
        [key]: { status: "error", data: null, error: err?.message || "Explain failed." },
      }));
    }
  }

  async function onGenerateReport() {
    setReportStatus("loading");
    setReportError("");
    setReportData(null);

    try {
      const data = await generatePersonalReport({ drugId, drugName: drugTitle, context });
      setReportData(data);
      setReportStatus("success");
    } catch (err) {
      setReportStatus("error");
      setReportError(err?.message || "Report failed.");
    }
  }

  async function onSendChat() {
    const text = chatInput.trim();
    if (!text) return;

    setChatError("");
    setChatStatus("loading");

    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setChatInput("");

    // Create an assistant placeholder that we will stream into.
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    const typingDone = beginTyping();

    try {
      const thread_id = await ensureChatInitialized();
      const res = await chatStream({ message: text, thread_id });

      const contentType = String(res.headers.get("content-type") || "");
      const reader = res.body?.getReader?.();

      // Fallback: if the endpoint doesn't actually stream (e.g. returns JSON/text in one go),
      // we still render it progressively using the client-side typing queue.
      if (!reader || (contentType && !contentType.includes("text/event-stream") && contentType.includes("application/json"))) {
        const raw = await res.text();
        let fullText = raw;
        try {
          const parsed = JSON.parse(raw);
          const nextId = parsed?.thread_id || parsed?.threadId;
          if (nextId && nextId !== chatThreadId) setChatThreadId(nextId);
          fullText = parsed?.response || parsed?.content || parsed?.message || "";
        } catch {
          // Not JSON; keep raw as-is.
        }

        enqueueAssistantText(fullText);
        markTypingDone();
        await typingDone;
        setChatStatus("idle");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";

        for (const frame of frames) {
          const lines = frame.split("\n");
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;

            let evt;
            try {
              evt = JSON.parse(payload);
            } catch {
              continue;
            }

            if (evt?.type === "thread_id" && evt?.thread_id) {
              if (evt.thread_id !== chatThreadId) setChatThreadId(evt.thread_id);
            } else if (evt?.type === "content" && typeof evt?.content === "string") {
              enqueueAssistantText(evt.content);
            } else if (evt?.type === "error") {
              throw new Error(evt?.content || "Chat stream error.");
            } else if (evt?.type === "done") {
              // no-op; loop will end when stream closes
            }
          }
        }
      }

      markTypingDone();
      await typingDone;

      setChatStatus("idle");
      // Optional: refresh docs after a chat turn (if tools added/removed docs)
      try {
        const activeThreadId = chatThreadId || thread_id;
        if (activeThreadId) await refreshDocuments(activeThreadId);
      } catch {
        // ignore
      }
    } catch (err) {
      stopTyping();
      setChatStatus("error");
      setChatError(err?.message || "Chat failed.");
    }
  }

  async function onResetChat() {
    setResetError("");
    setResetStatus("loading");
    try {
      const thread_id = await ensureChatInitialized();
      await resetChat({ thread_id });
      setMessages([
        {
          role: "assistant",
          content:
            "I can help explain this medication’s FDA label sections and safety information. I cannot provide medical advice. What would you like to understand?",
        },
      ]);
      setChatError("");
      setChatStatus("idle");
      setResetStatus("success");
      await refreshDocuments(thread_id);
    } catch (err) {
      setResetStatus("error");
      setResetError(err?.message || "Reset failed.");
    }
  }

  async function onUploadDoc(file) {
    if (!file) return;
    setUploadError("");
    setUploadStatus("loading");
    try {
      const thread_id = await ensureChatInitialized();
      await uploadDocument({ file, thread_id });
      setUploadStatus("success");
      await refreshDocuments(thread_id);
    } catch (err) {
      setUploadStatus("error");
      setUploadError(err?.message || "Upload failed.");
    }
  }

  async function onClearDocs() {
    setDocsError("");
    setDocsStatus("loading");
    try {
      const thread_id = await ensureChatInitialized();
      await clearDocuments(thread_id);
      await refreshDocuments(thread_id);
    } catch (err) {
      setDocsStatus("error");
      setDocsError(err?.message || "Failed to clear documents.");
    }
  }

  if (pageStatus === "loading") {
    return (
      <div className="page">
        <div className="card">
          <div className="muted">Loading drug label…</div>
        </div>
      </div>
    );
  }

  if (pageStatus === "error") {
    return (
      <div className="page">
        <div className="card">
          <div className="alert alertError">
            <div className="alertTitle">Unable to load medication</div>
            <div className="alertText">{pageError}</div>
          </div>
          <div className="actions">
            <Link className="btn btnSecondary" to="/">
              Back to search
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div className="breadcrumb">
          <Link to="/" className="link">
            Search
          </Link>
          <span className="muted"> / </span>
          <span className="muted">{drugTitle}</span>
        </div>

        <h1 className="h1">{drugTitle}</h1>

        <div className="muted">
          Review official label sections and generate plain-language explanations per section.
        </div>

        <div className="alert alertInfo" style={{ marginTop: 12 }}>
          <div className="alertTitle">Important</div>
          <div className="alertText">
            This tool is for education. It does not replace clinical advice. If symptoms are severe or urgent,
            seek medical care.
          </div>
        </div>
      </div>

      <div className="stack">
        {sections.map((s) => (
          <SectionCard
            key={s.key}
            title={s.title}
            sourceText={s.sourceText}
            explanationState={explainMap[s.key] || { status: "idle" }}
            onExplain={() => onExplain(s)}
            showSource={!!showSourceMap[s.key]}
            onToggleSource={() =>
              setShowSourceMap((prev) => ({ ...prev, [s.key]: !prev[s.key] }))
            }
            showExplanation={!!showExplanationMap[s.key]}
            onToggleExplanation={() =>
              setShowExplanationMap((prev) => {
                const current = !!prev[s.key];
                return { ...prev, [s.key]: !current };
              })
            }
          />
        ))}
      </div>

      <FloatingActions onOpenReport={() => setReportOpen(true)} onOpenChat={() => setChatOpen(true)} />

      {/* Personalized report drawer */}
      <Drawer open={reportOpen} title="Contextual Evidence Report" onClose={() => setReportOpen(false)}>
        <div className="muted small">
          Optional. Share a bit about yourself to generate a tailored educational summary. Not medical advice.
        </div>

        <div className="spacerSm" />

        <div className="field">
          <label className="label">Age range</label>
          <select
            className="input"
            value={context.ageRange}
            onChange={(e) => setContext((c) => ({ ...c, ageRange: e.target.value }))}
          >
            <option value="">Prefer not to say</option>
            <option value="0-12">0–12</option>
            <option value="13-17">13–17</option>
            <option value="18-24">18–24</option>
            <option value="25-44">25–44</option>
            <option value="45-64">45–64</option>
            <option value="65+">65+</option>
          </select>
        </div>

        <div className="field">
          <label className="label">Sex</label>
          <select
            className="input"
            value={context.sex}
            onChange={(e) => setContext((c) => ({ ...c, sex: e.target.value }))}
          >
            <option value="">Prefer not to say</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="intersex">Intersex</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div className="grid2">
          <div className="field">
            <label className="label">Weight (optional)</label>
            <input
              className="input"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.1"
              value={context.weight}
              onChange={(e) => setContext((c) => ({ ...c, weight: e.target.value }))}
              placeholder={context.weightUnit === "lb" ? "e.g., 160" : "e.g., 72"}
            />
          </div>

          <div className="field">
            <label className="label">Unit</label>
            <select
              className="input"
              value={context.weightUnit}
              onChange={(e) => setContext((c) => ({ ...c, weightUnit: e.target.value }))}
            >
              <option value="kg">kg</option>
              <option value="lb">lb</option>
            </select>
          </div>
        </div>

        <div className="grid2">
          <div className="field">
            <label className="label">Pregnant</label>
            <select
              className="input"
              value={context.pregnant}
              onChange={(e) => setContext((c) => ({ ...c, pregnant: e.target.value }))}
            >
              <option value="unknown">Unknown</option>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </div>

          <div className="field">
            <label className="label">Breastfeeding</label>
            <select
              className="input"
              value={context.breastfeeding}
              onChange={(e) => setContext((c) => ({ ...c, breastfeeding: e.target.value }))}
            >
              <option value="unknown">Unknown</option>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label className="label">Conditions (optional)</label>
          <textarea
            className="input"
            rows={3}
            value={context.conditions}
            onChange={(e) => setContext((c) => ({ ...c, conditions: e.target.value }))}
            placeholder="e.g., diabetes, high blood pressure, kidney disease"
          />
        </div>

        <div className="field">
          <label className="label">Other medications (optional)</label>
          <textarea
            className="input"
            rows={3}
            value={context.otherMeds}
            onChange={(e) => setContext((c) => ({ ...c, otherMeds: e.target.value }))}
            placeholder="List other meds/supplements you take"
          />
        </div>

        {reportError ? (
          <div className="alert alertError">
            <div className="alertTitle">Report error</div>
            <div className="alertText">{reportError}</div>
          </div>
        ) : null}

        <div className="actions">
          <button className="btn" onClick={onGenerateReport} disabled={reportStatus === "loading"}>
            {reportStatus === "loading" ? "Generating..." : "Generate report"}
          </button>
        </div>

        {reportStatus === "success" && reportData ? (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="cardHeader">
              <div className="cardTitle">Your educational summary</div>
            </div>
            {reportData.summary ? <p className="para">{reportData.summary}</p> : null}

            {reportData.sections?.map((section) => {
              const content = renderEvidenceContent(section.content);
              if (!content) return null;
              return (
                <div key={section.key} style={{ marginTop: 12 }}>
                  <div className="subhead">{section.title}</div>
                  <div>{content}</div>
                </div>
              );
            })}

            {reportData.risks?.length ? (
              <>
                <div className="subhead">Potential concerns</div>
                <ul className="bullets">
                  {reportData.risks.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </>
            ) : null}

            {reportData.recommendations?.length ? (
              <>
                <div className="subhead">Questions to ask your clinician</div>
                <ul className="bullets">
                  {reportData.recommendations.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </>
            ) : null}

            <div className="muted small" style={{ marginTop: 8 }}>
              {reportData.disclaimer || "Not medical advice. Confirm decisions with a clinician."}
            </div>
          </div>
        ) : null}
      </Drawer>

      {/* Chatbot drawer */}
      <Drawer open={chatOpen} title="Chat about this medication" onClose={() => setChatOpen(false)} width={520}>
        <div className="alert alertInfo">
          <div className="alertTitle">Scope</div>
          <div className="alertText">
            I can explain the FDA label sections and general safety information. I cannot diagnose or prescribe.
          </div>
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <div className="cardHeader" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div className="cardTitle">RAG documents</div>
              <div className="muted small">
                Thread: {chatThreadId ? chatThreadId : "(not initialized yet)"}
              </div>
            </div>
            <div className="actions" style={{ marginTop: 0 }}>
              <button className="btn btnSecondary" onClick={onResetChat} disabled={resetStatus === "loading"}>
                {resetStatus === "loading" ? "Resetting..." : "Reset chat"}
              </button>
              <button className="btn btnSecondary" onClick={onClearDocs} disabled={docsStatus === "loading"}>
                Clear docs
              </button>
            </div>
          </div>

          {resetError ? (
            <div className="alert alertError">
              <div className="alertTitle">Reset error</div>
              <div className="alertText">{resetError}</div>
            </div>
          ) : null}

          {docsError ? (
            <div className="alert alertError">
              <div className="alertTitle">Documents error</div>
              <div className="alertText">{docsError}</div>
            </div>
          ) : null}

          {uploadError ? (
            <div className="alert alertError">
              <div className="alertTitle">Upload error</div>
              <div className="alertText">{uploadError}</div>
            </div>
          ) : null}

          <div className="field" style={{ marginTop: 8 }}>
            <label className="label">Upload a document</label>
            <input
              className="input"
              type="file"
              disabled={uploadStatus === "loading"}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                onUploadDoc(f);
              }}
            />
            <div className="help">
              {uploadStatus === "loading"
                ? "Uploading..."
                : "Upload a supported file type to use for retrieval-augmented answers."}
            </div>
          </div>

          <div className="subhead">Current documents ({documents.length})</div>
          {docsStatus === "loading" ? (
            <div className="muted">Loading documents…</div>
          ) : documents.length ? (
            <ul className="bullets">
              {documents.map((d, i) => (
                <li key={d?.id || d?.filename || i}>
                  {d?.filename || d?.name || "Document"}
                </li>
              ))}
            </ul>
          ) : (
            <div className="muted">No documents uploaded yet.</div>
          )}
        </div>

        <div className="chatLog">
          {messages.map((m, idx) => (
            <div key={idx} className={m.role === "user" ? "chatMsg user" : "chatMsg assistant"}>
              <div className="chatRole">{m.role === "user" ? "You" : "Assistant"}</div>
              <div className="chatText">{m.content}</div>
            </div>
          ))}
        </div>

        {chatError ? (
          <div className="alert alertError">
            <div className="alertTitle">Chat error</div>
            <div className="alertText">{chatError}</div>
          </div>
        ) : null}

        <div className="chatComposer">
          <input
            className="input"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Ask a question about this drug..."
            onKeyDown={(e) => {
              if (e.key === "Enter") onSendChat();
            }}
          />
          <button className="btn" onClick={onSendChat} disabled={chatStatus === "loading"}>
            {chatStatus === "loading" ? "Sending..." : "Send"}
          </button>
        </div>

        <div className="muted small" style={{ marginTop: 8 }}>
          Suggested: “What does the warning section mean?”, “What side effects should I watch for?”, “Any common interactions?”
        </div>
      </Drawer>
    </div>
  );
}
