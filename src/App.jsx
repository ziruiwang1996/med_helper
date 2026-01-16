import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import SearchPage from "./pages/SearchPage.jsx";
import DrugLabelPage from "./pages/DrugLabelPage.jsx";
import EvidenceReportPage from "./pages/EvidenceReportPage.jsx";
import Layout from "./components/Layout.jsx";
import { getOrCreateThreadId } from "./chatThread.js";

export default function App() {
  useEffect(() => {
    try {
      getOrCreateThreadId();
    } catch (err) {
      console.error("Failed to prepare chat thread id", err);
    }
  }, []);

  return (
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
  );
}
