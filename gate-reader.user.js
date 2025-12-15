// ==UserScript==
// @name         Gate-Reader
// @namespace    Gate-Reader
// @version      1.0.2
// @description  Читает сообщения в чате gate-dzgas.com с помощью TTS.
// @author       hasteli guy s19
// @match        https://gate-dzgas.com/*
// @match        https://*.gate-dzgas.com/*
// @icon         https://raw.githubusercontent.com/hastelibrandiere/simple-mcserver/refs/heads/main/server-icon.png
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // --- CONFIGURATION & STATE ---
    const DEFAULT_SETTINGS = {
        enabled: false,
        voiceURI: null,
        volume: 1,
        rate: 1,
        pitch: 1,
        queueLimit: 64, // Default per request
        uiOpen: true
    };

    let settings = { ...DEFAULT_SETTINGS, ...GM_getValue('settings', {}) };
    
    // Validate Queue Limit on load
    if (settings.queueLimit < 1) settings.queueLimit = 1;
    if (settings.queueLimit > 9216) settings.queueLimit = 9216;

    let voices = [];
    let activeUtterances = 0;
    let queueGeneration = 0;
    let isResetting = false;
    let lastBufferedText = null;

    // --- UI CONSTRUCTION ---
    function createUI() {
        const style = document.createElement('style');
        style.textContent = `
            #gr-overlay {
                position: fixed;
                top: 20px;
                left: 20px;
                width: 320px;
                background-color: #000000;
                color: #00ff41;
                font-family: 'Courier New', Courier, monospace;
                border: 2px solid #003b00;
                padding: 15px;
                font-size: 14px;
                z-index: 99999;
                box-shadow: 0 0 10px rgba(0, 255, 65, 0.2);
                display: none;
                box-sizing: border-box;
            }
            #gr-overlay.visible { display: block; }
            
            #gr-toggle-btn {
                position: fixed;
                top: 20px;
                left: 20px;
                width: 40px;
                height: 40px;
                background: #000;
                border: 2px solid #00ff41;
                color: #00ff41;
                font-weight: bold;
                cursor: pointer;
                z-index: 100000;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: 'Courier New', monospace;
            }
            #gr-toggle-btn.hidden { display: none; }

            #gr-overlay h1 {
                font-size: 18px;
                text-align: center;
                border-bottom: 1px solid #00ff41;
                padding-bottom: 10px;
                margin: 0 0 15px 0;
                text-transform: uppercase;
                letter-spacing: 2px;
                display: flex;
                justify-content: space-between;
            }
            
            #gr-close-ui { cursor: pointer; }

            .gr-control-group { margin-bottom: 15px; }
            .gr-control-group label { display: block; margin-bottom: 5px; font-weight: bold; }
            
            #gr-overlay select {
                width: 100%;
                background: #000000;
                border: 1px solid #00ff41;
                color: #00ff41;
                outline: none;
                cursor: pointer;
                padding: 5px;
                box-sizing: border-box;
            }
            
            #gr-overlay input[type="number"] {
                width: 100%;
                background: #000000;
                border: 1px solid #00ff41;
                color: #00ff41;
                outline: none;
                padding: 5px;
                font-family: inherit;
                box-sizing: border-box;
            }

            /* Custom Slider Styling */
            #gr-overlay input[type=range] {
                -webkit-appearance: none;
                width: 100%;
                background: transparent;
                margin: 5px 0;
                box-sizing: border-box;
            }
            #gr-overlay input[type=range]:focus { outline: none; }

            /* Webkit (Chrome, Safari, Edge) */
            #gr-overlay input[type=range]::-webkit-slider-thumb {
                -webkit-appearance: none;
                height: 16px;
                width: 16px;
                background: #00ff41;
                cursor: pointer;
                margin-top: -7px;
                border: none;
            }
            #gr-overlay input[type=range]::-webkit-slider-runnable-track {
                width: 100%;
                height: 2px;
                cursor: pointer;
                background: #00ff41;
            }

            /* Firefox */
            #gr-overlay input[type=range]::-moz-range-thumb {
                height: 16px;
                width: 16px;
                background: #00ff41;
                cursor: pointer;
                border: none;
                border-radius: 0;
            }
            #gr-overlay input[type=range]::-moz-range-track {
                width: 100%;
                height: 2px;
                cursor: pointer;
                background: #00ff41;
            }

            .gr-switch-container {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 20px;
                border: 1px solid #00ff41;
                padding: 10px;
                background: #000000;
                box-sizing: border-box;
            }

            button#gr-power-btn {
                background-color: #000;
                color: #00ff41;
                border: 1px solid #00ff41;
                padding: 5px 15px;
                font-family: inherit;
                cursor: pointer;
                text-transform: uppercase;
                font-weight: bold;
            }
            button#gr-power-btn:hover { background-color: #00ff41; color: #000; }
            button#gr-power-btn.active { background-color: #00ff41; color: #000; }

            .gr-value-display { float: right; font-size: 12px; }
        `;
        document.head.appendChild(style);

        // Minimized Button
        const toggleBtn = document.createElement('div');
        toggleBtn.id = 'gr-toggle-btn';
        toggleBtn.textContent = 'GR';
        toggleBtn.onclick = () => toggleUI(true);
        document.body.appendChild(toggleBtn);

        // Main Overlay
        const overlay = document.createElement('div');
        overlay.id = 'gr-overlay';
        overlay.innerHTML = `
            <h1>Gate-Reader <span id="gr-close-ui">_</span></h1>

            <div class="gr-switch-container">
                <span class="status-text">SYSTEM STATUS:</span>
                <button id="gr-power-btn">OFFLINE</button>
            </div>

            <div class="gr-control-group">
                <label for="gr-queueLimit">QUEUE LIMIT (1-9216)</label>
                <input type="number" id="gr-queueLimit" min="1" max="9216">
            </div>

            <div class="gr-control-group">
                <label for="gr-voiceSelect">VOICE MODULE</label>
                <select id="gr-voiceSelect"></select>
            </div>

            <div class="gr-control-group">
                <label for="gr-volume">VOLUME <span id="gr-volVal" class="gr-value-display">1.0</span></label>
                <input type="range" id="gr-volume" min="0" max="1" step="0.1">
            </div>

            <div class="gr-control-group">
                <label for="gr-rate">RATE <span id="gr-rateVal" class="gr-value-display">1.0</span></label>
                <input type="range" id="gr-rate" min="0.1" max="2" step="0.1">
            </div>

            <div class="gr-control-group">
                <label for="gr-pitch">PITCH <span id="gr-pitchVal" class="gr-value-display">1.0</span></label>
                <input type="range" id="gr-pitch" min="0" max="2" step="0.1">
            </div>
        `;
        document.body.appendChild(overlay);

        // Event Listeners for UI
        document.getElementById('gr-close-ui').onclick = () => toggleUI(false);
        document.getElementById('gr-power-btn').onclick = togglePower;
        document.getElementById('gr-queueLimit').onchange = updateSettings;
        document.getElementById('gr-voiceSelect').onchange = updateSettings;
        document.getElementById('gr-volume').oninput = updateSettings;
        document.getElementById('gr-rate').oninput = updateSettings;
        document.getElementById('gr-pitch').oninput = updateSettings;

        // Initialize UI values
        initUIValues();
    }

    function toggleUI(show) {
        settings.uiOpen = show;
        const overlay = document.getElementById('gr-overlay');
        const btn = document.getElementById('gr-toggle-btn');
        
        if (show) {
            overlay.classList.add('visible');
            btn.classList.add('hidden');
        } else {
            overlay.classList.remove('visible');
            btn.classList.remove('hidden');
        }
        GM_setValue('settings', settings);
    }

    function initUIValues() {
        document.getElementById('gr-queueLimit').value = settings.queueLimit;
        document.getElementById('gr-volume').value = settings.volume;
        document.getElementById('gr-rate').value = settings.rate;
        document.getElementById('gr-pitch').value = settings.pitch;
        
        document.getElementById('gr-volVal').textContent = settings.volume;
        document.getElementById('gr-rateVal').textContent = settings.rate;
        document.getElementById('gr-pitchVal').textContent = settings.pitch;

        updatePowerBtn();
        toggleUI(settings.uiOpen);
    }

    function updatePowerBtn() {
        const btn = document.getElementById('gr-power-btn');
        btn.textContent = settings.enabled ? "ONLINE" : "OFFLINE";
        if (settings.enabled) btn.classList.add('active');
        else btn.classList.remove('active');
    }

    function togglePower() {
        settings.enabled = !settings.enabled;
        updatePowerBtn();
        
        if (!settings.enabled) {
            // Hard Stop
            window.speechSynthesis.cancel();
            activeUtterances = 0;
            isResetting = false;
        }
        GM_setValue('settings', settings);
    }

    function updateSettings(e) {
        const target = e.target;
        
        if (target.id === 'gr-queueLimit') {
            let val = parseInt(target.value);
            if (isNaN(val) || val < 1) val = 1;
            if (val > 9216) val = 9216;
            settings.queueLimit = val;
            target.value = val;
        } 
        else if (target.id === 'gr-voiceSelect') {
            settings.voiceURI = target.value;
        }
        else if (target.id === 'gr-volume') {
            settings.volume = parseFloat(target.value);
            document.getElementById('gr-volVal').textContent = settings.volume;
        }
        else if (target.id === 'gr-rate') {
            settings.rate = parseFloat(target.value);
            document.getElementById('gr-rateVal').textContent = settings.rate;
        }
        else if (target.id === 'gr-pitch') {
            settings.pitch = parseFloat(target.value);
            document.getElementById('gr-pitchVal').textContent = settings.pitch;
        }

        GM_setValue('settings', settings);
    }

    // --- LOGIC ---

    function initVoices() {
        voices = window.speechSynthesis.getVoices();
        const select = document.getElementById('gr-voiceSelect');
        if (!select) return;

        select.innerHTML = '';
        voices.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice.voiceURI;
            option.textContent = `${voice.name} (${voice.lang})`;
            if (voice.lang.includes('ru')) option.style.fontWeight = 'bold';
            select.appendChild(option);
        });

        if (settings.voiceURI) {
            select.value = settings.voiceURI;
        }
    }

    function resetQueue() {
        // "Restart" internal state
        activeUtterances = 0;
        queueGeneration++;
        
        // Enter reset/cooldown
        isResetting = true;
        
        // Cancel TTS
        window.speechSynthesis.cancel();
        console.log('[Gate-Reader] Queue limit reached. Resetting...');

        // Wait for TTS to stand/clear completely (Cooldown)
        setTimeout(() => {
            console.log('[Gate-Reader] Reset Complete. Resuming with latest.');
            isResetting = false;

            // Immediately go to the very last position if available
            if (lastBufferedText) {
                console.log('[Gate-Reader] Skipping to latest:', lastBufferedText);
                doSpeak(lastBufferedText, queueGeneration);
                lastBufferedText = null;
            }
        }, 500); // 500ms safety buffer
    }

    function doSpeak(text, generation) {
        if (!settings.enabled) return;

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.volume = settings.volume;
        utterance.rate = settings.rate;
        utterance.pitch = settings.pitch;

        if (settings.voiceURI) {
            const selectedVoice = voices.find(v => v.voiceURI === settings.voiceURI);
            if (selectedVoice) utterance.voice = selectedVoice;
        }

        const onFinish = () => {
            if (generation === queueGeneration && activeUtterances > 0) {
                activeUtterances--;
            }
        };

        utterance.onend = onFinish;
        utterance.onerror = onFinish;

        window.speechSynthesis.speak(utterance);
        activeUtterances++;
    }

    function speak(text) {
        if (!settings.enabled || !text) return;

        // If resetting, just buffer the latest
        if (isResetting) {
            lastBufferedText = text;
            return;
        }

        // Check queue limit
        if (activeUtterances >= settings.queueLimit) {
            console.log(`[Gate-Reader] Queue limit (${settings.queueLimit}) reached.`);
            lastBufferedText = text; // Buffer latest
            resetQueue();
            return;
        }

        doSpeak(text, queueGeneration);
    }

    function processNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
            const text = node.innerText.trim();
            
            // Connection reset logic
            if (text.includes("Вы подключились к чату") && node.parentElement && node.parentElement.childElementCount === 1) {
                console.log('[Gate-Reader] Connection reset detected.');
                lastBufferedText = null;
                resetQueue();
                return;
            }

            if (text && text.length > 0) {
                speak(text);
            }

            const images = node.getElementsByTagName('img');
            if (images.length > 0) {
                for (let img of images) {
                    if (img.alt) speak(img.alt);
                }
            }
        }
    }

    function startObserver() {
        const targetNode = document.querySelector('.chat-messages');

        if (!targetNode) {
            console.log('[Gate-Reader] Waiting for .chat-messages...');
            setTimeout(startObserver, 2000);
            return;
        }

        console.log('[Gate-Reader] Observer attached.');
        const config = { childList: true, subtree: true };
        const observer = new MutationObserver((mutationsList) => {
            if (!settings.enabled) return;
            for(const mutation of mutationsList) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(processNode);
                }
            }
        });
        observer.observe(targetNode, config);
    }

    // --- INITIALIZATION ---
    createUI();
    initVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = initVoices;
    }
    startObserver();

})();