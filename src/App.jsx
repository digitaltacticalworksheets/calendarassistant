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

/* ---------------- STAFFING ENGINE ---------------- */
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
  if (/^T\d+/.test(normalized) || normalized === "HAZ1" || normalized === "HR1") {
    return "Truck/Special Ops";
  }
  if (/^R\d+/.test(normalized)) return "Rescue";
  if (/^M\d+/.test(normalized) || normalized === "EMS1" || normalized === "EMS01") {
    return "Medic Unit";
  }
  return "Other";
}

function isMedicSeat(seat = "") {
  return ["FFP", "ENP", "LTP", "CVP", "ACPM"].includes(seat);
}

function parseRosterText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const unitHeader = /^([A-Z]+\d{1,3}|HAZ1|HR01|HR1|EMS01|EMS1|M\d{3})\s*-?/;
  const personLine = /^(LTP|LTE|ENP|ENE|FFP|FFE|CVP|CVE|DCP|DCE|ACPM)\s+(.+)$/;
  const stopTokens = new Set(["OT", "VAC", "SICK", "TS+", "TS-", "OJI", "TP1", "WBACK", "PL"]);

  let currentUnit = "";
  const people = [];

  for (const line of lines) {
    const unitMatch = line.match(unitHeader);
    if (unitMatch) {
      currentUnit = normalizeUnit(unitMatch[1]);
      continue;
    }

    const personMatch = line.match(personLine);
    if (!personMatch || !currentUnit) continue;

    const seat = personMatch[1];
    const tokens = personMatch[2].split(/\s+/);
    const nameTokens = [];
    const specialtyTokens = [];

    for (const token of tokens) {
      if (stopTokens.has(token.toUpperCase())) break;

      const clean = token.replace(/[^A-Za-z.'-]/g, "");
      const looksLikeName = /^[A-Za-z.'-]+$/.test(clean) && clean.length > 0;
      const looksLikeSpecialty = /^[aAbBdDhHlLsStTwWcCeEpP]+$/.test(token);

      if (looksLikeName && specialtyTokens.length === 0 && !looksLikeSpecialty) {
        nameTokens.push(clean);
      } else {
        specialtyTokens.push(token);
      }
    }

    const name = nameTokens.join(" ").trim();
    if (!name) continue;

    people.push({
      name,
      lastName: name.split(" ").slice(-1)[0],
      normalizedName: normalizeName(name),
      unit: currentUnit,
      seat,
      medic: isMedicSeat(seat),
      specialties: specialtyTokens.join(" ").trim(),
    });
  }

  return people;
}

function parseCalendarText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line, index) => {
    const timeMatch = line.match(/^(\d{3,4})\s*[-–]\s*(\d{3,4})\s+(.*)$/);
    const details = timeMatch ? timeMatch[3] : line;
    const colonParts = details.split(":");
    const title = colonParts[0]?.trim() || line;
    const people = (colonParts.slice(1).join(":") || "")
      .split(",")
      .map((person) => person.trim())
      .filter(Boolean);

    return {
      id: index + 1,
      raw: line,
      start: timeMatch ? timeMatch[1] : "",
      end: timeMatch ? timeMatch[2] : "",
      title,
      people,
    };
  });
}

function findRosterMatch(personName, rosterPeople) {
  const target = normalizeName(personName);

  return (
    rosterPeople.find((person) => person.normalizedName === target) ||
    rosterPeople.find((person) => normalizeName(person.lastName) === target) ||
    rosterPeople.find(
      (person) =>
        person.normalizedName.includes(target) || target.includes(person.normalizedName)
    ) ||
    null
  );
}

function restrictionEnabled(restrictions, phrase) {
  return restrictions.toLowerCase().includes(phrase.toLowerCase());
}

function donorCandidates(vacancy, rosterPeople, restrictionsText, usedNames) {
  return rosterPeople.filter((person) => {
    if (person.unit === vacancy.unit) return false;
    if (person.normalizedName === vacancy.normalizedName) return false;
    if (usedNames.has(person.normalizedName)) return false;

    if (restrictionEnabled(restrictionsText, "no medic units") && unitType(person.unit) === "Medic Unit") {
      return false;
    }


   

    if (vacancy.medic && !person.medic) return false;
    return true;
  });
}

