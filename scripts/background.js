// --- background.js ---

// --- CONFIGURATION ---
const WORKER_URL = "https://sales-skills-assessment-engine.salesenablement.workers.dev";

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
    if (request.action === "startCoaching") {
        handleCoaching(request.payload); // This remains for the roleplay feature
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

// --- CORRECTED MULTI-STAGE ASSESSMENT HANDLER WITH KV CACHE LOGIC ---
async function handleFullAssessment({ transcript, sellerId, skills }) {
  console.log("Background: Starting multi-stage assessment for skills:", skills);
  const t0 = Date.now();
  
  try {
    // --- Stage 1: Judging (with Cache Check) ---
    await chrome.storage.local.set({
      assessmentStatus: 'assessment-loading',
      assessmentStep: `Step 1/2: Assessing skills against transcript...`
    });

    const judgePromises = skills.map(skill => {
        return fetch(`${WORKER_URL}/judge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript, skill, sellerId })
        }).then(res => {
            if (!res.ok) throw new Error(`Judge endpoint failed for skill: ${skill}`);
            return res.json();
        });
    });
    
    const judgeResults = await Promise.all(judgePromises);

    const cachedAssessments = judgeResults.filter(res => res.meta?.kv_hit);
    const resultsToCoach = judgeResults.filter(res => !res.meta?.kv_hit);

    let finalAssessments = [...cachedAssessments];

    if (resultsToCoach.length > 0) {
        // --- Stage 2: Coaching (Only if necessary) ---
        await chrome.storage.local.set({
          assessmentStep: `Step 2/2: Generating coaching feedback...`
        });

        const coachPromises = resultsToCoach.map(judgeResult => {
            return fetch(`${WORKER_URL}/coach`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(judgeResult)
            }).then(res => {
                if (!res.ok) throw new Error(`Coach endpoint failed for skill: ${judgeResult.skillName}`);
                return res.json();
            });
        });

        const coachedAssessments = await Promise.all(coachPromises);
        finalAssessments.push(...coachedAssessments);
    }

    // --- Finalize ---
    const finalResult = {
        assessments: finalAssessments,
        meta: { duration_ms: Date.now() - t0, run_id: crypto.randomUUID() },
        seller_identity: sellerId
    };

    await chrome.storage.local.set({
      assessmentStatus: 'assessment-complete',
      assessmentResult: finalResult
    });

  } catch (err) {
    console.error("Background: Multi-stage assessment failed:", err);
    await chrome.storage.local.set({
      assessmentStatus: 'assessment-error',
      assessmentError: err?.message || 'An unknown error occurred'
    });
  }
}


async function handleCoaching({ transcript, assessedSkills }) {
    console.log("Background script: Received roleplay coaching task for skills:", assessedSkills);
    try {
        await chrome.storage.local.set({
            assessmentStatus: 'assessment-loading',
            assessmentStep: 'Generating enhanced coaching feedback...'
        });

        const response = await fetch(`${WORKER_URL}/coach-roleplay`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript, skills: assessedSkills }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Roleplay coaching worker failed with status ${response.status}`);
        }

        const result = await response.json();

        await chrome.storage.local.set({
            assessmentStatus: 'assessment-complete',
            assessmentResult: result
        });

    } catch (error) {
        console.error("Background roleplay coaching error:", error);
        await chrome.storage.local.set({
            assessmentStatus: 'assessment-error',
            assessmentError: error.message || 'Unknown error'
        });
    }
}