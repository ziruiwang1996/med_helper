import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { searchDrugs } from "../api.js";

export default function SearchPage() {
  const nav = useNavigate();

  const [name, setName] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [extra, setExtra] = useState("");

  const [status, setStatus] = useState("idle"); // idle | loading | error | success
  const [error, setError] = useState("");
  const [results, setResults] = useState([]);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setResults([]);

    const trimmed = name.trim();
    if (!trimmed) {
      setError("Please enter a drug name (brand or generic).");
      return;
    }

    setStatus("loading");
    try {
      const data = await searchDrugs({ name: trimmed, manufacturer, extra });
      const r = data?.results || [];
      setResults(r);
      setStatus("success");

      // If backend returns a single confident match, you can auto-navigate:
      // if (r.length === 1) nav(`/drug/${encodeURIComponent(r[0].id)}`);
    } catch (err) {
      setStatus("error");
      setError(err?.message || "Search failed.");
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <h1 className="h1">Understand your medication</h1>
        <p className="muted">
          Search a drug, read the official label sections, and generate plain-language explanations.
        </p>
      </div>

      <form className="card" onSubmit={onSubmit}>
        <div className="grid2">
          <div className="field">
            <label className="label">Drug name *</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Lisinopril / Zoloft / Metformin"
            />
          </div>

          <div className="field">
            <label className="label">Manufacturer (optional)</label>
            <input
              className="input"
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
              placeholder="e.g., Pfizer, Teva"
            />
          </div>

          <div className="field colSpan2">
            <label className="label">Additional info (optional)</label>
            <input
              className="input"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="Strength, dosage form, route, NDC, or anything you know"
            />
            <div className="help">
              Tip: If you’re not sure about manufacturer or strength, leave it blank. You can refine after.
            </div>
          </div>
        </div>

        {error ? (
          <div className="alert alertError">
            <div className="alertTitle">Action needed</div>
            <div className="alertText">{error}</div>
          </div>
        ) : null}

        <div className="actions">
          <button className="btn" type="submit" disabled={status === "loading"}>
            {status === "loading" ? "Searching..." : "Search"}
          </button>
        </div>
      </form>

      <div className="spacer" />

      {status === "success" && (
        <div className="card">
          <div className="cardHeader">
            <h2 className="cardTitle">Results</h2>
            <div className="muted small">
              Select the matching product to view label sections.
            </div>
          </div>

          {results.length === 0 ? (
            <div className="muted">
              No results returned. Try removing manufacturer/extra info or using a generic name.
            </div>
          ) : (
            <div className="list">
              {results.map((r) => (
                <button
                  key={r.id}
                  className="listItem"
                  onClick={() => nav(`/drug/${encodeURIComponent(r.id)}`)}
                >
                  <div className="listTitle">
                    {r.brandName || r.genericName || r.name || "Unknown drug"}
                  </div>
                  <div className="muted small">
                    {[
                      r.genericName ? `Generic: ${r.genericName}` : null,
                      r.manufacturer ? `Manufacturer: ${r.manufacturer}` : null,
                      r.strength ? `Strength: ${r.strength}` : null,
                      r.dosageForm ? `Form: ${r.dosageForm}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