function scoreCandidate(candidate, vacancy) {
  let score = 0;

  if (candidate.medic === vacancy.medic) score += 4;
  if (candidate.seat === vacancy.seat) score += 3;
  if (unitType(candidate.unit) === unitType(vacancy.unit)) score += 2;

  if (candidate.specialties && vacancy.specialties) {
    const candidateSpecs = candidate.specialties.toLowerCase().split(/\s+/);
    const vacancySpecs = vacancy.specialties.toLowerCase().split(/\s+/);
    const shared = candidateSpecs.filter((token) => vacancySpecs.includes(token)).length;
    score += shared;
  }

  return score;
}

function buildOptionRows(vacancies, pickIndex) {
  const usedNames = new Set();

  return vacancies.map((vacancy) => {
    const available = vacancy.fills.filter((fill) => !usedNames.has(fill.normalizedName));
    const selected = available[pickIndex] || available[0] || null;

    if (selected) usedNames.add(selected.normalizedName);

    return {
      vacancy: `${vacancy.unit} - ${vacancy.name}`,
      fill: selected?.name || "No clear fill",
      from: selected?.unit || "-",
      why: selected
        ? "Matched by medic status, seat type, unit type, and specialties"
        : "Manual review needed",
    };
  });
}

function buildOptions(rosterPeople, calendarItems, restrictionsText) {
  const impacted = [];

  for (const item of calendarItems) {
    for (const personName of item.people) {
      const match = findRosterMatch(personName, rosterPeople);
      if (match) {
        impacted.push({
          ...match,
          eventTitle: item.title,
          start: item.start,
          end: item.end,
        });
      }
    }
  }

  const vacancies = impacted.map((vacancy) => {
    const usedNames = new Set([vacancy.normalizedName]);
    const fills = donorCandidates(vacancy, rosterPeople, restrictionsText, usedNames)
      .map((candidate) => ({ ...candidate, fitScore: scoreCandidate(candidate, vacancy) }))
      .sort((a, b) => b.fitScore - a.fitScore)
      .slice(0, 5);

    return { ...vacancy, fills };
  });

  return {
    impacted,
    vacancies,
    options: [
      { title: "Option A - Best Fit", rows: buildOptionRows(vacancies, 0) },
      { title: "Option B - Alternate", rows: buildOptionRows(vacancies, 1) },
      { title: "Option C - Backup", rows: buildOptionRows(vacancies, 2) },
    ],
  };
}

