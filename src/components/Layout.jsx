import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

const DEV_NOTICE_KEY = "drug-helper:dev-notice";

export default function Layout({ children }) {
  const loc = useLocation();
  const [showNotice, setShowNotice] = useState(false);

  useEffect(() => {
    setShowNotice(true); // Always show notice on app start
  }, []);

  function dismissNotice() {
    setShowNotice(false);
  }

  return (
    <div className="appShell">
      {showNotice ? (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="dev-notice-title">
          <div className="backdrop" onClick={dismissNotice} />
          <div className="modalCard" role="document" onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div className="modalTitle" id="dev-notice-title">
                Exploration project notice
              </div>
            </div>
            <div className="modalBody">
              <p>This tool is still under active development and the agent workflow remains experimental.</p>
              <p>Responses depend on free-tier serverless inference with tight token and rate limits, so interruptions can occur.</p>
              <p>Server instance will spin down with inactivity, which can delay requests by 50 seconds or more.</p>
              <p><strong>Do not trust the AI agent for decisions; treat all outputs as unverified exploratory content.</strong></p>
            </div>
            <div className="modalActions">
              <button className="btn" onClick={dismissNotice}>
                I understand
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <header className="topbar">
        <div className="topbarInner">
          <Link to="/" className="brand">
            MedLabel Interpreter
          </Link>
          <nav className="nav">
            <Link to="/" className={loc.pathname === "/" ? "navLink active" : "navLink"}>
              Search
            </Link>
          </nav>
        </div>
      </header>

      <main className="content">{children}</main>

      <footer className="footer">
        <div className="footerInner">
          <span className="muted">
            Educational tool only. Not medical advice. Verify with your clinician and the official label.
          </span>
        </div>
      </footer>
    </div>
  );
}
