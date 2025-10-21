// --- popup.js ---

// --- DOM ELEMENTS ---
const meetingFlowContainer = document.getElementById('meeting-flow-container');
const roleplayContainer = document.getElementById('roleplay-container');
const roleplaySkillsSummary = document.getElementById('roleplay-skills-summary');
const generateCoachingBtn = document.getElementById('generate-coaching-btn');
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
let pageType = 'unknown';
let transcriptText = "";
let pageSpeakers = [];
let assessedSkills = [];

// --- UI STATE MANAGEMENT ---
function showState(state) {
    const allContainers = [
        meetingFlowContainer, roleplayContainer, step1Container, step2Container,
        initialLoader, sellerSelectionContainer, skillsLoader,
        skillsSelectionContainer, finalLoader, resultsContainer
    ];
    allContainers.forEach(el => el.classList.add('hidden'));

    switch (state) {
        case 'initial-loading': initialLoader.classList.remove('hidden'); break;
        case 'seller-selection':
            meetingFlowContainer.classList.remove('hidden');
            step1Container.classList.remove('hidden');
            sellerSelectionContainer.classList.remove('hidden');
            break;
        case 'skills-loading':
            meetingFlowContainer.classList.remove('hidden');
            step1Container.classList.remove('hidden');
            sellerSelectionContainer.classList.remove('hidden');
            step2Container.classList.remove('hidden');
            skillsLoader.classList.remove('hidden');
            skillsLoader.querySelector('p').textContent = "Analyzing transcript for relevant skills...";
            break;
        case 'skills-selection':
            meetingFlowContainer.classList.remove('hidden');
            step1Container.classList.remove('hidden');
            sellerSelectionContainer.classList.remove('hidden');
            step2Container.classList.remove('hidden');
            skillsSelectionContainer.classList.remove('hidden');
            break;
        case 'roleplay-selection': roleplayContainer.classList.remove('hidden'); break;
        case 'assessment-loading': finalLoader.classList.remove('hidden'); break;
        case 'results': resultsContainer.classList.remove('hidden'); break;
        case 'error': resultsContainer.classList.remove('hidden'); break;
    }
}

/**
 * FINAL UPDATE: Added a console log for the full meeting transcript.
 */
function logAssessmentDetails(data, source = "New fetch") {
    const meta = data?.meta || {};
    const assessments = data?.assessments || [];
    const runId = meta.run_id || "n/a";

    console.groupCollapsed(`[Assessment Complete] Source: ${source} | Run ID: ${runId}`);
    console.log("Full Worker Response:", data);
    console.log("Worker Total Duration (ms):", meta.duration_ms);

    // Log the full transcript used for this assessment
    console.log("--- Full Meeting Transcript ---");
    console.log(transcriptText);
    console.log("--- End Transcript ---");


    if (assessments.length > 0) {
        const assessmentDetails = assessments.map(a => ({
            skill: a.skill,
            rating: a.rating,
            duration_ms: a._debug?.duration,
        }));
        console.log("Per-Skill Assessment Details:");
        console.table(assessmentDetails);
        console.log("Raw Judge Output for First Skill:", assessments[0]?._debug?.raw_judge);
    }
    console.groupEnd();
}

// --- DATA & STATE FUNCTIONS ---
function saveState() {
    if (pageType === 'meeting') {
        const selectedSeller = sellerSelect.value;
        const selectedSkills = Array.from(document.querySelectorAll('input[name="skill"]:checked')).map(cb => cb.id);
        const openCompetencies = Array.from(document.querySelectorAll('details[open] summary .competency-name')).map(s => s.textContent.trim());
        chrome.storage.local.set({ selectedSeller, selectedSkills, openCompetencies });
    }
}

