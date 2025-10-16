/**
 * Scrapes Highspot pages to extract transcript and speaker data for either
 * Meeting Intelligence or Roleplay Results pages.
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "get_page_type") {
        const pageType = detectPageType();
        sendResponse({ type: pageType });
        return true;
    }

    if (request.action === "get_page_data") {
        const pageType = detectPageType();
        let data = { type: pageType, success: false };

        if (pageType === 'meeting') {
            data = { ...data, ...getTranscriptAndSpeakers() };
            data.success = !!data.transcript;
        } else if (pageType === 'roleplay') {
            data = { ...data, ...getRoleplayData() };
            data.success = !!data.transcript && data.assessedSkills.length > 0;
        }
        sendResponse(data);
    }
    return true; // Keep the message channel open for asynchronous response
});

/**
 * Detects whether the current page is a meeting intelligence or roleplay results page.
 * @returns {'meeting' | 'roleplay' | 'unknown'}
 */
function detectPageType() {
    const meetingCandidate = selectOneWithFallback({
        testId: 'transcript-entry',
        classPrefix: 'TranscriptEntry-module__transcript-entry'
    });

    // Use more resilient selectors that match the stable prefix emitted by CSS modules.
    const roleplayCandidate = selectOneWithFallback({
        testId: 'assessment-skill-card',
        classPrefix: 'AssessmentSkillList-module__root'
    });

    if (roleplayCandidate) return 'roleplay';
    if (meetingCandidate) return 'meeting';
    return 'unknown';
}


/**
 * Scrapes the Roleplay Results page for the transcript and assessed skills.
 * This function now uses the specific class names from your provided DOM structure.
 * @returns {{transcript: string, assessedSkills: {skill: string, score: number}[]}}
 */
function getRoleplayData() {
    // --- TRANSCRIPT SCRAPING ---
    const transcriptLines = [];
    const entries = selectAllWithFallback({
        testId: 'assessment-transcript-entry',
        classPrefix: 'ViewAssessmentTranscriptEntry-module__entry'
    });
    entries.forEach(entry => {
        const speakerEl = selectOneWithFallback({
            root: entry,
            testId: 'assessment-transcript-entry-speaker',
            classPrefix: 'ViewAssessmentTranscriptEntry-module__entry-speaker'
        })?.querySelector('span');
        const speaker = speakerEl ? speakerEl.textContent.trim() : 'Unknown';
        const textEl = selectOneWithFallback({
            root: entry,
            testId: 'assessment-transcript-entry-text',
            classPrefix: 'ViewAssessmentTranscriptEntry-module__entry-text'
        });
        const text = textEl ? textEl.textContent.trim() : '';

        if (text) {
            transcriptLines.push(`${speaker}: ${text}`);
        }
    });
    
    const fullTranscript = transcriptLines.join('\n');

    // --- NEW: Log the scraped transcript to the console ---
    console.debug('[Sales Coach Extension] Roleplay transcript scraped', fullTranscript);
    // ----------------------------------------------------


    // --- ASSESSED SKILLS SCRAPING ---
    const assessedSkills = [];
    // Select each skill card container
    const skillContainers = selectAllWithFallback({
        testId: 'assessment-skill-card-container',
        classPrefix: 'AssessmentSkillList-module__skill-card-container'
    });

    const skillElements = [];
    skillContainers.forEach(container => {
        const card = selectOneWithFallback({
            root: container,
            testId: 'assessment-skill-card'
        });
        if (card) {
            skillElements.push(card);
        }
    });

    skillElements.forEach(el => {
        const container = el.closest('[data-testid="assessment-skill-card-container"]')
            || el.closest('[class*="AssessmentSkillList-module__skill-card-container"]');
        const skillNameEl = container ? selectOneWithFallback({
            root: container,
            testId: 'assessment-skill-card-title',
            classPrefix: 'AssessmentSkillCardSummary-module__title'
        }) : null;
        const skillName = skillNameEl ? skillNameEl.textContent.trim() : null;

        let score = 0;
        // Find the score div that has the specific background/selected class
        const scoreEl = selectOneWithFallback({
            root: el,
            classPrefix: 'AssessmentSkillCardFeedback-module__score-',
            attributeFilter: el => el.matches('[style*="background-color"]')
        });
        if (scoreEl) {
            const scoreClass = Array.from(scoreEl.classList).find(c => /__score-\d+/.test(c));
            if (scoreClass) {
                const match = scoreClass.match(/__score-(\d+)/);
                if (match) {
                    score = parseInt(match[1], 10);
                }
            }
        }

        // Fallback for when style is not applied, get the number from the class
        if (score === 0) {
            const scoreValEl = selectOneWithFallback({
                root: el,
                testId: 'assessment-skill-card-score',
                classPrefix: 'AssessmentSkillCardFeedback-module__score-'
            });
            if (scoreValEl) {
                const scoreClass = Array.from(scoreValEl.classList).find(c => /__score-\d+/.test(c));
                if (scoreClass) {
                    const match = scoreClass.match(/__score-(\d+)/);
                    if (match) {
                        score = parseInt(match[1], 10);
                    }
                }
            }
        }


        if (skillName && score > 0) {
            assessedSkills.push({ skill: skillName, score: score });
        }
    });

    return {
        transcript: fullTranscript,
        assessedSkills: assessedSkills
    };
}

