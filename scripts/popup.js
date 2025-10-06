// --- DOM ELEMENTS ---
const step1Container = document.getElementById('step-1-container');
const step2Container = document.getElementById('step-2-container');
const initialLoader = document.getElementById('initial-loader-container');
const sellerSelectionContainer = document.getElementById('seller-selection-container');
const sellerSelect = document.getElementById('seller-select');
const analyzeSkillsBtn = document.getElementById('analyze-skills-btn');
const skillsLoader = document.getElementById('skills-loader-container');
const skillsSelectionContainer = document.getElementById('skills-selection-container');
const competencySkillSelector = document.getElementById('competency-skill-selector');
const runAssessmentBtn = document.getElementById('run-assessment-btn');
const finalLoader = document.getElementById('final-loader-container');
const assessmentProgressText = document.getElementById('assessment-progress-text'); 
const resultsContainer = document.getElementById('results-container');
const selectAllBtn = document.getElementById('select-all-btn');
const deselectAllBtn = document.getElementById('deselect-all-btn');
const resetBtn = document.getElementById('reset-btn');

// --- GLOBAL STATE ---
let transcriptText = "";

// --- UI STATE MANAGEMENT ---
function showState(state) {
    [step1Container, step2Container, initialLoader, sellerSelectionContainer, skillsLoader, skillsSelectionContainer, finalLoader, resultsContainer].forEach(el => el.classList.add('hidden'));
    
    switch (state) {
        case 'initial-loading':
            step1Container.classList.remove('hidden');
            initialLoader.classList.remove('hidden');
            break;
        case 'seller-selection':
            step1Container.classList.remove('hidden');
            sellerSelectionContainer.classList.remove('hidden');
            break;
        case 'skills-loading':
            step1Container.classList.remove('hidden');
            sellerSelectionContainer.classList.remove('hidden');
            step2Container.classList.remove('hidden');
            skillsLoader.classList.remove('hidden');
            skillsLoader.querySelector('p').textContent = "Finding relevant skills...";
            break;
        case 'skills-selection':
            step1Container.classList.remove('hidden');
            sellerSelectionContainer.classList.remove('hidden');
            step2Container.classList.remove('hidden');
            skillsSelectionContainer.classList.remove('hidden');
            break;
        case 'assessment-loading':
            finalLoader.classList.remove('hidden');
            break;
        case 'results':
            resultsContainer.classList.remove('hidden');
            break;
        case 'error':
             resultsContainer.classList.remove('hidden');
            break;
    }
}

// --- DATA & STATE FUNCTIONS ---
function saveState() {
    const selectedSeller = sellerSelect.value;
    const selectedSkills = Array.from(document.querySelectorAll('input[name="skill"]:checked')).map(cb => cb.id);
    const openCompetencies = Array.from(document.querySelectorAll('details[open] summary .competency-name')).map(s => s.textContent.trim());
    chrome.storage.local.set({ selectedSeller, selectedSkills, openCompetencies });
}

async function loadAndApplyState() {
    const data = await chrome.storage.local.get(['assessmentStatus', 'assessmentStep', 'lastResult', 'lastError', 'selectedSeller', 'relevantSkills', 'selectedSkills', 'openCompetencies']);

    if (data.assessmentStatus === 'complete' && data.lastResult) {
        renderResults(data.lastResult);
        logAssessmentDetails(data.lastResult, "Loaded from storage");
        showState('results');
    } else if (data.assessmentStatus === 'assessment-loading') {
        assessmentProgressText.textContent = data.assessmentStep || "Running full assessment...";
        showState('assessment-loading');
    } else if (data.assessmentStatus === 'skills-loading') {
        showState('skills-loading');
    } else if (data.assessmentStatus === 'skills-selection' && data.relevantSkills) {
        await checkCachedAssessments(data.relevantSkills);
    } else if (data.assessmentStatus === 'error') {
        resultsContainer.innerHTML = `<div class="p-4 bg-red-50 text-red-700 rounded-md"><p class="font-bold">An Error Occurred:</p><p class="text-sm">${data.lastError || 'Unknown error'}</p></div>`;
        showState('error');
    } else {
        showState('seller-selection');
        if (data.selectedSeller) sellerSelect.value = data.selectedSeller;
    }
}