async function loadAndApplyState() {
  const data = await chrome.storage.local.get([
    'assessmentStatus', 'assessmentStep', 'assessmentResult', 'assessmentError',
    'selectedSeller', 'qualifiedSkills', 'selectedSkills', 'openCompetencies'
  ]);

  if (data.assessmentStatus === 'assessment-complete' && data.assessmentResult) {
    renderResults(data.assessmentResult);
    logAssessmentDetails(data.assessmentResult, "Loaded from storage");
    showState('results');
  } else if (data.assessmentStatus === 'assessment-loading') {
    assessmentProgressText.textContent = data.assessmentStep || "Running assessment...";
    showState('assessment-loading');
  } else if (pageType === 'meeting' && data.assessmentStatus === 'skills-selection' && data.qualifiedSkills) {
    renderSkillSelector(data.qualifiedSkills); // This now handles the new data structure
    showState('skills-selection');
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
  } else if (data.assessmentStatus === 'error') {
    resultsContainer.innerHTML = `<div class="p-4 bg-red-50 text-red-700 rounded-md"><p class="font-bold">An Error Occurred:</p><p class="text-sm">${data.assessmentError || 'Unknown error'}</p></div>`;
    showState('error');
  } else {
    if (pageType === 'meeting') {
        showState('seller-selection');
        if (data.selectedSeller) sellerSelect.value = data.selectedSeller;
    } else if (pageType === 'roleplay') {
        showState('roleplay-selection');
    }
  }
}

function resetState() {
    chrome.runtime.sendMessage({ action: "clearState" }, () => {
        console.log("State cleared.");
        sellerSelect.innerHTML = '';
        competencySkillSelector.innerHTML = '';
        resultsContainer.innerHTML = '';
        roleplaySkillsSummary.innerHTML = '';
        initializePopup();
    });
}

