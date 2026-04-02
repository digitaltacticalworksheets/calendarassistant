import React, { useMemo, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/* ---------------- PDF EXTRACT ---------------- */
async function extractPdfText(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");

    fullText += "\n" + text;
  }

  return fullText;
}

/* ---------------- YOUR ORIGINAL LOGIC (UNCHANGED) ---------------- */

function normalizeName(value = "") {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function normalizeUnit(unit = "") {
  const upper = unit.toUpperCase().trim();
  if (/^T0*1$/.test(upper)) return "T1";
  if (/^T0*10$/.test(upper)) return "T10";
  if (/^T0*11$/.test(upper)) return "T11";
  if (/^E0*101$/.test(upper)) return "E101";
  if (/^HR0*1$/.test(upper)) return "HR1";
  if (/^R0*1$/.test(upper)) return "R1";
  return upper.replace(/^([A-Z]+)0+/, "$1");
}

function unitType(unit = "") {
  const normalized = normalizeUnit(unit);
  if (/^E\d+/.test(normalized)) return "Engine";
  if (/^T\d+/.test(normalized) || normalized === "HAZ1" || normalized === "HR1") return "Truck/Special Ops";
  if (/^R\d+/.test(normalized)) return "Rescue";
  if (/^M\d+/.test(normalized) || normalized === "EMS1") return "Medic Unit";
  return "Other";
}

function isMedicSeat(seat = "") {
  return ["FFP", "ENP", "LTP", "CVP", "ACPM"].includes(seat);
}

/* ---------------- MAIN COMPONENT ---------------- */

export default function DailyStaffingAssistant() {
  const [rosterText, setRosterText] = useState("");
  const [calendarText, setCalendarText] = useState("");
  const [policyText, setPolicyText] = useState("");
  const [restrictions, setRestrictions] = useState("");

  const [loading, setLoading] = useState(false);

  async function handlePdfUpload(e, setter) {
    const file = e.target.files[0];
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

  return (
    <div style={{ padding: 20 }}>
      <h1>Daily Staffing Assistant</h1>

      {loading && <p>Extracting PDF...</p>}

      <h3>Policy</h3>
      <input type="file" accept=".pdf" onChange={(e) => handlePdfUpload(e, setPolicyText)} />
      <textarea value={policyText} onChange={(e) => setPolicyText(e.target.value)} />

      <h3>Roster</h3>
      <input type="file" accept=".pdf" onChange={(e) => handlePdfUpload(e, setRosterText)} />
      <textarea value={rosterText} onChange={(e) => setRosterText(e.target.value)} />

      <h3>Calendar</h3>
      <input type="file" accept=".pdf" onChange={(e) => handlePdfUpload(e, setCalendarText)} />
      <textarea value={calendarText} onChange={(e) => setCalendarText(e.target.value)} />

      <h3>Restrictions</h3>
      <textarea value={restrictions} onChange={(e) => setRestrictions(e.target.value)} />
    </div>
  );
}