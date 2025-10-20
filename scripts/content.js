/**
 * Scrapes Highspot pages to extract transcript and speaker data for either
 * Meeting Intelligence or Roleplay Results pages.
 * Final version with corrected selectors based on user-provided DOM.
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

        try {
            if (pageType === 'meeting') {
                data = { ...data, ...getTranscriptAndSpeakers() };
                data.success = !!data.transcript;
            } else if (pageType === 'roleplay') {
                data = { ...data, ...getRoleplayData() };
                data.success = !!data.transcript && data.assessedSkills.length > 0;
            }
        } catch (error) {
            console.error("Sales Coach Scraping Error:", error);
            data.success = false;
            data.error = error.message;
        }
        sendResponse(data);
    }
    return true;
});

/**
 * Detects the page type using direct, robust queries.
 * @returns {'meeting' | 'roleplay' | 'unknown'}
 */
function detectPageType() {
    const isMeeting = document.querySelector('[class*="TranscriptEntry-module__transcript-entry--"]');
    const isRoleplay = document.querySelector('[data-testid="view-assessment"]');

    if (isRoleplay) return 'roleplay';
    if (isMeeting) return 'meeting';
    return 'unknown';
}

/**
 * Scrapes the Roleplay Results page.
 * Selectors are now corrected to match the exact DOM structure.
 * @returns {{transcript: string, assessedSkills: {skill: string, score: number}[]}}
 */
function getRoleplayData() {
    // --- TRANSCRIPT SCRAPING ---
    const transcriptLines = [];
    const entries = document.querySelectorAll('div[class*="ViewAssessmentTranscriptEntry-module__entry--"]');
    if (!entries || entries.length === 0) {
        throw new Error("Could not find transcript entries.");
    }
    
    entries.forEach(entry => {
        const speakerEl = entry.querySelector('div[class*="ViewAssessmentTranscriptEntry-module__entry-speaker--"] span');
        const speaker = speakerEl ? speakerEl.textContent.trim() : 'Unknown';

        const textEl = entry.querySelector('span[class*="ViewAssessmentTranscriptEntry-module__entry-text--"]');
        const text = textEl ? textEl.textContent.trim() : '';

        if (text) {
            transcriptLines.push(`${speaker}: ${text}`);
        }
    });
    
    const fullTranscript = transcriptLines.join('\n');

    // --- ASSESSED SKILLS SCRAPING ---
    const assessedSkills = [];
    const skillElements = document.querySelectorAll('div[data-testid="assessment-skill-card"]');
    if (!skillElements || skillElements.length === 0) {
        throw new Error("Could not find skill cards.");
    }

    skillElements.forEach(el => {
        const skillContainer = el.closest('div[class*="AssessmentSkillList-module__skill-card-container--"]');
        const skillNameEl = skillContainer ? skillContainer.querySelector('h4[class*="AssessmentSkillCardSummary-module__title--"]') : null;
        const skillName = skillNameEl ? skillNameEl.textContent.trim() : null;

        let score = 0;
        // CORRECTED LOGIC: Find all potential score elements. The selected one
        // will have more than one class name. Its text content is the score.
        const scoreElements = el.querySelectorAll('div[class*="AssessmentSkillCardFeedback-module__score-value--"]');
        scoreElements.forEach(scoreNode => {
            if (scoreNode.classList.length > 1) {
                const scoreText = scoreNode.textContent.trim();
                const parsed = parseInt(scoreText, 10);
                if (!isNaN(parsed)) {
                    score = parsed;
                }
            }
        });

        if (skillName && score > 0) {
            assessedSkills.push({ skill: skillName, score: score });
        }
    });

    return {
        transcript: fullTranscript,
        assessedSkills: assessedSkills
    };
}


/* ========================================================================== */
/* =================== STABLE MEETING SCRAPING LOGIC (UNCHANGED) ============ */
/* ========================================================================== */

const INTERNAL_MATCH_THRESHOLD = 0.78; 

function stripDiacritics(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function canonName(s) {
    let t = stripDiacritics(String(s)).toLowerCase();
    t = t.replace(/\b(account|executive|exec|manager|director|turnitin|inc|ltd|llc)\b/g, " ");
    t = t.replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
    return t;
}

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

function nameSimilarity(a, b) {
    const jw = jaroWinkler(a, b);
    return jw;
}

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

    entries.forEach(entry => {
        const speakerEl = entry.querySelector('[class*="SpeakerInfoHeader-module__speaker-info-wrapper--"] > div > span:first-child');
        const textEl = entry.querySelector('[class*="EntryText-module__entry-text--"]');

        if (speakerEl && textEl) {
            const speakerName = speakerEl.textContent.trim();
            const text = textEl.textContent.trim().replace(/\s+/g, ' ');

            if (!speakersInTranscript.has(speakerName)) {
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

    for (const [speakerName, speakerData] of speakersInTranscript.entries()) {
        let isInternal = speakerRoleMap.get(speakerName);
        if (isInternal === undefined) {
            let bestScore = -1;
            let bestStatus = false;
            for (const [scrubberName, internalStatus] of speakerRoleMap.entries()) {
                const score = nameSimilarity(speakerName, scrubberName);
                if (score > bestScore) {
                    bestScore = score;
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

console.log("Sales Coach content script loaded (Corrected Selectors).");