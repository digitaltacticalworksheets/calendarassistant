import React, { useMemo, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import { searchPolicyRules, generatePolicyResponse } from "./utils/policyAssistant";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/* ---------------- PDF EXTRACT ---------------- */
async function extractPdfText(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = "";

  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");

    fullText += "\n" + text;
  }

  return fullText.trim();
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f1f5f9",
    padding: "24px",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
    color: "#0f172a",
  },
  container: {
    maxWidth: "1200px",
    margin: "0 auto",
    display: "grid",
    gap: "24px",
  },
  card: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "20px",
    padding: "24px",
    boxShadow: "0 2px 8px rgba(15, 23, 42, 0.05)",
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "24px",
  },
  textarea: {
    width: "100%",
    minHeight: "220px",
    border: "1px solid #cbd5e1",
    borderRadius: "14px",
    padding: "12px",
    fontSize: "14px",
    lineHeight: 1.5,
    resize: "vertical",
    marginTop: "12px",
  },
  input: {
    width: "100%",
    border: "1px solid #cbd5e1",
    borderRadius: "14px",
    padding: "12px",
    fontSize: "14px",
    marginTop: "12px",
    boxSizing: "border-box",
  },
  button: {
    background: "#0f172a",
    color: "#ffffff",
    border: "none",
    borderRadius: "14px",
    padding: "12px 16px",
    fontWeight: 600,
    cursor: "pointer",
    marginTop: "12px",
  },
  pill: {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: "999px",
    background: "#e2e8f0",
    fontSize: "12px",
    marginBottom: "8px",
  },
  listCard: {
    background: "#f8fafc",
    borderRadius: "16px",
    padding: "12px",
    border: "1px solid #e2e8f0",
  },
  blueCard: {
    background: "#eff6ff",
    borderRadius: "16px",
    padding: "14px",
    border: "1px solid #bfdbfe",
  },
};

export default function DailyStaffingAssistant() {
  const [rosterText, setRosterText] = useState("");
  const [calendarText, setCalendarText] = useState("");
  const [policyText, setPolicyText] = useState("");
  const [restrictions, setRestrictions] = useState("");

  const [loading, setLoading] = useState(false);

  const [policyQuery, setPolicyQuery] = useState("");
  const [assistantQuestion, setAssistantQuestion] = useState("");
  const [assistantHistory, setAssistantHistory] = useState([
    {
      question: "What is the normal training OOS limit?",
      answer: generatePolicyResponse("What is the normal training OOS limit?"),
    },
  ]);

  const matchedPolicies = useMemo(
    () => searchPolicyRules(policyQuery),
    [policyQuery]
  );

  async function handlePdfUpload(e, setter) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setLoading(true);
      const text = await extractPdfText(file);
      setter(text);
    } catch (err) {
      console.error(err);
      alert("PDF extraction failed");
    } finally {
      setLoading(false);
    }
  }

  function askAssistant() {
    if (!assistantQuestion.trim()) return;

    const answer = generatePolicyResponse(assistantQuestion);
    setAssistantHistory((prev) => [
      ...prev,
      { question: assistantQuestion, answer },
    ]);
    setAssistantQuestion("");
  }

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={{ fontSize: "32px", marginBottom: "8px" }}>
            Daily Staffing Assistant
          </h1>
          <p style={{ color: "#475569", maxWidth: "900px" }}>
            Upload the daily roster and calendar, apply restrictions, and use the
            built-in policy search and assistant for rule guidance.
          </p>
          {loading && <p style={{ marginTop: "12px" }}>Extracting PDF...</p>}
        </div>

        <div style={styles.grid2}>
          <div style={styles.card}>
            <h3>Policy Reference PDF</h3>
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => handlePdfUpload(e, setPolicyText)}
              style={styles.input}
            />
            <textarea
              value={policyText}
              onChange={(e) => setPolicyText(e.target.value)}
              style={styles.textarea}
            />
          </div>

          <div style={styles.card}>
            <h3>Restrictions</h3>
            <textarea
              value={restrictions}
              onChange={(e) => setRestrictions(e.target.value)}
              style={styles.textarea}
            />
          </div>
        </div>

        <div style={styles.grid2}>
          <div style={styles.card}>
            <h3>Roster</h3>
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => handlePdfUpload(e, setRosterText)}
              style={styles.input}
            />
            <textarea
              value={rosterText}
              onChange={(e) => setRosterText(e.target.value)}
              style={styles.textarea}
            />
          </div>

          <div style={styles.card}>
            <h3>Calendar</h3>
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => handlePdfUpload(e, setCalendarText)}
              style={styles.input}
            />
            <textarea
              value={calendarText}
              onChange={(e) => setCalendarText(e.target.value)}
              style={styles.textarea}
            />
          </div>
        </div>

        <div style={styles.card}>
          <h2 style={{ fontSize: "22px" }}>Policy search</h2>
          <p style={{ color: "#475569", marginTop: "8px" }}>
            Search the built-in policy library by topic, rule, source, or keyword.
          </p>
          <input
            value={policyQuery}
            onChange={(e) => setPolicyQuery(e.target.value)}
            placeholder="Examples: overtime, training OOS, T1, E101, special ops"
            style={styles.input}
          />
          <div
            style={{
              display: "grid",
              gap: "10px",
              marginTop: "14px",
              maxHeight: "360px",
              overflowY: "auto",
            }}
          >
            {matchedPolicies.map((rule) => (
              <div key={rule.id} style={styles.blueCard}>
                <div style={styles.pill}>
                  {rule.source} • {rule.reference}
                </div>
                <div style={{ fontWeight: 600 }}>{rule.topic}</div>
                <div style={{ color: "#334155", marginTop: "6px" }}>
                  {rule.rule}
                </div>
              </div>
            ))}
            {!matchedPolicies.length && (
              <div style={{ color: "#64748b" }}>No policy matches found.</div>
            )}
          </div>
        </div>

        <div style={styles.card}>
          <h2 style={{ fontSize: "22px", marginBottom: "12px" }}>
            Policy Assistant
          </h2>
          <p style={{ color: "#475569" }}>
            Ask a plain-language question and get a policy-grounded answer from
            the permanent rule library.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: "12px",
              marginTop: "12px",
              alignItems: "start",
            }}
          >
            <input
              value={assistantQuestion}
              onChange={(e) => setAssistantQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") askAssistant();
              }}
              placeholder="Examples: Can I exceed training OOS limits with approval? Does T1 need dive coverage?"
              style={styles.input}
            />
            <button style={styles.button} onClick={askAssistant}>
              Ask
            </button>
          </div>
          <div style={{ display: "grid", gap: "12px", marginTop: "16px" }}>
            {assistantHistory.map((item, index) => (
              <div key={index} style={styles.listCard}>
                <div style={{ fontWeight: 600 }}>Q: {item.question}</div>
                <div
                  style={{
                    color: "#334155",
                    marginTop: "8px",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  A: {item.answer}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
