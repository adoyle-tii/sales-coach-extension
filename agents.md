# Sales Coach Agent Documentation

This document outlines the architecture and workflow of the Sales Coach browser extension, an AI-powered agent designed to provide coaching feedback on sales skills by analyzing conversations within the Highspot platform.

---

## Agent Overview

The Sales Coach is a sophisticated agent composed of two primary components: a **Chrome browser extension** that serves as the user-facing interface and data scraper, and a **Cloudflare Worker** that acts as the backend AI processing engine.

The agent's purpose is to analyze two types of content within Highspot:
1.  **Meeting Intelligence Transcripts:** For these, the agent performs a full analysis, from identifying relevant skills to scoring a seller against predefined rubrics and generating coaching feedback.
2.  **Roleplay Results:** For roleplays, the agent leverages the existing scores provided by Highspot to generate enhanced, AI-driven coaching without re-scoring the interaction.

---

## Core Components

### 1. Chrome Browser Extension

The extension is the user's entry point to the agent's capabilities. It is responsible for gathering data from the active Highspot page, managing user interaction, and displaying the final results.

* **Content Script (`content.js`):** This is the agent's eyes on the page. When a user is on a Highspot Meeting or Roleplay page, this script automatically activates to:
    * **Detect Page Type:** It first determines whether the page contains a 'meeting' transcript or a 'roleplay' assessment.
    * **Scrape Data:** Based on the page type, it extracts the full conversation transcript and identifies all speakers. For roleplays, it also scrapes the specific skills that were assessed and the scores they received.

* **Popup UI (`popup.html` & `popup.js`):** This is the interactive user interface.
    * It initiates the process by requesting the scraped data from the content script.
    * It dynamically adapts its display based on whether a meeting or roleplay was detected.
    * It guides the user through the assessment workflow, handles skill selection, and displays loading animations and final results.

* **Background Script (`background.js`):** This script is the central nervous system of the extension.
    * It acts as a bridge between the popup UI and the cloud worker.
    * It receives requests from the popup to start a pre-assessment, a full assessment, or a coaching generation.
    * It makes the necessary API calls to the appropriate endpoints on the Cloudflare Worker.
    * It manages the application state using `chrome.storage`, allowing the assessment process to continue even if the popup is closed. It stores the final results, which the popup then retrieves for display.

* **Rubrics (`rubric.js`):** This file contains a predefined JSON object that maps all sales competencies to their respective skills. This data is used locally by the popup to construct the skill selection interface.

### 2. Cloudflare Worker (`worker.js`)

The worker is the brain of the operation, handling all the complex AI logic and communication with large language models (LLMs). It exposes multiple endpoints to perform distinct tasks.

* **/pre-assess Endpoint:**
    * **Purpose:** To prevent irrelevant assessments, this endpoint analyzes a meeting transcript to see which sales skills are actually present in the conversation.
    * **Process:** It receives the transcript and the list of all possible skills, then uses a Gemini model to identify and return a list of only the skills that have enough evidence to be assessed.

* **/assess Endpoint (Meeting Intelligence):**
    * **Purpose:** To conduct a deep-dive assessment of a seller's performance in a meeting.
    * **Process:** This involves a multi-step AI pipeline:
        1.  **Indexing:** The worker first processes the transcript to identify the seller's dialogue, extracting their quotes and relevant customer cues.
        2.  **Judge Model:** For each skill the user selected, it invokes a "Judge" LLM. This model is given a strict system prompt (`OR_SYSTEM_JUDGE`) and the specific rubric for the skill. Its sole job is to act as a hyper-literal grader, comparing the seller's quotes to the rubric's criteria and producing a structured JSON output of its findings.
        3.  **Coach Model:** The output from the Judge is then passed to a separate "Coach" LLM. Guided by its own system prompt (`OR_SYSTEM_COACH`), this model synthesizes the raw scoring into actionable, human-readable feedback, including strengths, areas for improvement with concrete examples, and coaching tips.

* **/coach Endpoint (Roleplay):**
    * **Purpose:** To provide enhanced coaching for pre-scored roleplays.
    * **Process:** This is a more direct workflow that skips the judging phase. The worker receives the transcript and the skills with their existing scores. It then immediately passes this context to the Coach model, which generates detailed feedback based on the provided score and transcript evidence.

---

## Agent Workflow

### A) Meeting Intelligence Assessment

1.  **Initiation:** The user opens the extension on a Highspot Meeting Intelligence page. The content script scrapes the transcript.
2.  **Seller Selection:** The user selects the seller from a list of internal participants in the popup UI.
3.  **Pre-assessment:** The user clicks "Analyze". The background script calls the `/pre-assess` worker endpoint. The worker's AI identifies relevant skills, which are then displayed in the UI.
4.  **Skill Selection:** The user selects the desired skills for the full assessment.
5.  **Full Assessment:** The user clicks "Run Full Assessment". The background script calls the `/assess` worker endpoint.
6.  **AI Processing:** The worker executes its "Index -> Judge -> Coach" pipeline.
7.  **Results:** The final JSON containing the detailed coaching is sent back to the background script, stored, and then rendered in the popup UI for the user.

### B) Roleplay Enhanced Coaching

1.  **Initiation:** The user opens the extension on a Highspot Roleplay Results page. The content script scrapes the transcript *and* the existing skill scores.
2.  **Generate Coaching:** The popup displays the scraped skills and a "Generate Enhanced Coaching" button. When clicked, the background script calls the `/coach` worker endpoint.
3.  **AI Coaching:** The worker's Coach model generates feedback based on the provided scores and transcript.
4.  **Results:** The coaching feedback is returned and displayed in the UI.