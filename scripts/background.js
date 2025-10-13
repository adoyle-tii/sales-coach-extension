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
    if (request.action === "startPreAssessment") {
        handlePreAssessment(request.payload);
        return true; 
    }
    if (request.action === "startFullAssessment") {
        handleFullAssessment(request.payload);
        return true;
    }
    if (request.action === "checkCacheStatus") {
        handleCacheCheck(request.payload).then(sendResponse);
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

async function handlePreAssessment({ transcript, allSkills }) {
    console.log("Background script: Received pre-assessment task.");
    try {
        await chrome.storage.local.set({ assessmentStatus: 'skills-loading', assessmentStep: 'Analyzing for relevant skills...'});
        const cacheKey = `pre-assess-${await sha256Hex(transcript)}`;
        const cachedData = await chrome.storage.local.get(cacheKey);
        if (cachedData[cacheKey]) {
            console.log("Background script: Local pre-assessment cache HIT.");
            await chrome.storage.local.set({
                assessmentStatus: 'skills-selection',
                relevantSkills: cachedData[cacheKey]
            });
            return;
        }
        console.log("Background script: Local pre-assessment cache MISS. Calling worker.");

        const response = await fetch(`${WORKER_URL}/pre-assess`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript, allSkills }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Pre-assessment worker failed with status ${response.status}`);
        }
        const data = await response.json();
        
        await chrome.storage.local.set({
            assessmentStatus: 'skills-selection',
            relevantSkills: data.skills,
            [cacheKey]: data.skills // Store in local cache
        });

    } catch (error) {
        console.error("Background pre-assessment error:", error);
        await chrome.storage.local.set({ assessmentStatus: 'error', lastError: error.message });
    }
}

async function handleFullAssessment({ transcript, sellerId, skills }) {
  console.log("Background script: Received full assessment task for skills:", skills);
  const requestUrl =
    `${WORKER_URL}/assess?rubric_set=${encodeURIComponent(RUBRIC_KEY)}`;

  try {
    await chrome.storage.local.set({
      assessmentStatus: 'assessment-loading',
      assessmentStep: 'Step 1/3: Indexing transcript...'
    });

    const payload = {
        transcript,
        skills,
        seller_identity: sellerId,
        speaker_whitelist: [sellerId],
        seller: sellerId,
        sellerId
    };

    const res = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }).catch(err => {
      throw new Error(`Network error: ${err?.message || String(err)}`);
    });

    await chrome.storage.local.set({ assessmentStep: 'Step 2/3: Assessing skills...' });

    if (!res.ok) {
      let errText = '';
      try { errText = (await res.json())?.error ?? ''; } catch { /* ignore */ }
      if (!errText) { try { errText = await res.text(); } catch { /* ignore */ } }
      throw new Error(errText || `Worker responded with ${res.status}`);
    }

    await chrome.storage.local.set({ assessmentStep: 'Step 3/3: Generating coaching feedback...' });

    const result = await res.json();

    await chrome.storage.local.set({
      assessmentStatus: 'assessment-complete',
      assessmentResult: result
    });

    // Optional; guarded so it never throws if popup isn’t open
    try { chrome.runtime.sendMessage({ type: 'assessment-complete' }, () => void chrome.runtime.lastError); } catch (_) {}

    console.log("Background script: Assessment complete.");
  } catch (err) {
    console.error("Background script: Full assessment failed:", err);
    await chrome.storage.local.set({
      assessmentStatus: 'assessment-error',
      assessmentError: err?.message || 'Unknown error'
    });
    try { chrome.runtime.sendMessage({ type: 'assessment-error' }, () => void chrome.runtime.lastError); } catch (_) {}
  }
}

async function handleCacheCheck({ transcript, sellerId, skills }) {
    console.log("Background script: Received cache status check for skills:", skills);
    try {
        const response = await fetch(`${WORKER_URL}/check-cache-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript, sellerId, skills })
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Cache check failed with status ${response.status}`);
        }
        const cachedStatus = await response.json();
        return cachedStatus;
    } catch (error) {
        console.error("Background cache check error:", error);
        return {}; // Return empty object on error
    }
}