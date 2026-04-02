import React, { useMemo, useState } from "react";

function parseRosterText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const unitHeader = /^([A-Z]+\d{3}|HAZ1|HR01|EMS01|M\d{3})\s*-?/;
  const personLine = /^(LTP|LTE|ENP|ENE|FFP|FFE|CVP|CVE|DCP|DCE|ACPM)\s+(.+)$/;

  let currentUnit = "";
  const people = [];

  for (const line of lines) {
    const unitMatch = line.match(unitHeader);
    if (unitMatch) {
      currentUnit = unitMatch[1];
      continue;
    }

    const personMatch = line.match(personLine);
    if (!personMatch || !currentUnit) continue;

    const seat = personMatch[1];
    const rest = personMatch[2].replace(/\s+(OT|VAC|SICK|TS\+|TS-|OJI|TP1).*/i, "").trim();
    const tokens = rest.split(/\s+/);

    // Capture name tokens until lowercase/specialty markers likely begin.
    const nameTokens = [];
    const specialtyTokens = [];
    for (const token of tokens) {
      if (/^[A-Za-z.'-]+$/.test(token) && specialtyTokens.length === 0) {
        nameTokens.push(token);
      } else {
        specialtyTokens.push(token);
      }
    }

    const name = nameTokens.join(" ").trim();
    const specialties = specialtyTokens.join(" ").trim();
    if (!name) continue;

    people.push({
      name,
      lastName: name.split(" ").slice(-1)[0],
      unit: currentUnit,
      seat,
      medic: seat === "FFP" || seat === "ENP" || seat === "LTP" || seat === "CVP",
      specialties,
    });
  }

  return people;
}

function parseCalendarText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  return lines.map((line, index) => {
    const timeMatch = line.match(/^(\d{3,4})\s*[-–]\s*(\d{3,4})\s+(.*)$/);
    const namedPeople = (line.match(/:([^]+)$/)?.[1] || "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

    return {
      id: index + 1,
      raw: line,
      start: timeMatch ? timeMatch[1] : "",
      end: timeMatch ? timeMatch[2] : "",
      title: timeMatch ? timeMatch[3].split(":")[0].trim() : line,
      people: namedPeople,
    };
  });
}

