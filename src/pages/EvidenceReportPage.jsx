import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { generatePersonalReport } from "../api.js";

export default function EvidenceReportPage() {
  const { drugId } = useParams();
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
  function getReportCacheKey(drugId, context) {
    // Context can affect report, so include a hash of context
    return `evidenceReport_${drugId}_${btoa(JSON.stringify(context))}`;
  }

  function loadReport(drugId, context) {
    try {
      const raw = sessionStorage.getItem(getReportCacheKey(drugId, context));
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  }

  function saveReport(drugId, context, data) {
    try {
      sessionStorage.setItem(getReportCacheKey(drugId, context), JSON.stringify(data));
    } catch {}
  }

  const [reportStatus, setReportStatus] = useState("idle");
  const [reportError, setReportError] = useState("");
  const [reportData, setReportData] = useState(() => loadReport(drugId, context));

  async function onGenerateReport() {
    setReportStatus("loading");
    setReportError("");
    setReportData(null);
    try {
      const data = await generatePersonalReport({ drugId, context });
      setReportData(data);
      setReportStatus("success");
      saveReport(drugId, context, data);
    } catch (err) {
      setReportStatus("error");
      setReportError(err?.message || "Report failed.");
    }
  }
  // Load cached report if context changes
  useEffect(() => {
    const cached = loadReport(drugId, context);
    if (cached) {
      setReportData(cached);
      setReportStatus("success");
    }
  }, [drugId, context]);

  return (
    <div className="page evidence-report-page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Contextual Evidence Report</h1>
        <Link to={`/drug/${drugId}`} className="btn btnSecondary">Close</Link>
      </div>
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

          {reportData.sections?.map((section) => (
            <div key={section.key} style={{ marginTop: 12 }}>
              <div className="subhead">{section.title}</div>
              <div>{typeof section.content === 'string' ? <p className="para">{section.content}</p> : null}</div>
            </div>
          ))}

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
    </div>
  );
}