function resetState() {
    chrome.runtime.sendMessage({ action: "clearState" }, () => {
        console.log("State cleared.");
        sellerSelect.innerHTML = '';
        competencySkillSelector.innerHTML = '';
        resultsContainer.innerHTML = '';
        initializePopup();
    });
}

function logAssessmentDetails(data, source = "New fetch") {
    const meta = data?.meta || {};
    const timing = meta.timing || {};
    const runId = meta.run_id || "n/a";
    console.groupCollapsed(`[Assessment Complete] Source: ${source} | Run ID: ${runId}`);
    console.log("Full Worker Response:", data);
    console.log("Worker Total Duration (ms):", meta.duration_ms);
    console.log("Cache Hits:", { index: meta.kv_index_hit ? "✅" : "❌", assessment: meta.kv_assess_hit ? "✅" : "❌" });
    if (timing.index_ms) console.log("Indexing Timing:", { ms: timing.index_ms, segments: timing.index_segments });
    if (timing.assess && timing.assess.length > 0) {
        console.log("Per-Skill Assessment Timing:");
        console.table(timing.assess.map(a => ({ skill: a.skill, ms: a.ms, prompt_bytes: a.prompt_bytes, mode: a.mode })));
    }
    console.groupEnd();
}


// --- DYNAMIC UI RENDERING ---
function renderSkillSelector(relevantSkills = [], cachedStatus = {}) {
    competencySkillSelector.innerHTML = '';
    const fragment = document.createDocumentFragment();
    const relevantCompetencies = {};

    for (const competency in ALL_RUBRICS) {
        for (const skill in ALL_RUBRICS[competency].skills) {
            if (relevantSkills.includes(skill)) {
                if (!relevantCompetencies[competency]) {
                    relevantCompetencies[competency] = { skills: {} };
                }
                relevantCompetencies[competency].skills[skill] = {};
            }
        }
    }

    if (Object.keys(relevantCompetencies).length === 0) {
        competencySkillSelector.innerHTML = `<p class="text-sm text-gray-500">No specific skills were detected in the transcript that could be assessed.</p>`;
        runAssessmentBtn.disabled = true;
        return;
    }

    for (const competency in relevantCompetencies) {
        const details = document.createElement('details');
        details.className = "py-2 border-b last:border-b-0";
        details.innerHTML = `
            <summary class="flex items-center space-x-2 text-sm font-medium text-gray-800 hover:text-gray-900 cursor-pointer">
                <div class="arrow w-4 h-4 transform transition-transform duration-200">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-4 h-4 text-gray-500">
                        <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                </div>
                <input type="checkbox" class="competency-checkbox h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" data-competency="${competency}">
                <span class="competency-name ml-2">${competency}</span>
            </summary>
            <div class="skills-list pl-8 pt-2 space-y-2">
                ${Object.keys(relevantCompetencies[competency].skills).map(skill => {
                    const skillId = `${competency}|${skill}`;
                    const isCached = cachedStatus[skill];
                    return `
                    <div class="flex items-center justify-between">
                        <div class="flex items-center">
                            <input type="checkbox" id="${skillId}" name="skill" value="${skillId}" class="skill-checkbox h-4 w-4 text-indigo-600 border-gray-300 rounded">
                            <label for="${skillId}" class="ml-2 block text-sm text-gray-700">${skill}</label>
                        </div>
                        ${isCached ? '<span class="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">Cached</span>' : ''}
                    </div>`;
                }).join('')}
            </div>`;
        fragment.appendChild(details);
    }
    competencySkillSelector.appendChild(fragment);
    runAssessmentBtn.disabled = false;
}

