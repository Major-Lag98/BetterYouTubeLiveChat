// Pure utility functions shared between content.js (browser) and unit tests (Node).
// Loaded before content.js via manifest.json content_scripts.

function normalizeLeet(text) {
    return text
        .toLowerCase()
        .replace(/[@4]/g,  'a')
        .replace(/3/g,     'e')
        .replace(/[1!|]/g, 'i')
        .replace(/0/g,     'o')
        .replace(/[$5]/g,  's')
        .replace(/7/g,     't');
}

function buildBannedRegex(words) {
    const list = (words ?? []).map(w => String(w).trim()).filter(Boolean);
    if (list.length === 0) return null;
    // Normalize the patterns so they match normalized input (e.g. "trump 2028" → "trump 2o28")
    const normalized = list.map(w => normalizeLeet(w));
    const escaped = normalized.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'i');
}

if (typeof module !== 'undefined') module.exports = { normalizeLeet, buildBannedRegex };