// --- DYNAMIC UI RENDERING ---
function renderSkillSelector(qualifiedSkills = []) { // qualifiedSkills is now [{skill: "Name", cached: true}, ...]
    competencySkillSelector.innerHTML = '';
    const fragment = document.createDocumentFragment();

    // Create a map for easy lookup of skill name and its cached status
    const qualifiedSkillMap = new Map(qualifiedSkills.map(item => [item.skill, item.cached]));
    
    const qualifiedCompetencies = {};

    for (const competency in ALL_RUBRICS) {
        for (const skill in ALL_RUBRICS[competency].skills) {
            if (qualifiedSkillMap.has(skill)) {
                if (!qualifiedCompetencies[competency]) {
                    qualifiedCompetencies[competency] = { skills: {} };
                }
                // Store the cached status along with the skill
                qualifiedCompetencies[competency].skills[skill] = { cached: qualifiedSkillMap.get(skill) };
            }
        }
    }

    if (Object.keys(qualifiedCompetencies).length === 0) {
        competencySkillSelector.innerHTML = `<p class="text-sm text-gray-500 p-2">No skills with sufficient evidence were detected in the transcript.</p>`;
        runAssessmentBtn.disabled = true;
        return;
    }

    for (const competency in qualifiedCompetencies) {
        const details = document.createElement('details');
        details.className = "py-2 border-b last:border-b-0";
        details.innerHTML = `
            <summary class="flex items-center space-x-2 text-sm font-medium text-gray-800 hover:text-gray-900 cursor-pointer">
                <div class="arrow w-4 h-4"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-4 h-4 text-gray-500"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg></div>
                <input type="checkbox" class="competency-checkbox h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" data-competency="${competency}">
                <span class="competency-name ml-2">${competency}</span>
            </summary>
            <div class="skills-list pl-8 pt-2 space-y-2">
                ${Object.keys(qualifiedCompetencies[competency].skills).map(skill => {
                    const skillId = `${competency}|${skill}`;
                    const isCached = qualifiedCompetencies[competency].skills[skill].cached;
                    const cachedBadge = isCached ? ` <span class="ml-2 text-xs font-medium bg-blue-100 text-blue-800 py-0.5 px-2 rounded-full">Cached</span>` : '';
                    return `<div class="flex items-center">
                                <input type="checkbox" id="${skillId}" name="skill" value="${skillId}" class="skill-checkbox h-4 w-4 text-indigo-600 border-gray-300 rounded">
                                <label for="${skillId}" class="ml-2 block text-sm text-gray-700 flex items-center">${skill}${cachedBadge}</label>
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
        html += `<div class="bg-white p-4 rounded-lg shadow mt-2"><p class="text-red-500">The model returned an empty assessment. Please try again.</p></div>`;
    } else {
        assessments.forEach(assessment => {
            const strengthsList = (assessment.strengths || []).map(s => `<li>${s}</li>`).join('');
            const improvementTitle = assessment.improvement_title || "Areas for Improvement";
            
            const improvementsList = (assessment.improvements || []).map(imp => {
                let insteadOfLabel = "Instead of:";
                let tryThisLabel = "Try this:";
                let insteadOfColor = "text-gray-600";
                
                // For top performers, re-label to show how to apply their existing skills
                if (assessment.rating >= 5) {
                    insteadOfLabel = "Observed Action:";
                    tryThisLabel = "Next-Level Application:";
                    insteadOfColor = "text-blue-600"; // Use a different color to highlight the positive example
                }

                let exampleHTML = (imp.example && (imp.example.instead_of || imp.example.try_this)) ? `
                    <div class="mt-2 text-sm italic text-gray-500 border-l-4 border-gray-200 pl-3 space-y-2">
                        <p><strong class="${insteadOfColor}">${insteadOfLabel}</strong> "${imp.example.instead_of}"</p>
                        <p><strong class="text-green-600">${tryThisLabel}</strong> "${imp.example.try_this}"</p>
                    </div>` : '';

                return `<div class="border-t border-gray-200 pt-3 mt-3"><p class="text-gray-800 font-medium">${imp.point || 'General Improvement'}</p>${exampleHTML}</div>`;
            }).join('');

            const tipsList = (assessment.coaching_tips || []).map(tip => `<li>${tip}</li>`).join('');
            const ratingColor = assessment.rating >= 4 ? 'text-green-600' : assessment.rating >= 3 ? 'text-yellow-600' : 'text-red-600';

            html += `
                <div class="mt-4 bg-white p-6 rounded-lg shadow-md">
                    <div class="flex justify-between items-start mb-4">
                        <h3 class="text-lg font-bold text-gray-900">${assessment.skill}</h3>
                        <p class="text-2xl font-bold ${ratingColor}">${assessment.rating}<span class="text-base font-medium text-gray-500">/5</span></p>
                    </div>
                    <div class="mt-4"><h4 class="font-bold text-sm text-green-700 uppercase tracking-wider pb-1 border-b-2 border-green-200">Strengths Exhibited</h4><ul class="list-disc list-inside text-sm mt-2 space-y-2">${strengthsList || '<li>None identified.</li>'}</ul></div>
                    <div class="mt-6"><h4 class="font-bold text-sm text-yellow-700 uppercase tracking-wider pb-1 border-b-2 border-yellow-200">${improvementTitle}</h4><div class="text-sm mt-2 space-y-4">${improvementsList || '<p>None identified.</p>'}</div></div>
                    <div class="mt-6"><h4 class="font-bold text-sm text-blue-700 uppercase tracking-wider pb-1 border-b-2 border-blue-200">Coaching Tips</h4><ul class="list-disc list-inside text-sm mt-2 space-y-2">${tipsList || '<li>None identified.</li>'}</ul></div>
                </div>`;
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
    const selectedSeller = sellerSelect.value;
    if (!selectedSeller) { alert("Please select a seller to continue."); return; }
    saveState();
    chrome.runtime.sendMessage({
        action: "startSkillQualification",
        payload: { transcript: transcriptText, allSkills: Object.values(ALL_RUBRICS).flatMap(c => Object.keys(c.skills)), sellerId: selectedSeller }
    });
}

async function handleRunAssessment() {
  const selectedSeller = sellerSelect.value;
  const selectedSkills = Array.from(document.querySelectorAll('input[name="skill"]:checked')).map(cb => cb.id.split('|')[1]);
  if (!selectedSeller) { alert("Please select a seller to assess."); return; }
  if (selectedSkills.length === 0) { alert("Please select at least one skill to assess."); return; }
  showState('assessment-loading');
  chrome.runtime.sendMessage({
    action: "startFullAssessment",
    payload: { transcript: transcriptText, sellerId: selectedSeller, skills: selectedSkills }
  });
}

function handleGenerateCoaching() {
    showState('assessment-loading');
    assessmentProgressText.textContent = "Generating enhanced coaching...";
    chrome.runtime.sendMessage({
        action: "startCoaching",
        payload: { transcript: transcriptText, assessedSkills: assessedSkills }
    });
}

function getPageDataWithRetries(retries = 5, delay = 500) {
    return new Promise((resolve, reject) => {
        const attempt = (n) => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (chrome.runtime.lastError || !tabs || !tabs[0]?.id) {
                   if (n > 0) setTimeout(() => attempt(n - 1), delay);
                   else reject(new Error("Could not find active tab."));
                   return;
                }
                chrome.tabs.sendMessage(tabs[0].id, { action: "get_page_data" }, (response) => {
                    if (chrome.runtime.lastError || !response || !response.success) {
                        if (n > 0) setTimeout(() => attempt(n - 1), delay);
                        else reject(new Error("Failed to get required data from Highspot. Please ensure the page is fully loaded."));
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
        const response = await getPageDataWithRetries();
        pageType = response.type;
        transcriptText = response.transcript;

        if (pageType === 'meeting') {
            pageSpeakers = response.speakers || [];
            const internalSpeakers = pageSpeakers.filter(s => s.isInternal);
            if (internalSpeakers.length > 0) {
                sellerSelect.innerHTML = internalSpeakers.map(speaker => `<option value="${speaker.name}">${speaker.name}</option>`).join('');
                analyzeSkillsBtn.disabled = false;
            } else {
                sellerSelect.innerHTML = '<option value="">No internal speakers identified</option>';
                analyzeSkillsBtn.disabled = true;
            }
        } else if (pageType === 'roleplay') {
            assessedSkills = response.assessedSkills || [];
            if (assessedSkills.length > 0) {
                roleplaySkillsSummary.innerHTML = `<p class="font-medium text-gray-700">Found ${assessedSkills.length} assessed skill(s):</p><ul class="list-disc list-inside text-gray-600">${assessedSkills.map(s => `<li>${s.skill} (Score: ${s.score}/5)</li>`).join('')}</ul>`;
                generateCoachingBtn.disabled = false;
            } else {
                 roleplaySkillsSummary.innerHTML = `<p class="text-red-600">No assessed skills were found on this page.</p>`;
                 generateCoachingBtn.disabled = true;
            }
        } else {
            throw new Error("This is not a supported Highspot Meeting or Roleplay page.");
        }
        await loadAndApplyState();
    } catch (error) {
        showState('error');
        resultsContainer.classList.remove('hidden');
        resultsContainer.innerHTML = `<div class="p-4 bg-red-50 text-red-700 rounded-md"><p class="font-bold">Error Initializing:</p><p class="text-sm">${error.message}</p></div>`;
        console.error(error);
    }
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    // Event listeners
    analyzeSkillsBtn.addEventListener('click', handleAnalyzeSkills);
    runAssessmentBtn.addEventListener('click', handleRunAssessment);
    competencySkillSelector.addEventListener('change', handleSelectionChange);
    sellerSelect.addEventListener('change', saveState);
    selectAllBtn.addEventListener('click', () => selectAllSkills(true));
    deselectAllBtn.addEventListener('click', () => selectAllSkills(false));
    competencySkillSelector.addEventListener('toggle', saveState, true);
    generateCoachingBtn.addEventListener('click', handleGenerateCoaching);
    resetBtn.addEventListener('click', resetState);

    // Listener for changes from background script
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        
        if (changes.assessmentResult && changes.assessmentResult.newValue) {
             const statusChange = changes.assessmentStatus;
             if (statusChange && statusChange.newValue === 'assessment-complete' && statusChange.oldValue !== 'assessment-complete') {
                 logAssessmentDetails(changes.assessmentResult.newValue, "New assessment received");
             }
        }

        if (changes.assessmentStep || changes.assessmentStatus || changes.assessmentError || changes.qualifiedSkills) {
            loadAndApplyState();
        }
    });

    initializePopup();
});