import React from "react";
import { Link, useLocation } from "react-router-dom";

export default function Layout({ children }) {
  const loc = useLocation();

  return (
    <div className="appShell">
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