function selectOneWithFallback({ root = document, testId, classPrefix, attributeFilter }) {
    if (testId) {
        const byTestId = root.querySelector(`[data-testid="${testId}"]`);
        if (byTestId) {
            if (!attributeFilter || attributeFilter(byTestId)) {
                return byTestId;
            }
        }
    }

    if (classPrefix) {
        const selector = `[class*="${classPrefix}"]`;
        const candidates = root.querySelectorAll(selector);
        for (const candidate of candidates) {
            if (!attributeFilter || attributeFilter(candidate)) {
                return candidate;
            }
        }
    }

    return null;
}

function selectAllWithFallback({ root = document, testId, classPrefix }) {
    if (testId) {
        const nodes = root.querySelectorAll(`[data-testid="${testId}"]`);
        if (nodes.length) {
            return Array.from(nodes);
        }
    }

    if (classPrefix) {
        const nodes = root.querySelectorAll(`[class*="${classPrefix}"]`);
        if (nodes.length) {
            return Array.from(nodes);
        }
    }

    return [];
}


/* ========================================================================== */
/* =================== EXISTING MEETING SCRAPING LOGIC ====================== */
/* ========================================================================== */

// ... (The rest of the original content.js file, including getTranscriptAndSpeakers,
//      jaroWinkler, etc., remains unchanged here.)

/* =========================
   FUZZY NAME MATCH HELPERS
   ========================= */
const INTERNAL_MATCH_THRESHOLD = 0.78; 

