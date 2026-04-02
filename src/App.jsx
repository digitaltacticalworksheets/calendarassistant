import React, { useMemo, useState } from "react";

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
  if (/^M\d+/.test(normalized) || normalized === "EMS1" || normalized === "EMS01") return "Medic Unit";
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
    rosterPeople.find((person) => person.normalizedName.includes(target) || target.includes(person.normalizedName)) ||
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

    if (restrictionEnabled(restrictionsText, "avoid hr1") && normalizeUnit(person.unit) === "HR1") {
      return false;
    }

    if (
      restrictionEnabled(restrictionsText, "t1 must retain d") &&
      normalizeUnit(person.unit) === "T1" &&
      /\bd\b/i.test(person.specialties)
    ) {
      return false;
    }

    if (
      restrictionEnabled(restrictionsText, "e101 must retain h") &&
      normalizeUnit(person.unit) === "E101" &&
      /\bh\b/i.test(person.specialties)
    ) {
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
      why: selected ? "Matched by medic status, seat type, unit type, and specialties" : "Manual review needed",
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

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f1f5f9",
    padding: "24px",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
    color: "#0f172a",
  },
  container: {
    maxWidth: "1400px",
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
    minHeight: "180px",
    border: "1px solid #cbd5e1",
    borderRadius: "14px",
    padding: "12px",
    fontSize: "14px",
    lineHeight: 1.5,
    resize: "vertical",
    marginTop: "12px",
  },
  monoTextarea: {
    width: "100%",
    minHeight: "320px",
    border: "1px solid #cbd5e1",
    borderRadius: "14px",
    padding: "12px",
    fontSize: "13px",
    lineHeight: 1.45,
    resize: "vertical",
    marginTop: "12px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
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
};

export default function DailyStaffingAssistant() {
  const [policyText, setPolicyText] = useState(
    "GO 63: Training OOS max 3 engines, 2 trucks, 1 rescue.\nAO 22: Under 4 hours may allow reduced staffing. Over 4 hours should trigger OT.\nAO 52: Protect specialty coverage such as D, H, TRT, and dive assignments."
  );

  const [rosterText, setRosterText] = useState(
    "E001 - District 1\nFFP R Fink S\nE101 - District 1\nFFP D Sumeersarnauth E H\nFFP I Sheridan E HL S\nT001 - District 1\nFFP C Johnston Ab DE L S\nR006 - District 1\nFFP K A Dupont E S\nE002 - District 3\nENE K Williams a L S\nR009 - District 3\nFFP G Mueller E S\nR011 - District 4\nFFE A Mceachern E h S W\nT011 - District 4\nFFP A Ribbink ADE h L S\nT002 - District 3\nFFP K Henry E HL\nFFP B K Ferreira E HL S\nHR01 - District 3\nFFP C Robinson AB DE L S T"
  );

  const [calendarText, setCalendarText] = useState(
    "0800-1200 HazMat refresher: Fink, Dupont, Mueller\n0900-1100 Officer meeting: Sumeersarnauth\n1300-1500 EMS QA review: McEachern"
  );

  const [restrictions, setRestrictions] = useState(
    "- No medic units for backfill\n- T1 must retain D\n- E101 must retain H\n- Avoid HR1 if possible"
  );

  const rosterPeople = useMemo(() => parseRosterText(rosterText), [rosterText]);
  const calendarItems = useMemo(() => parseCalendarText(calendarText), [calendarText]);
  const results = useMemo(() => buildOptions(rosterPeople, calendarItems, restrictions), [rosterPeople, calendarItems, restrictions]);

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={{ fontSize: "32px", marginBottom: "8px" }}>Daily Staffing Assistant</h1>
          <p style={{ color: "#475569", maxWidth: "980px" }}>
            Paste policy text, the daily roster, and the day calendar. The assistant parses the roster, identifies personnel being pulled, and proposes three staffing movement options.
          </p>
        </div>

        <div style={styles.grid2}>
          <div style={styles.card}>
            <h2 style={{ fontSize: "22px" }}>Policy library</h2>
            <textarea value={policyText} onChange={(e) => setPolicyText(e.target.value)} style={styles.textarea} />
          </div>

          <div style={styles.card}>
            <h2 style={{ fontSize: "22px" }}>Day restrictions</h2>
            <textarea value={restrictions} onChange={(e) => setRestrictions(e.target.value)} style={styles.textarea} />
          </div>
        </div>

        <div style={styles.grid2}>
          <div style={styles.card}>
            <h2 style={{ fontSize: "22px" }}>Daily roster</h2>
            <p style={{ color: "#475569", marginTop: "8px" }}>Paste roster text or extracted PDF text here.</p>
            <textarea value={rosterText} onChange={(e) => setRosterText(e.target.value)} style={styles.monoTextarea} />
          </div>

          <div style={styles.card}>
            <h2 style={{ fontSize: "22px" }}>Day calendar</h2>
            <p style={{ color: "#475569", marginTop: "8px" }}>Format example: 0800-1200 HazMat refresher: Fink, Dupont, Mueller</p>
            <textarea value={calendarText} onChange={(e) => setCalendarText(e.target.value)} style={styles.monoTextarea} />
          </div>
        </div>

        <div style={styles.grid2}>
          <div style={styles.card}>
            <h2 style={{ fontSize: "22px", marginBottom: "12px" }}>Parsed roster</h2>
            <div style={{ display: "grid", gap: "10px", maxHeight: "560px", overflowY: "auto" }}>
              {rosterPeople.map((person) => (
                <div key={person.unit + person.name} style={styles.listCard}>
                  <div style={{ fontWeight: 600 }}>{person.name}</div>
                  <div style={{ color: "#475569", marginTop: "4px" }}>
                    {person.unit} • {person.seat} • {person.medic ? "Medic" : "Non-medic"}
                  </div>
                  <div style={{ color: "#64748b", marginTop: "4px" }}>{person.specialties || "No specialty markers parsed"}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={styles.card}>
            <h2 style={{ fontSize: "22px", marginBottom: "12px" }}>Impacted personnel</h2>
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
                <div style={{ color: "#64748b" }}>No matches found yet. Check roster and calendar formatting.</div>
              )}
            </div>
          </div>
        </div>

        <div style={styles.card}>
          <h2 style={{ fontSize: "28px", marginBottom: "16px" }}>Generated staffing options</h2>
          <div style={styles.grid3}>
            {results.options.map((option) => (
              <div key={option.title} style={{ ...styles.listCard, padding: "18px" }}>
                <div style={{ ...styles.pill }}>{option.title}</div>
                <div style={{ display: "grid", gap: "12px" }}>
                  {option.rows.map((row) => (
                    <div key={row.vacancy + row.fill} style={{ ...styles.card, padding: "14px", borderRadius: "16px" }}>
                      <div style={{ fontWeight: 600 }}>{row.vacancy}</div>
                      <div style={{ color: "#334155", marginTop: "6px" }}>
                        Fill: <strong>{row.fill}</strong>
                      </div>
                      <div style={{ color: "#334155", marginTop: "4px" }}>
                        From: <strong>{row.from}</strong>
                      </div>
                      <div style={{ color: "#64748b", marginTop: "6px" }}>{row.why}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.card}>
          <h2 style={{ fontSize: "22px", marginBottom: "12px" }}>Calendar items parsed</h2>
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
          </div>
        </div>
      </div>
    </div>
  );
}
