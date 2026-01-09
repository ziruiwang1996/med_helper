import React from "react";

export default function FloatingActions({ onOpenReport, onOpenChat }) {
  return (
    <div className="floatingWrap" aria-label="Quick actions">
      <button className="fab" onClick={onOpenReport} title="Contextual Evidence Report">
        Contextual Evidence Report
      </button>
      <button className="fab fabPrimary" onClick={onOpenChat} title="Chat">
        Chat
      </button>
    </div>
  );
}
