import React from "react";
import { useNavigate, useParams } from "react-router-dom";

export default function FloatingActions({ onOpenChat }) {
  const navigate = useNavigate();
  const { drugId } = useParams();
  return (
    <div className="floatingWrap" aria-label="Quick actions">
      <button
        className="fab"
        onClick={() => navigate(`/drug/${drugId}/evidence-report`)}
        title="Contextual Evidence Report"
      >
        Contextual Evidence Report
      </button>
      <button className="fab fabPrimary" onClick={onOpenChat} title="Chat">
        Chat
      </button>
    </div>
  );
}
