/**
 * Scrapes the Highspot Meeting Intelligence page to extract the transcript
 * and differentiate between internal and external speakers.
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getTranscriptData") {
        const data = getTranscriptAndSpeakers();
        // NEW: Log the cleaned transcript for debugging cache issues
        console.log("--- Cleaned Transcript ---");
        console.log(data.transcript);
        // END NEW
        sendResponse(data);
    }
    return true; 
});

/**
 * Main function to orchestrate the scraping process.
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

    entries.forEach(entry => {
        const speakerEl = entry.querySelector('[class*="SpeakerInfoHeader-module__speaker-info-wrapper--"] > div > span:first-child');
        const textEl = entry.querySelector('[class*="EntryText-module__entry-text--"]');

        if (speakerEl && textEl) {
            const speakerName = speakerEl.textContent.trim();
            const text = textEl.textContent.trim().replace(/\s+/g, ' ');

            if (!speakersInTranscript.has(speakerName)) {
                let isInternal = speakerRoleMap.get(speakerName); // Try for an exact match first.

                // If the exact match fails (e.g., "Megan Sexton" vs "Megan Leith Sexton"), try a fuzzy match.
                if (isInternal === undefined) {
                    // Find a key in the role map that contains the transcript name.
                    for (const [fullName, internalStatus] of speakerRoleMap.entries()) {
                        if (fullName.includes(speakerName)) {
                            isInternal = internalStatus;
                            break; // Stop after the first match.
                        }
                    }
                }
                
                // Default to false if no match was found.
                speakersInTranscript.set(speakerName, { name: speakerName, isInternal: isInternal || false });
                // --- END OF THE FIX ---
            }

            if (speakerName === lastSpeaker && transcriptLines.length > 0) {
                transcriptLines[transcriptLines.length - 1] += ' ' + text;
            } else {
                transcriptLines.push(`${speakerName}: ${text}`);
                lastSpeaker = speakerName;
            }
        }
    });

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

console.log("Sales Coach content script loaded and ready (v3 - resilient selectors).");