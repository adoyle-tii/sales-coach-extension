// --- background.js ---

// --- CONFIGURATION ---
const WORKER_URL = "https://sales-skills-assessment-engine.salesenablement.workers.dev";
const RUBRIC_KEY = "rubrics:v1";

// --- HELPERS ---
async function sha256Hex(s) {
    const data = new TextEncoder().encode(s);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --- MESSAGE LISTENER ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "startSkillQualification") {
        handleSkillQualification(request.payload);
        return true;
    }
    if (request.action === "startFullAssessment") {
        handleFullAssessment(request.payload);
        return true;
    }
    // This handler can remain for the roleplay functionality
    if (request.action === "startCoaching") {
        handleCoaching(request.payload);
        return true;
    }
    if (request.action === "clearState") {
        chrome.storage.local.clear(() => {
            console.log("Background cleared local storage.");
            sendResponse({ success: true });
        });
        return true;
    }
});


// --- API CALL HANDLERS ---

/**
 * NEW: Handles the unified skill qualification step by calling the new worker endpoint.
 * @param {object} payload - Contains transcript, allSkills, and sellerId.
 */
async function handleSkillQualification({ transcript, allSkills, sellerId }) {
    console.log("Background: Starting skill qualification for seller:", sellerId);
    try {
        await chrome.storage.local.set({ assessmentStatus: 'skills-loading', assessmentStep: 'Analyzing transcript for relevant skills...'});

        const response = await fetch(`${WORKER_URL}/qualify-skills`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript, allSkills, sellerId }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Skill qualification failed with status ${response.status}`);
        }
        const data = await response.json();

        // Store the qualified skills from the worker. The popup will use this to render the UI.
        await chrome.storage.local.set({
            assessmentStatus: 'skills-selection',
            qualifiedSkills: data.qualifiedSkills,
            sellerIdentity: data.sellerIdentity
        });

    } catch (error) {
        console.error("Background skill qualification error:", error);
        await chrome.storage.local.set({ assessmentStatus: 'error', lastError: error.message });
    }
}


/**
 * REFACTORED: Sends the full transcript and sellerId for a self-contained assessment.
 * @param {object} payload - Contains transcript, sellerId, and the array of selected skills.
 */
async function handleFullAssessment({ transcript, sellerId, skills }) {
  console.log("Background: Starting full assessment for skills:", skills);
  const requestUrl = `${WORKER_URL}/assess`;

  try {
    await chrome.storage.local.set({
      assessmentStatus: 'assessment-loading',
      assessmentStep: 'Step 1/2: Assessing skills against transcript...'
    });

    const payload = {
        transcript,
        skills,
        sellerId
    };

    const res = await fetch(requestUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    await chrome.storage.local.set({ assessmentStep: 'Step 2/2: Generating coaching feedback...' });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const errorMessage = errorData.error || `Worker responded with status ${res.status}`;
      throw new Error(errorMessage);
    }

    const result = await res.json();

    await chrome.storage.local.set({
      assessmentStatus: 'assessment-complete',
      assessmentResult: result
    });

  } catch (err) {
    console.error("Background: Full assessment failed:", err);
    await chrome.storage.local.set({
      assessmentStatus: 'assessment-error',
      assessmentError: err?.message || 'An unknown error occurred'
    });
  }
}

/**
 * Handles coaching for roleplays (can remain as is).
 * @param {object} payload - Contains transcript and assessedSkills.
 */
async function handleCoaching({ transcript, assessedSkills }) {
    console.log("Background script: Received coaching task for skills:", assessedSkills);
    try {
        await chrome.storage.local.set({
            assessmentStatus: 'assessment-loading',
            assessmentStep: 'Generating enhanced coaching feedback...'
        });

        const response = await fetch(`${WORKER_URL}/coach`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript, skills: assessedSkills }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Coaching worker failed with status ${response.status}`);
        }

        const result = await response.json();

        await chrome.storage.local.set({
            assessmentStatus: 'assessment-complete',
            assessmentResult: result
        });

    } catch (error) {
        console.error("Background coaching error:", error);
        await chrome.storage.local.set({
            assessmentStatus: 'assessment-error',
            assessmentError: error.message || 'Unknown error'
        });
    }
}