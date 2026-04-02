import { policyRules } from "./policyRules";

function normalize(text = "") {
  return text.toLowerCase().trim();
}

export function searchPolicyRules(query = "") {
  const q = normalize(query);

  if (!q) return policyRules.rules;

  return policyRules.rules
    .map((rule) => {
      let score = 0;

      if (normalize(rule.topic).includes(q)) score += 6;
      if (normalize(rule.category).includes(q)) score += 4;
      if (normalize(rule.rule).includes(q)) score += 5;
      if (normalize(rule.source).includes(q)) score += 3;
      if (normalize(rule.reference).includes(q)) score += 2;

      for (const keyword of rule.keywords || []) {
        if (normalize(keyword).includes(q) || q.includes(normalize(keyword))) {
          score += 3;
        }
      }

      for (const token of q.split(/\s+/).filter(Boolean)) {
        if (normalize(rule.topic).includes(token)) score += 2;
        if (normalize(rule.rule).includes(token)) score += 2;
        if ((rule.keywords || []).some((k) => normalize(k).includes(token))) score += 1;
      }

      return { ...rule, score };
    })
    .filter((rule) => rule.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function generatePolicyResponse(question = "") {
  const matches = searchPolicyRules(question).slice(0, 3);

  if (!matches.length) {
    return "I could not find a strong policy match. Try asking about OOS limits, overtime, T1, E101, HR1, HazMat, or Special Operations minimum staffing.";
  }

  const best = matches[0];
  const supporting = matches.slice(1);

  let response = `${best.rule}\n\nSource: ${best.source} ${best.reference}.`;

  if (supporting.length) {
    response += "\n\nRelated rules:";
    for (const rule of supporting) {
      response += `\n- ${rule.topic}: ${rule.rule} (${rule.source} ${rule.reference})`;
    }
  }

  return response;
}

export { policyRules };
