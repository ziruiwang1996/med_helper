import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import SearchPage from "./pages/SearchPage.jsx";
import DrugLabelPage from "./pages/DrugLabelPage.jsx";
import EvidenceReportPage from "./pages/EvidenceReportPage.jsx";
import Layout from "./components/Layout.jsx";
import { getOrCreateThreadId } from "./chatThread.js";

export default function App() {
  const [showWarning, setShowWarning] = useState(true);

  useEffect(() => {
    try {
      getOrCreateThreadId();
    } catch (err) {
      console.error("Failed to prepare chat thread id", err);
    }
    setShowWarning(true); // Show warning on app start
  }, []);

  return (
    <>
      {showWarning && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{
            background: '#fff',
            padding: '2rem',
            borderRadius: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            maxWidth: '90vw',
            textAlign: 'center'
          }}>
            <h2>Warning</h2>
            <p>This is a pop-out warning that appears every time the app starts.</p>
            <button onClick={() => setShowWarning(false)} style={{marginTop: '1rem'}}>Close</button>
          </div>
        </div>
      )}
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<SearchPage />} />
            <Route path="/drug/:drugId" element={<DrugLabelPage />} />
            <Route path="/drug/:drugId/evidence-report" element={<EvidenceReportPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </>
  );
}
