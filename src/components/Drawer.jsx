import React, { useEffect } from "react";

export default function Drawer({ open, title, onClose, children, width = 420 }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="backdrop" onClick={onClose} />
      <aside className="drawer" style={{ width }}>
        <div className="drawerHeader">
          <div className="drawerTitle">{title}</div>
          <button className="btn btnGhost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="drawerBody">{children}</div>
      </aside>
    </div>
  );
}