function renderResults(resultData) {
    if (!resultData || !resultData.assessments) {
      resultsContainer.innerHTML = `<div class="bg-white p-4 rounded-lg shadow"><p class="text-red-500 font-bold">Error:</p><p class="text-sm text-gray-600">Could not display results because the assessment data is missing or malformed.</p></div>`;
      return;
    }

    const { assessments } = resultData;
    let html = `<div class="flex justify-between items-center"><h2 class="text-xl font-bold text-gray-800">Assessment Results</h2></div>`;

    if (!Array.isArray(assessments) || assessments.length === 0) {
        html += `<div class="bg-white p-4 rounded-lg shadow mt-2"><p class="text-red-500">The model returned an empty or invalid assessment.</p></div>`;
    } else {
        assessments.forEach(assessment => {
            const strengthsList = (assessment.strengths || []).map(s => `<li class="text-gray-700">${s}</li>`).join('');
            const improvementsList = (assessment.improvements || []).map(imp => {
                const quoteHTML = imp.quote ? `<blockquote class="mt-2 text-sm italic text-gray-500 border-l-4 border-gray-300 pl-3">"${imp.quote}"</blockquote>` : '';
                return `<div class="border-t border-gray-200 pt-3 mt-3"><p class="text-gray-800">${imp.point}</p>${quoteHTML}</div>`;
            }).join('');
            const tipsList = (assessment.coaching_tips || []).map(tip => `<li class="text-gray-700">${tip}</li>`).join('');
            const ratingColor = assessment.rating >= 4 ? 'text-green-600' : assessment.rating >= 3 ? 'text-yellow-600' : 'text-red-600';
            html += `<div class="mt-4 bg-white p-6 rounded-lg shadow-md"><div class="flex justify-between items-start mb-4"><h3 class="text-lg font-bold text-gray-900">${assessment.skill}</h3><p class="text-2xl font-bold ${ratingColor}">${assessment.rating}<span class="text-base font-medium text-gray-500">/5</span></p></div><div class="mt-4"><h4 class="font-bold text-sm text-green-700 uppercase tracking-wider pb-1 border-b-2 border-green-200">Strengths Exhibited</h4><ul class="list-disc list-inside text-sm mt-2 space-y-2">${strengthsList || '<li>None identified.</li>'}</ul></div><div class="mt-6"><h4 class="font-bold text-sm text-yellow-700 uppercase tracking-wider pb-1 border-b-2 border-yellow-200">Areas for Improvement</h4><div class="text-sm mt-2 space-y-4">${improvementsList || '<p>None identified.</p>'}</div></div><div class="mt-6"><h4 class="font-bold text-sm text-blue-700 uppercase tracking-wider pb-1 border-b-2 border-blue-200">Coaching Tips</h4><ul class="list-disc list-inside text-sm mt-2 space-y-2">${tipsList || '<li>None identified.</li>'}</ul></div></div>`;
        });
    }
    resultsContainer.innerHTML = html;
}

// --- EVENT HANDLERS & LOGIC ---
function handleSelectionChange(e) {
    const target = e.target;
    if (target.matches('.competency-checkbox')) {
        const competency = target.dataset.competency;
        document.querySelectorAll(`.skill-checkbox[id^="${competency}|"]`).forEach(cb => cb.checked = target.checked);
    }
    updateCompetencyCheckboxes();
    saveState();
}

function updateCompetencyCheckboxes() {
    document.querySelectorAll('.competency-checkbox').forEach(compCheckbox => {
        const competency = compCheckbox.dataset.competency;
        const skillCheckboxes = document.querySelectorAll(`.skill-checkbox[id^="${competency}|"]`);
        const allChecked = Array.from(skillCheckboxes).every(cb => cb.checked);
        const someChecked = Array.from(skillCheckboxes).some(cb => cb.checked);
        compCheckbox.checked = allChecked;
        compCheckbox.indeterminate = !allChecked && someChecked;
    });
}

function selectAllSkills(state) {
    document.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = state);
    updateCompetencyCheckboxes();
    saveState();
}

async function handleAnalyzeSkills() {
    showState('skills-loading');
    chrome.storage.local.set({ assessmentStatus: 'skills-loading' });
    chrome.runtime.sendMessage({
        action: "startPreAssessment",
        payload: {
            transcript: transcriptText,
            allSkills: Object.values(ALL_RUBRICS).flatMap(c => Object.keys(c.skills))
        }
    });
}

async function handleRunAssessment() {
    const selectedSeller = sellerSelect.value;
    const selectedSkills = Array.from(document.querySelectorAll('input[name="skill"]:checked')).map(cb => cb.id.split('|')[1]);
    if (!selectedSeller) { alert("Please select a seller to assess."); return; }
    if (selectedSkills.length === 0) { alert("Please select at least one skill to assess."); return; }
    
    showState('assessment-loading');

    const selectedRubrics = {};
    const checkedBoxes = Array.from(document.querySelectorAll('input[name="skill"]:checked'));
    checkedBoxes.forEach(cb => {
        const [competency, skill] = cb.id.split('|');
        if (ALL_RUBRICS[competency] && ALL_RUBRICS[competency].skills[skill]) {
            if (!selectedRubrics[competency]) {
                selectedRubrics[competency] = { skills: {} };
            }
            selectedRubrics[competency].skills[skill] = ALL_RUBRICS[competency].skills[skill];
        }
    });

    chrome.runtime.sendMessage({
        action: "startFullAssessment",
        payload: { transcript: transcriptText, sellerId: selectedSeller, skills: selectedSkills }
    });
}

