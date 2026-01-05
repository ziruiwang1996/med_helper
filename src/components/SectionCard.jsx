import React from "react";

function sanitizeSourceText(value) {
  if (!value) return "";
  const base = String(value)
    .replace(/\r\n/g, "\n")
    // remove zero-width chars often present in openFDA text (e.g., "Warnings ​Warnings")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\t/g, " ")

  // Some labels embed bullets inline (e.g., "Indicated: • ... • ...").
  // Convert those into newline bullets so our list parser can format them.
  const withInlineBullets = base.replace(/[\u2022•]/g, (m, offset) => {
    // At the very start, keep as-is; elsewhere, insert a newline.
    return offset === 0 ? m : `\n${m}`;
  });

  return withInlineBullets.trim();
}

function collapseDuplicateWords(text) {
  // Helps with patterns like "Warnings Warnings" that appear in some openFDA fields.
  return text.replace(/\b([A-Za-z]{3,})\b(?:\s+\1\b)+/g, "$1");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTitleVariants(title) {
  const t = String(title || "").trim();
  if (!t) return [];
  const upper = t.toUpperCase();
  const spaced = upper
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  const variants = new Set([upper, spaced]);

  // A few common label heading variants
  variants.add(upper.replace(/\s*\/\s*/g, "/"));
  variants.add(spaced.replace(/\s+AND\s+/g, " "));
  variants.add(upper.replace(/\s+AND\s+/g, " "));

  return Array.from(variants).filter(Boolean);
}

function stripLeadingSectionHeading(text, title) {
  const trimmed = String(text || "").trimStart();
  if (!trimmed) return "";

  const variants = normalizeTitleVariants(title);
  for (const v of variants) {
    // Matches:
    // - "4 CONTRAINDICATIONS ..."
    // - "CONTRAINDICATIONS ..."
    // - "4. CONTRAINDICATIONS ..."
    // - "4  CONTRAINDICATIONS\n..."
    const re = new RegExp(
      `^\\s*(?:\\d+\\s*[.)]?\\s+)?${escapeRegExp(v)}\\b(?:\\s*[:\u2013\u2014\-])?\\s+`,
      "i"
    );
    if (re.test(trimmed)) {
      return trimmed.replace(re, "").trimStart();
    }
  }

  return trimmed;
}

function parseLabelBlocks(sourceText, title) {
  const base = sanitizeSourceText(sourceText);
  const text = stripLeadingSectionHeading(base, title);
  if (!text) return [];

  const blocks = text.split(/\n\s*\n+/g).map((b) => b.trim()).filter(Boolean);
  return blocks.map((block) => {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const bulletRe = /^(?:[-*•]|\u2022)\s+/;
    const orderedRe = /^\d+[.)]\s+/;
    const isMostlyBullets = lines.length >= 2 && lines.filter((l) => bulletRe.test(l)).length >= 2;
    const isMostlyOrdered = lines.length >= 2 && lines.filter((l) => orderedRe.test(l)).length >= 2;

    if (isMostlyOrdered || isMostlyBullets) {
      const items = lines
        .map((l) => l.replace(orderedRe, "").replace(bulletRe, "").trim())
        .filter(Boolean);
      return { type: isMostlyOrdered ? "ol" : "ul", items };
    }

    const paragraph = collapseDuplicateWords(
      lines
        .join("\n")
        .replace(/\s*\n\s*/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim()
    );
    return { type: "p", text: paragraph };
  });
}

function sanitizeAiText(value) {
  if (!value) return "";
  return String(value)
    .replace(/\r\n/g, "\n")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

function stripRedundantDisclaimer(text) {
  const t = String(text || "").trimStart();
  // The UI already displays an "Educational only" disclaimer block.
  return t.replace(/^\s*Educational\s+only\.[^\n]*\n+/i, "");
}

function renderInlineFormat(text) {
  const s = String(text || "");
  if (!s) return null;

  // Minimal markdown-ish support: **bold** and *italic*.
  // This is intentionally simple and safe (no HTML parsing).
  const parts = [];
  let i = 0;

  while (i < s.length) {
    const boldStart = s.indexOf("**", i);
    const italicStart = s.indexOf("*", i);

    const next = [
      boldStart >= 0 ? { kind: "bold", at: boldStart } : null,
      italicStart >= 0 ? { kind: "italic", at: italicStart } : null,
    ]
      .filter(Boolean)
      .sort((a, b) => a.at - b.at)[0];

    if (!next) {
      parts.push(s.slice(i));
      break;
    }

    if (next.at > i) parts.push(s.slice(i, next.at));

    if (next.kind === "bold") {
      const end = s.indexOf("**", next.at + 2);
      if (end === -1) {
        parts.push(s.slice(next.at));
        break;
      }
      const inner = s.slice(next.at + 2, end);
      parts.push(<strong key={`b-${next.at}`}>{inner}</strong>);
      i = end + 2;
      continue;
    }

    // italic
    const end = s.indexOf("*", next.at + 1);
    if (end === -1) {
      parts.push(s.slice(next.at));
      break;
    }
    const inner = s.slice(next.at + 1, end);
    parts.push(<em key={`i-${next.at}`}>{inner}</em>);
    i = end + 1;
  }

  return parts;
}

function parseAiBlocks(explanation) {
  const base = stripRedundantDisclaimer(sanitizeAiText(explanation));
  if (!base) return [];

  const blocks = base
    .split(/\n\s*\n+/g)
    .map((b) => b.trim())
    .filter(Boolean);

  return blocks.map((block) => {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const bulletRe = /^(?:[-*•]|\u2022)\s+/;
    const orderedRe = /^\d+[.)]\s+/;
    const orderedDotRe = /^\d+\.\s+/;

    const bulletCount = lines.filter((l) => bulletRe.test(l)).length;
    const orderedCount = lines.filter((l) => orderedRe.test(l) || orderedDotRe.test(l)).length;

    if (lines.length >= 2 && bulletCount >= 2) {
      const items = lines
        .map((l) => l.replace(bulletRe, "").trim())
        .filter(Boolean);
      return { type: "ul", items };
    }

    if (lines.length >= 2 && orderedCount >= 2) {
      const items = lines
        .map((l) => l.replace(orderedRe, "").replace(orderedDotRe, "").trim())
        .filter(Boolean);
      return { type: "ol", items };
    }

    const paragraph = lines
      .join("\n")
      .replace(/\s*\n\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    return { type: "p", text: paragraph };
  });
}

export default function SectionCard({
  title,
  sourceText,
  explanationState,
  onExplain,
  showSource,
  onToggleSource,
  showExplanation = true,
  onToggleExplanation,
}) {
  const { status, data, error } = explanationState || { status: "idle" };
  const blocks = parseLabelBlocks(sourceText, title);
  const aiBlocks = parseAiBlocks(data?.explanation);

  function onExplainToggle() {
    if (showExplanation) {
      onToggleExplanation?.();
      return;
    }

    // Show explanation. If we don't already have one (and aren't currently loading), generate it.
    onToggleExplanation?.();
    if (status !== "success" && status !== "loading") {
      onExplain?.();
    }
  }

  return (
    <section className="card">
      <div className="cardHeader">
        <h2 className="cardTitle">{title}</h2>
        <div className="cardActions">
          <button className="btn btnSecondary" onClick={onToggleSource}>
            {showSource ? "Hide label text" : "View label text"}
          </button>
          <button
            className={showExplanation ? "btn btnSecondary" : "btn"}
            onClick={onExplainToggle}
            disabled={!showExplanation && status === "loading"}
            aria-expanded={showExplanation}
            aria-pressed={showExplanation}
          >
            {showExplanation ? "Hide explanation" : status === "loading" ? "Explaining..." : "Explain this"}
          </button>
        </div>
      </div>

      {showSource && (
        <div className="sourceBox">
          <div className="sourceHeader">Official label text (source)</div>
          {blocks.length ? (
            <div className="sourceRich">
              {blocks.map((b, idx) => {
                if (b.type === "ul") {
                  return (
                    <ul key={idx} className="sourceList">
                      {b.items.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  );
                }

                if (b.type === "ol") {
                  return (
                    <ol key={idx} className="sourceList sourceListOrdered">
                      {b.items.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ol>
                  );
                }

                return (
                  <p key={idx} className="sourcePara">
                    {b.text}
                  </p>
                );
              })}
            </div>
          ) : (
            <div className="sourceRich muted">No source text available for this section.</div>
          )}
        </div>
      )}

      {showExplanation ? <div className="explainBox">
        {status === "idle" && (
          <div className="muted">
            Click “Explain this” to get an AI interpretation of this section.
          </div>
        )}

        {status === "error" && (
          <div className="alert alertError">
            <div className="alertTitle">Could not generate explanation</div>
            <div className="alertText">{error || "Unknown error."}</div>
          </div>
        )}

        {status === "success" && data && (
          <div className="aiAnswer">
            <div className="alert alertInfo">
              <div className="alertTitle">AI explanation</div>
              <div className="alertText">
                Educational only. Not medical advice. Confirm with a clinician.
              </div>
            </div>

            {data.bullets?.length ? (
              <ul className="bullets">
                {data.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            ) : null}

            {aiBlocks.length
              ? aiBlocks.map((b, idx) => {
                  if (b.type === "ul") {
                    return (
                      <ul key={idx} className="bullets">
                        {b.items.map((item, i) => (
                          <li key={i}>{renderInlineFormat(item)}</li>
                        ))}
                      </ul>
                    );
                  }

                  if (b.type === "ol") {
                    return (
                      <ol key={idx} className="bullets sourceListOrdered">
                        {b.items.map((item, i) => (
                          <li key={i}>{renderInlineFormat(item)}</li>
                        ))}
                      </ol>
                    );
                  }

                  return (
                    <p key={idx} className="para">
                      {renderInlineFormat(b.text)}
                    </p>
                  );
                })
              : null}

            {data.cautions?.length ? (
              <>
                <div className="subhead">Pay attention to</div>
                <ul className="bullets">
                  {data.cautions.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </>
            ) : null}

            {data.citations?.length ? (
              <div className="muted small">
                Sources: {data.citations.join(" · ")}
              </div>
            ) : null}
          </div>
        )}
      </div> : null}
    </section>
  );
}