function stripDiacritics(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function canonName(s) {
    // Lowercase, remove diacritics, drop common org/role words, strip punctuation
    let t = stripDiacritics(String(s)).toLowerCase();
    t = t.replace(/\b(account|executive|exec|manager|director|turnitin|inc|ltd|llc)\b/g, " ");
    t = t.replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
    return t;
}

// Jaro-Winkler similarity
function jaroWinkler(a, b) {
    a = canonName(a); b = canonName(b);
    const al = a.length, bl = b.length;
    if (!al && !bl) return 1;
    const dist = Math.floor(Math.max(al, bl) / 2) - 1;
    const am = new Array(al).fill(false), bm = new Array(bl).fill(false);
    let matches = 0, trans = 0;

    for (let i = 0; i < al; i++) {
        const st = Math.max(0, i - dist), en = Math.min(i + dist + 1, bl);
        for (let j = st; j < en; j++) {
            if (bm[j]) continue;
            if (a[i] !== b[j]) continue;
            am[i] = true; bm[j] = true; matches++; break;
        }
    }
    if (!matches) return 0;

    let k = 0;
    for (let i = 0; i < al; i++) {
        if (!am[i]) continue;
        while (!bm[k]) k++;
        if (a[i] !== b[k]) trans++;
        k++;
    }

    const jaro = ((matches / al) + (matches / bl) + ((matches - trans / 2) / matches)) / 3;
    let prefix = 0;
    for (let i = 0; i < Math.min(4, al, bl); i++) { if (a[i] === b[i]) prefix++; else break; }
    return jaro + prefix * 0.1 * (1 - jaro);
}

// Levenshtein ratio (optional blend)
function levenshteinRatio(a, b) {
    a = canonName(a); b = canonName(b);
    const n = a.length, m = b.length;
    if (!n && !m) return 1;
    if (!n || !m) return 0;
    const v0 = new Array(m + 1), v1 = new Array(m + 1);
    for (let j = 0; j <= m; j++) v0[j] = j;
    for (let i = 0; i < n; i++) {
        v1[0] = i + 1;
        for (let j = 0; j < m; j++) {
            const cost = (a[i] === b[j]) ? 0 : 1;
            v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
        }
        for (let j = 0; j <= m; j++) v0[j] = v1[j];
    }
    const dist = v1[m];
    return 1 - (dist / Math.max(n, m));
}

// Token Jaccard (optional blend)
function tokenJaccard(a, b) {
    const A = new Set(canonName(a).split(/\s+/).filter(Boolean));
    const B = new Set(canonName(b).split(/\s+/).filter(Boolean));
    if (!A.size && !B.size) return 1;
    let inter = 0; for (const t of A) if (B.has(t)) inter++;
    return inter / (A.size + B.size - inter || 1);
}

function nameSimilarity(a, b) {
    const jw = jaroWinkler(a, b);
    const lv = levenshteinRatio(a, b);
    const jc = tokenJaccard(a, b);
    // Favor JW but blend a bit of edit distance + token overlap
    return Math.max(jw, (jw * 0.6 + lv * 0.25 + jc * 0.15));
}

/**
 * Main function to orchestrate the scraping process for meetings.
 * It first identifies speaker roles from the timeline, then parses the transcript.
 * @returns {{transcript: string, speakers: {name: string, isInternal: boolean}[]}}
 */
function getTranscriptAndSpeakers() {
    const speakerRoleMap = getSpeakerRoles();

    const entries = document.querySelectorAll('[class*="TranscriptEntry-module__transcript-entry--"]');
    if (!entries.length) {
        console.error("Sales Coach Extension: No transcript entries found.");
        return { transcript: "", speakers: [] };
    }

    let transcriptLines = [];
    const speakersInTranscript = new Map();
    let lastSpeaker = null;

    // --- Step 1: Parse the transcript and gather all unique speakers ---
    entries.forEach(entry => {
        const speakerEl = entry.querySelector('[class*="SpeakerInfoHeader-module__speaker-info-wrapper--"] > div > span:first-child');
        const textEl = entry.querySelector('[class*="EntryText-module__entry-text--"]');

        if (speakerEl && textEl) {
            const speakerName = speakerEl.textContent.trim();
            const text = textEl.textContent.trim().replace(/\s+/g, ' ');

            if (!speakersInTranscript.has(speakerName)) {
                // default isInternal to false
                speakersInTranscript.set(speakerName, { name: speakerName, isInternal: false });
            }

            if (speakerName === lastSpeaker && transcriptLines.length > 0) {
                transcriptLines[transcriptLines.length - 1] += ' ' + text;
            } else {
                transcriptLines.push(`${speakerName}: ${text}`);
                lastSpeaker = speakerName;
            }
        }
    });

    // --- Step 2: Mark internal speakers using scrubber roles with FUZZY matching ---
    // speakerRoleMap: Map<scrubberDisplayName, boolean>
    for (const [speakerName, speakerData] of speakersInTranscript.entries()) {
        // Fast path: exact display match from scrubber
        let isInternal = speakerRoleMap.get(speakerName);

        if (isInternal === undefined) {
            // Fuzzy: find the best matching scrubber name to this transcript label
            let bestName = null;
            let bestScore = -1;
            let bestStatus = false;

            for (const [scrubberName, internalStatus] of speakerRoleMap.entries()) {
                const score = nameSimilarity(speakerName, scrubberName);
                if (score > bestScore) {
                    bestScore = score;
                    bestName = scrubberName;
                    bestStatus = internalStatus;
                }
            }

            if (bestScore >= INTERNAL_MATCH_THRESHOLD) {
                isInternal = bestStatus;
            } else {
                isInternal = false;
            }
        }

        speakerData.isInternal = !!isInternal;
    }

    return {
        transcript: transcriptLines.join('\n'),
        speakers: Array.from(speakersInTranscript.values())
    };
}

/**
 * Parses the speaker timeline to identify internal vs. external speakers.
 * @returns {Map<string, boolean>} A map of speaker names to a boolean (true if internal).
 */
function getSpeakerRoles() {
    const speakerRoleMap = new Map();
    const speakerScrubberContainers = document.querySelectorAll('[class*="MeetingScrubbers-module__scrubberContainer--"]');

    speakerScrubberContainers.forEach(container => {
        const nameEl = container.querySelector('[class*="MeetingScrubbers-module__displayName--"]');
        if (nameEl) {
            const name = nameEl.textContent.trim();
            const internalSegment = container.querySelector('[class*="MeetingScrubbers-module__internal--"]');
            speakerRoleMap.set(name, !!internalSegment);
        }
    });

    return speakerRoleMap;
}

console.log("Sales Coach content script loaded and ready (v2.0.01 - roleplay scraping).");