async function checkCachedAssessments(relevantSkills) {
    showState('skills-loading');
    skillsLoader.querySelector('p').textContent = 'Checking for cached assessments...';
    
    const cachedStatus = await new Promise((resolve) => {
        const selectedSeller = sellerSelect.value;
        chrome.runtime.sendMessage({
            action: "checkCacheStatus",
            payload: { transcript: transcriptText, sellerId: selectedSeller, skills: relevantSkills }
        }, (response) => {
            resolve(response || {});
        });
    });

    renderSkillSelector(relevantSkills, cachedStatus);
    showState('skills-selection');
    
    const data = await chrome.storage.local.get(['selectedSkills', 'openCompetencies', 'selectedSeller']);
    if (data.selectedSeller) sellerSelect.value = data.selectedSeller;
    if (data.selectedSkills) {
        data.selectedSkills.forEach(skillId => {
            const checkbox = document.getElementById(skillId);
            if (checkbox) checkbox.checked = true;
        });
    }
    if (data.openCompetencies) {
         document.querySelectorAll('details').forEach(details => {
            const summaryText = details.querySelector('summary .competency-name').textContent.trim();
            if (data.openCompetencies.includes(summaryText)) details.open = true;
        });
    }
    updateCompetencyCheckboxes();
}

function getTranscriptWithRetries(retries = 5, delay = 500) {
    return new Promise((resolve, reject) => {
        const attempt = (n) => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (!tabs || tabs.length === 0 || !tabs[0].id) {
                   if (n > 0) setTimeout(() => attempt(n - 1), delay);
                   else reject(new Error("Could not find active tab."));
                   return;
                }
                chrome.tabs.sendMessage(tabs[0].id, { action: "getTranscriptData" }, (response) => {
                    if (chrome.runtime.lastError || !response || !response.transcript) {
                        console.log(`Attempt ${6-n}: Transcript not found, retrying...`);
                        if (n > 0) setTimeout(() => attempt(n - 1), delay);
                        else reject(new Error("Failed to get transcript from page. Ensure a Highspot page is open and fully loaded."));
                    } else {
                        resolve(response);
                    }
                });
            });
        };
        attempt(retries);
    });
}

async function initializePopup() {
    showState('initial-loading');
    try {
        const response = await getTranscriptWithRetries();
        
        transcriptText = response.transcript;
        console.log("--- Cleaned Transcript from content.js ---");
        console.log(transcriptText);

        const internalSpeakers = response.speakers.filter(s => s.isInternal);
        if (internalSpeakers.length > 0) {
            sellerSelect.innerHTML = internalSpeakers.map(speaker => `<option value="${speaker.name}">${speaker.name}</option>`).join('');
            analyzeSkillsBtn.disabled = false;
        } else {
            sellerSelect.innerHTML = '<option value="">No internal speakers identified</option>';
            analyzeSkillsBtn.disabled = true;
        }
        await loadAndApplyState();

    } catch (error) {
        showState('error');
        resultsContainer.classList.remove('hidden');
        resultsContainer.innerHTML = `<div class="p-4 bg-red-50 text-red-700 rounded-md"><p class="font-bold">Error Initializing:</p><p class="text-sm">${error.message}</p></div>`
        console.error(error);
    }
}


// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    runAssessmentBtn.addEventListener('click', handleRunAssessment);
    analyzeSkillsBtn.addEventListener('click', handleAnalyzeSkills);
    competencySkillSelector.addEventListener('change', handleSelectionChange);
    sellerSelect.addEventListener('change', saveState);
    selectAllBtn.addEventListener('click', () => selectAllSkills(true));
    deselectAllBtn.addEventListener('click', () => selectAllSkills(false));
    resetBtn.addEventListener('click', resetState);
    competencySkillSelector.addEventListener('toggle', saveState, true);

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.assessmentStatus || changes.lastResult || changes.assessmentStep)) {
            loadAndApplyState();
        }
    });

    initializePopup();
});