/* ---------------- UI STYLES ---------------- */
const styles = {
  page: {
    minHeight: "100vh",
    background: "#f1f5f9",
    padding: "24px",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
    color: "#0f172a",
  },
  container: {
    maxWidth: "1350px",
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
  grid3: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
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
    boxSizing: "border-box",
  },
  monoTextarea: {
    width: "100%",
    minHeight: "260px",
    border: "1px solid #cbd5e1",
    borderRadius: "14px",
    padding: "12px",
    fontSize: "13px",
    lineHeight: 1.45,
    resize: "vertical",
    marginTop: "12px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    boxSizing: "border-box",
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
  amberCard: {
    background: "#fffbeb",
    borderRadius: "16px",
    padding: "14px",
    border: "1px solid #fde68a",
  },
  blueCard: {
    background: "#eff6ff",
    borderRadius: "16px",
    padding: "14px",
    border: "1px solid #bfdbfe",
  },
  greenCard: {
    background: "#ecfdf5",
    borderRadius: "16px",
    padding: "14px",
    border: "1px solid #a7f3d0",
  },
};

export default function DailyStaffingAssistant() {
  const [rosterText, setRosterText] = useState("");
  const [calendarText, setCalendarText] = useState("");
  const [policyText, setPolicyText] = useState("");
  const [restrictions, setRestrictions] = useState(
    "- No medic units for backfill\n- T1 must retain D\n- E101 must retain H\n- Avoid HR1 if possible"
  );

  const [loading, setLoading] = useState(false);

  const [policyQuery, setPolicyQuery] = useState("");
  const [assistantQuestion, setAssistantQuestion] = useState("");
  const [assistantHistory, setAssistantHistory] = useState([
    {
      question: "What is the normal training OOS limit?",
      answer: generatePolicyResponse("What is the normal training OOS limit?"),
    },
  ]);

  const [hasGeneratedPlan, setHasGeneratedPlan] = useState(false);
  const [planSummary, setPlanSummary] = useState("");

  const rosterPeople = useMemo(() => parseRosterText(rosterText), [rosterText]);
  const calendarItems = useMemo(() => parseCalendarText(calendarText), [calendarText]);
  const results = useMemo(
    () => buildOptions(rosterPeople, calendarItems, restrictions),
    [rosterPeople, calendarItems, restrictions]
  );
  const matchedPolicies = useMemo(() => searchPolicyRules(policyQuery), [policyQuery]);

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

  function generatePlan() {
    const impactedCount = results.impacted.length;
    const optionCount = results.options.reduce((sum, option) => sum + option.rows.length, 0);

    let summary = "";

    if (!rosterPeople.length) {
      summary = "No roster entries were parsed. Check the roster PDF extraction or paste cleaner roster text.";
    } else if (!calendarItems.length) {
      summary = "No calendar items were parsed. Check the calendar PDF extraction or paste cleaner calendar text.";
    } else if (!impactedCount) {
      summary = "No personnel from the calendar matched the roster. Check names and formatting.";
    } else if (!optionCount) {
      summary = "Personnel were identified, but no staffing options could be generated from the current roster and restrictions.";
    } else {
      summary =
        `Generated ${results.options.length} staffing options for ${impactedCount} impacted personnel. ` +
        `Best starting point is ${results.options[0].title}. ` +
        `Use the AI assistant to ask which option best protects special ops, minimizes movement, or creates the least policy risk.`;
    }

    setPlanSummary(summary);
    setHasGeneratedPlan(true);
  }

  function askAssistant() {
    if (!assistantQuestion.trim()) return;

    let answer = generatePolicyResponse(assistantQuestion);

    if (/calendar|staffing|option|best|move-up|backfill|today|plan/i.test(assistantQuestion)) {
      const bestOption = results.options[0];
      const staffingSummary = [
        `Impacted personnel found: ${results.impacted.length}.`,
        `Roster members parsed: ${rosterPeople.length}.`,
        `Calendar items parsed: ${calendarItems.length}.`,
        hasGeneratedPlan ? "Plan generated: yes." : "Plan generated: no.",
        bestOption?.rows?.length
          ? `${bestOption.title} has ${bestOption.rows.length} fill suggestions.`
          : "No staffing options generated yet.",
      ].join(" ");

      answer += `\n\nOperational context: ${staffingSummary}`;

      if (hasGeneratedPlan && bestOption?.rows?.length) {
        answer += `\n\nRecommendation: Start with ${bestOption.title}. It currently represents the strongest first-pass staffing solution from the parsed roster and calendar.`;
      }
    }

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
          <p style={{ color: "#475569", maxWidth: "980px" }}>
            Upload the daily roster and calendar, generate staffing options, and use the AI/policy layer to help solve calendar and staffing conflicts.
          </p>
          {loading && <p style={{ marginTop: "12px" }}>Extracting PDF...</p>}
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
              style={styles.monoTextarea}
              placeholder="Upload a roster PDF or paste roster text"
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
              style={styles.monoTextarea}
              placeholder="Upload a calendar PDF or paste calendar text"
            />
          </div>
        </div>

        <div style={styles.grid2}>
          <div style={styles.card}>
            <h3>Restrictions</h3>
            <textarea
              value={restrictions}
              onChange={(e) => setRestrictions(e.target.value)}
              style={styles.textarea}
              placeholder="Enter daily restrictions and staffing notes"
            />
          </div>

          <div style={styles.card}>
            <h3>Optional Policy Reference PDF</h3>
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
              placeholder="Optional reference PDF text"
            />
          </div>
        </div>

        <div style={styles.card}>
          <h2 style={{ fontSize: "22px", marginBottom: "12px" }}>
            Generate Staffing Plan
          </h2>
          <p style={{ color: "#475569" }}>
            Click below to analyze the roster and calendar and generate staffing options.
          </p>
          <button style={styles.button} onClick={generatePlan}>
            Generate Plan
          </button>

          {hasGeneratedPlan && (
            <div style={{ ...styles.greenCard, marginTop: "16px" }}>
              <div style={{ fontWeight: 600 }}>Planning Summary</div>
              <div style={{ marginTop: "8px", color: "#334155", whiteSpace: "pre-wrap" }}>
                {planSummary}
              </div>
            </div>
          )}
        </div>

        <div style={styles.grid2}>
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
              AI / Policy Assistant
            </h2>
            <p style={{ color: "#475569" }}>
              Ask questions about the day’s staffing, policy issues, or which option looks best.
            </p>
            <div style={styles.greenCard}>
              <div style={{ fontWeight: 600 }}>Current planning context</div>
              <div style={{ color: "#334155", marginTop: "8px" }}>
                Impacted members: {results.impacted.length} • Roster parsed: {rosterPeople.length} • Calendar items parsed: {calendarItems.length} • Plan generated: {hasGeneratedPlan ? "Yes" : "No"}
              </div>
            </div>
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
                placeholder="Examples: Which option best protects special ops? Can I exceed training OOS limits with move-ups?"
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

        {hasGeneratedPlan && (
          <>
            <div style={styles.grid2}>
              <div style={styles.card}>
                <h2 style={{ fontSize: "22px", marginBottom: "12px" }}>
                  Parsed roster
                </h2>
                <div style={{ display: "grid", gap: "10px", maxHeight: "520px", overflowY: "auto" }}>
                  {rosterPeople.map((person) => (
                    <div key={person.unit + person.name} style={styles.listCard}>
                      <div style={{ fontWeight: 600 }}>{person.name}</div>
                      <div style={{ color: "#475569", marginTop: "4px" }}>
                        {person.unit} • {person.seat} • {person.medic ? "Medic" : "Non-medic"}
                      </div>
                      <div style={{ color: "#64748b", marginTop: "4px" }}>
                        {person.specialties || "No specialty markers parsed"}
                      </div>
                    </div>
                  ))}
                  {!rosterPeople.length && (
                    <div style={{ color: "#64748b" }}>No roster entries parsed yet.</div>
                  )}
                </div>
              </div>

              <div style={styles.card}>
                <h2 style={{ fontSize: "22px", marginBottom: "12px" }}>
                  Impacted personnel
                </h2>
                <div style={{ display: "grid", gap: "12px" }}>
                  {results.impacted.length ? (
                    results.impacted.map((person) => (
                      <div key={person.unit + person.name + person.eventTitle} style={styles.amberCard}>
                        <div style={{ fontWeight: 600 }}>{person.name}</div>
                        <div style={{ color: "#334155", marginTop: "4px" }}>
                          {person.unit} • {person.seat} • {person.medic ? "Medic-critical" : "Body vacancy"}
                        </div>
                        <div style={{ color: "#475569", marginTop: "4px" }}>
                          Event: {person.eventTitle} {person.start && person.end ? `(${person.start}-${person.end})` : ""}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ color: "#64748b" }}>
                      No impacted personnel found yet. Check roster and calendar formatting.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div style={styles.card}>
              <h2 style={{ fontSize: "28px", marginBottom: "16px" }}>
                Generated staffing options
              </h2>
              <div style={styles.grid3}>
                {results.options.map((option) => (
                  <div key={option.title} style={{ ...styles.listCard, padding: "18px" }}>
                    <div style={styles.pill}>{option.title}</div>
                    <div style={{ display: "grid", gap: "12px" }}>
                      {option.rows.length ? (
                        option.rows.map((row) => (
                          <div
                            key={row.vacancy + row.fill}
                            style={{ ...styles.card, padding: "14px", borderRadius: "16px" }}
                          >
                            <div style={{ fontWeight: 600 }}>{row.vacancy}</div>
                            <div style={{ color: "#334155", marginTop: "6px" }}>
                              Fill: <strong>{row.fill}</strong>
                            </div>
                            <div style={{ color: "#334155", marginTop: "4px" }}>
                              From: <strong>{row.from}</strong>
                            </div>
                            <div style={{ color: "#64748b", marginTop: "6px" }}>{row.why}</div>
                          </div>
                        ))
                      ) : (
                        <div style={{ color: "#64748b" }}>No staffing options generated yet.</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={styles.card}>
              <h2 style={{ fontSize: "22px", marginBottom: "12px" }}>
                Parsed calendar items
              </h2>
              <div style={{ display: "grid", gap: "10px" }}>
                {calendarItems.map((item) => (
                  <div key={item.id} style={styles.listCard}>
                    <div style={{ fontWeight: 600 }}>{item.title || item.raw}</div>
                    <div style={{ color: "#475569", marginTop: "4px" }}>
                      {item.start && item.end ? `${item.start}-${item.end}` : "No time parsed"}
                    </div>
                    <div style={{ color: "#64748b", marginTop: "4px" }}>
                      People: {item.people.length ? item.people.join(", ") : "None parsed"}
                    </div>
                  </div>
                ))}
                {!calendarItems.length && (
                  <div style={{ color: "#64748b" }}>No calendar items parsed yet.</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