function normalizeName(value) {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function findRosterMatch(personName, rosterPeople) {
  const target = normalizeName(personName);
  return rosterPeople.find((p) => normalizeName(p.lastName) === target || normalizeName(p.name).includes(target));
}

function unitType(unit) {
  if (/^E\d+/.test(unit) || unit === "E101") return "Engine";
  if (/^T\d+/.test(unit) || unit === "HAZ1" || unit === "HR01") return "Truck/Special Ops";
  if (/^R\d+/.test(unit)) return "Rescue";
  if (/^M\d+/.test(unit) || unit === "EMS01") return "Medic Unit";
  return "Other";
}

function donorCandidates(vacancy, rosterPeople, restrictionsText) {
  const restrictions = restrictionsText.toLowerCase();
  return rosterPeople.filter((p) => {
    if (p.unit === vacancy.unit) return false;
    if (restrictions.includes("no medic units") && unitType(p.unit) === "Medic Unit") return false;
    if (restrictions.includes("avoid hr1") && p.unit === "HR01") return false;
    if (restrictions.includes("t1 must retain d") && p.unit === "T001" && /\bd\b/i.test(p.specialties)) return false;
    if (restrictions.includes("e101 must retain h") && p.unit === "E101" && /\bh\b/i.test(p.specialties)) return false;

    if (vacancy.medic) return p.medic;
    return true;
  });
}

function scoreCandidate(candidate, vacancy) {
  let score = 0;
  if (candidate.medic === vacancy.medic) score += 3;
  if (candidate.seat === vacancy.seat) score += 2;
  if (unitType(candidate.unit) === unitType(vacancy.unit)) score += 2;
  if (candidate.specialties && vacancy.specialties) {
    const shared = candidate.specialties
      .split(/\s+/)
      .filter((x) => vacancy.specialties.split(/\s+/).includes(x)).length;
    score += shared;
  }
  return score;
}

function buildOptions(rosterPeople, calendarItems, restrictionsText) {
  const impacted = [];

  for (const item of calendarItems) {
    for (const personName of item.people) {
      const match = findRosterMatch(personName, rosterPeople);
      if (match) impacted.push({ ...match, eventTitle: item.title, start: item.start, end: item.end });
    }
  }

  const vacancies = impacted.map((v) => {
    const candidates = donorCandidates(v, rosterPeople, restrictionsText)
      .map((c) => ({ ...c, fitScore: scoreCandidate(c, v) }))
      .sort((a, b) => b.fitScore - a.fitScore);

    return {
      ...v,
      fills: candidates.slice(0, 3),
    };
  });

  const optionA = vacancies.map((v) => ({
    vacancy: `${v.unit} – ${v.name}`,
    fill: v.fills[0]?.name || "No clear fill",
    from: v.fills[0]?.unit || "—",
    why: v.fills[0] ? "Best fit by seat / medic / unit type" : "Manual review needed",
  }));

  const optionB = vacancies.map((v) => ({
    vacancy: `${v.unit} – ${v.name}`,
    fill: v.fills[1]?.name || v.fills[0]?.name || "No clear fill",
    from: v.fills[1]?.unit || v.fills[0]?.unit || "—",
    why: v.fills[1] ? "Alternative to spread movement" : "Fallback to best fit",
  }));

  const optionC = vacancies.map((v) => ({
    vacancy: `${v.unit} – ${v.name}`,
    fill: v.fills[2]?.name || v.fills[1]?.name || v.fills[0]?.name || "No clear fill",
    from: v.fills[2]?.unit || v.fills[1]?.unit || v.fills[0]?.unit || "—",
    why: v.fills[2] ? "Third-best option / protect primary donors" : "Fallback option",
  }));

  return {
    impacted,
    vacancies,
    options: [
      { title: "Option A — Best Fit", rows: optionA },
      { title: "Option B — Alternate", rows: optionB },
      { title: "Option C — Backup", rows: optionC },
    ],
  };
}

export default function DailyStaffingAssistantMVP() {
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

  const card = "rounded-3xl border bg-white shadow-sm";

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className={card + " p-8"}>
          <h1 className="text-3xl font-bold tracking-tight">Daily Staffing Assistant</h1>
          <p className="mt-2 max-w-4xl text-slate-600">
            Paste policy text, the daily roster, and the day calendar. The assistant parses the day’s assignments, identifies personnel being pulled, and proposes three staffing movement options.
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <div className={card + " p-6"}>
            <h2 className="text-xl font-semibold">Policy library</h2>
            <textarea value={policyText} onChange={(e) => setPolicyText(e.target.value)} className="mt-4 min-h-[140px] w-full rounded-2xl border p-3 text-sm" />
          </div>
          <div className={card + " p-6"}>
            <h2 className="text-xl font-semibold">Day restrictions</h2>
            <textarea value={restrictions} onChange={(e) => setRestrictions(e.target.value)} className="mt-4 min-h-[140px] w-full rounded-2xl border p-3 text-sm" />
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <div className={card + " p-6"}>
            <h2 className="text-xl font-semibold">Daily roster</h2>
            <p className="mt-2 text-sm text-slate-600">Paste roster text or extracted PDF text here.</p>
            <textarea value={rosterText} onChange={(e) => setRosterText(e.target.value)} className="mt-4 min-h-[320px] w-full rounded-2xl border p-3 font-mono text-sm" />
          </div>
          <div className={card + " p-6"}>
            <h2 className="text-xl font-semibold">Day calendar</h2>
            <p className="mt-2 text-sm text-slate-600">Format example: 0800-1200 HazMat refresher: Fink, Dupont, Mueller</p>
            <textarea value={calendarText} onChange={(e) => setCalendarText(e.target.value)} className="mt-4 min-h-[320px] w-full rounded-2xl border p-3 font-mono text-sm" />
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <div className={card + " p-6 xl:col-span-1"}>
            <h2 className="text-xl font-semibold">Parsed roster</h2>
            <div className="mt-4 space-y-2">
              {rosterPeople.map((p) => (
                <div key={p.unit + p.name} className="rounded-2xl bg-slate-100 p-3 text-sm">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-slate-600">{p.unit} • {p.seat} • {p.medic ? "Medic" : "Non-medic"}</div>
                  <div className="text-slate-500">{p.specialties || "No specialty markers parsed"}</div>
                </div>
              ))}
            </div>
          </div>

          <div className={card + " p-6 xl:col-span-2"}>
            <h2 className="text-xl font-semibold">Impacted personnel</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {results.impacted.map((p) => (
                <div key={p.unit + p.name + p.eventTitle} className="rounded-2xl bg-amber-50 p-4 text-sm">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-slate-700">{p.unit} • {p.seat} • {p.medic ? "Medic-critical" : "Body vacancy"}</div>
                  <div className="text-slate-600">Event: {p.eventTitle} {p.start && p.end ? `(${p.start}-${p.end})` : ""}</div>
                </div>
              ))}
              {!results.impacted.length && <div className="text-sm text-slate-500">No matches found yet. Check roster and calendar formatting.</div>}
            </div>
          </div>
        </div>

        <div className={card + " p-6"}>
          <h2 className="text-2xl font-semibold">Generated staffing options</h2>
          <div className="mt-6 grid gap-6 xl:grid-cols-3">
            {results.options.map((option) => (
              <div key={option.title} className="rounded-3xl bg-slate-100 p-5">
                <h3 className="text-lg font-semibold">{option.title}</h3>
                <div className="mt-4 space-y-3">
                  {option.rows.map((row) => (
                    <div key={row.vacancy + row.fill} className="rounded-2xl bg-white p-3 text-sm shadow-sm">
                      <div className="font-medium">{row.vacancy}</div>
                      <div className="mt-1 text-slate-700">Fill: <span className="font-medium">{row.fill}</span></div>
                      <div className="text-slate-700">From: <span className="font-medium">{row.from}</span></div>
                      <div className="mt-1 text-slate-500">{row.why}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
