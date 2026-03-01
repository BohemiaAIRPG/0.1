const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
let ws;

function connectWebSocket() {
    ws = new WebSocket(`${wsProtocol}//${location.host}`);

    ws.onopen = () => {
        const savedSessionId = localStorage.getItem('rpg_session_id');
        if (savedSessionId) {
            ws.send(JSON.stringify({ type: 'reconnect', sessionId: savedSessionId }));
        }
    };

    ws.onmessage = handleMessage;

    ws.onclose = () => {
        console.log('WebSocket disconnected. Reconnecting in 2 seconds...');
        setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        ws.close();
    };
}

connectWebSocket();

const chatLog = document.getElementById('chat-log');
const actionInput = document.getElementById('action-input');
const sendBtn = document.getElementById('send-btn');
const loading = document.getElementById('loading');

// UI Elements
const hpFill = document.getElementById('hp-fill');
const hpText = document.getElementById('hp-text');
const staminaFill = document.getElementById('stamina-fill');
const staminaText = document.getElementById('stamina-text');
const satietyFill = document.getElementById('satiety-fill');
const satietyText = document.getElementById('satiety-text');
const locDisplay = document.getElementById('loc-display');
const timeDisplay = document.getElementById('time-display');
const coinsDisplay = document.getElementById('coins');
const reputationDisplay = document.getElementById('reputation');
const morFill = document.getElementById('mor-fill');
const morText = document.getElementById('mor-text');
const weaponDisplay = document.getElementById('weapon-display');
const armorDisplay = document.getElementById('armor-display');
const professionDisplay = document.getElementById('profession-display');
const inventoryList = document.getElementById('inventory-list');
const skillsList = document.getElementById('skills-list');
const relationshipsList = document.getElementById('relationships-list');
const questsList = document.getElementById('quests-list');
const shortcodeDisplay = document.getElementById('shortcode-display');
const aiChoicesContainer = document.getElementById('ai-choices-container');
const choicesHeader = document.getElementById('choices-header');
const aiChoices = document.getElementById('ai-choices');
const sceneImageContainer = document.getElementById('scene-image-container');

// Logic for Collapsible AI Choices
let userCollapsedChoices = false;

if (choicesHeader && aiChoices) {
    choicesHeader.addEventListener('click', () => {
        choicesHeader.classList.toggle('collapsed');
        aiChoices.classList.toggle('collapsed');
        userCollapsedChoices = choicesHeader.classList.contains('collapsed');
    });
}

// Character Creation Logic
const charOverlay = document.getElementById('character-creation-overlay');
const btnStartGame = document.getElementById('btn-start-game');
const charNameInput = document.getElementById('char-name');
const charAgeInput = document.getElementById('char-age');
const creationError = document.getElementById('creation-error');
const gameOverOverlay = document.getElementById('game-over-overlay');
const btnRestartGame = document.getElementById('btn-restart-game');

// Show messages or errors instantly on gender click
function updateGenderMessage(val) {
    creationError.style.display = 'block';
    if (val === 'Другое') {
        creationError.style.color = '#ef4444'; // Red for error
        creationError.textContent = 'Здесь так не принято. Ты либо мужчина, либо женщина, либо труп.';
        void creationError.offsetWidth;
        creationError.classList.add('shake');
    } else {
        creationError.style.color = '#fbbf24'; // Gold for respect
        creationError.classList.remove('shake');
        if (val === 'Мужчина') {
            creationError.textContent = 'Хардмод. Уважаемо.';
        } else if (val === 'Женщина') {
            creationError.textContent = 'Супер хардмод. Ты уверена?';
        }
    }
}

document.querySelectorAll('input[name="char-gender"]').forEach(radio => {
    radio.addEventListener('change', (e) => updateGenderMessage(e.target.value));
});

// Run once on load to show initial gender message
const initialGender = document.querySelector('input[name="char-gender"]:checked');
if (initialGender) updateGenderMessage(initialGender.value);

if (btnRestartGame) {
    btnRestartGame.addEventListener('click', () => {
        location.reload();
    });
}

if (btnStartGame) {
    btnStartGame.addEventListener('click', () => {
        const gender = document.querySelector('input[name="char-gender"]:checked').value;

        // Block start if "Other" is still selected
        if (gender === 'Другое') {
            return;
        }

        creationError.style.display = 'none';
        creationError.textContent = '';
        creationError.classList.remove('shake');

        const name = charNameInput.value.trim() || 'Бродяга';
        const age = parseInt(charAgeInput.value);

        if (isNaN(age) || age < 14 || age > 120) {
            creationError.style.color = '#ef4444'; // Red for validation error
            creationError.textContent = 'Укажите возраст от 14 до 120';
            creationError.style.display = 'block';
            void creationError.offsetWidth;
            creationError.classList.add('shake');
            return;
        }

        // Hide overlay and start
        charOverlay.style.display = 'none';

        // Notify Server to initialize with these parameters
        ws.send(JSON.stringify({
            type: 'init_character',
            name: name,
            gender: gender,
            age: age
        }));
    });
}

// Clear session if user clicks restart game
if (btnRestartGame) {
    btnRestartGame.addEventListener('click', () => {
        localStorage.removeItem('rpg_session_id');
        location.reload();
    });
}

// State tracking for animations
let prevStats = null;

function triggerShake(element) {
    if (!element) return;
    element.classList.remove('shake');
    // Force reflow to restart animation
    void element.offsetWidth;
    element.classList.add('shake');
}

let isProcessing = false;

// Tabs Logic
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        btn.classList.remove('tab-notify'); // Clear notifications
        document.getElementById(btn.dataset.target).classList.add('active');
    });
});

// Dev Toggle Logic
const devToggleBtn = document.getElementById('toggle-dev-btn');
const devPanel = document.getElementById('dev-panel');
if (devToggleBtn && devPanel) {
    devToggleBtn.addEventListener('click', () => {
        devPanel.classList.toggle('visible');
    });
}

function handleMessage(event) {
    try {
        const data = JSON.parse(event.data);

        if (data.type === 'init' || data.type === 'update') {
            isProcessing = false;
            loading.style.display = 'none';
            actionInput.disabled = false;
            sendBtn.disabled = false;
            actionInput.focus();

            if (data.sessionId) {
                localStorage.setItem('rpg_session_id', data.sessionId);
            }

            // Clear previous screen for a page-turn effect
            chatLog.innerHTML = '';

            // Показываем картинку сцены (or skeleton if null)
            showSceneImage(data.imageUrl || null, data.type === 'init');

            // If it's an update after an action, show the player's action at the top
            if (data.type === 'update' && lastPlayerAction) {
                appendMessage(lastPlayerAction, 'player');
            }

            // Add narrative
            if (data.message) {
                appendMessage(formatNarrative(data.message), 'gm');
            }

            // Populate AI Choices
            if (data.choices && data.choices.length > 0) {
                aiChoices.innerHTML = '';
                data.choices.forEach(choice => {
                    const btn = document.createElement('button');
                    btn.className = 'ai-choice-btn';
                    btn.textContent = choice;
                    btn.onclick = () => {
                        actionInput.value = choice;
                        sendAction();
                    };
                    aiChoices.appendChild(btn);
                });
                aiChoicesContainer.classList.add('visible');

                // Сворачиваем действия только если пользователь ранее свернул их вручную
                if (userCollapsedChoices) {
                    if (choicesHeader) choicesHeader.classList.add('collapsed');
                    aiChoices.classList.add('collapsed');
                } else {
                    if (choicesHeader) choicesHeader.classList.remove('collapsed');
                    aiChoices.classList.remove('collapsed');
                }

                actionInput.placeholder = 'Или напишите свой вариант...';
            } else {
                aiChoicesContainer.classList.remove('visible');
                actionInput.placeholder = 'Что вы будете делать?';
            }

            // Update State
            if (data.state) {
                updateUIState(data.state);
                if (data.state.health <= 0) {
                    gameOverOverlay.style.display = 'flex';
                }
            }
            if (data.shortCode) {
                shortcodeDisplay.textContent = data.shortCode;
            }
        }
        else if (data.type === 'processing') {
            isProcessing = true;
            loading.style.display = 'block';
            loading.textContent = 'Мир реагирует на ваши действия...';
            chatLog.appendChild(loading);
            chatLog.scrollTop = chatLog.scrollHeight;
            aiChoicesContainer.classList.remove('visible');
        }
        else if (data.type === 'reconnect_failed') {
            // Если сервер перезагружался (сессия пропала из памяти), нужно просто сбросить всё и показать главное меню
            localStorage.removeItem('rpg_session_id');
            const overlay = document.getElementById('character-creation-overlay');
            if (overlay) overlay.style.display = 'flex';
        }
        else if (data.type === 'image_update') {
            // Асинхронно пришла картинка
            if (data.imageUrl) {
                showSceneImage(data.imageUrl, false);
            } else {
                // Ошибка генерации, убираем плейсхолдер
                if (sceneImageContainer) {
                    sceneImageContainer.innerHTML = '';
                }
            }
        }
        else if (data.type === 'receive_save') {
            // Скачиваем полученный стейт как JSON файл
            if (!data.state) return;
            const jsonStr = JSON.stringify(data.state, null, 2);
            const blob = new Blob([jsonStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `bohemia_save_${new Date().getTime()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    } catch (e) {
        console.error('WebSocket Error', e);
    }
};

let lastPlayerAction = '';

function sendAction() {
    const text = actionInput.value.trim();
    if (!text || isProcessing) return;

    lastPlayerAction = text;

    // Immediately show the action before server responds
    chatLog.innerHTML = '';
    appendMessage(text, 'player');

    ws.send(JSON.stringify({
        type: 'action',
        action: text
    }));

    actionInput.value = '';
    actionInput.disabled = true;
    sendBtn.disabled = true;
    aiChoicesContainer.classList.remove('visible');
}

// ========================
// Save & Load Functionality
// ========================
const btnSave = document.getElementById('btn-save');
const btnLoad = document.getElementById('btn-load');
const btnLoadOverlay = document.getElementById('btn-load-overlay');
const loadFileInput = document.getElementById('load-file-input');

// ========================
// Settings Menu
// ========================
const btnSettings = document.getElementById('btn-settings');
const settingsMenu = document.getElementById('settings-menu');
const narrativeLengthSelect = document.getElementById('narrative-length');

if (btnSettings && settingsMenu) {
    btnSettings.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsMenu.style.display = settingsMenu.style.display === 'none' ? 'block' : 'none';
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!settingsMenu.contains(e.target) && e.target !== btnSettings) {
            settingsMenu.style.display = 'none';
        }
    });
}

if (narrativeLengthSelect) {
    narrativeLengthSelect.addEventListener('change', (e) => {
        const length = e.target.value; // 'short' or 'long'
        ws.send(JSON.stringify({
            type: 'set_narrative_length',
            length: length
        }));
    });
}

if (btnSave) {
    btnSave.addEventListener('click', () => {
        // Просим сервер прислать текущий стейт для сохранения
        ws.send(JSON.stringify({ type: 'request_save' }));
    });
}

const triggerLoadProcess = () => {
    if (loadFileInput) loadFileInput.click();
};

if (btnLoad) {
    btnLoad.addEventListener('click', triggerLoadProcess);
}

if (btnLoadOverlay) {
    btnLoadOverlay.addEventListener('click', triggerLoadProcess);
}

if (loadFileInput) {
    loadFileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parsedState = JSON.parse(e.target.result);
                // Отправляем серверу загруженный стейт
                ws.send(JSON.stringify({
                    type: 'load_state',
                    state: parsedState
                }));

                // Скрыть стартовое меню при успешной загрузке
                const overlay = document.getElementById('character-creation-overlay');
                if (overlay) overlay.style.display = 'none';

                // Show game screen just inside the app
                document.getElementById('app').style.display = 'flex';

            } catch (err) {
                alert("Ошибка чтения файла сохранения. Поврежден или неверный формат.");
                console.error(err);
            }
        };
        reader.readAsText(file);

        // Сбрасываем инпут, чтобы можно было выбрать тот же файл еще раз
        event.target.value = '';
    });
}

function appendMessage(html, type) {
    const div = document.createElement('div');
    div.className = `message ${type}`;
    div.innerHTML = html;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function spawnStatPopup(text, type) {
    const container = document.getElementById('stat-popup-container');
    if (!container) return;

    const el = document.createElement('div');
    el.className = `stat-popup ${type}`;
    el.textContent = text;

    container.appendChild(el);

    // Remove after animation finishes (3.5s)
    setTimeout(() => {
        el.remove();
    }, 3500);
}

function formatNarrative(text) {
    // 0. Remove accidental raw stats line e.g. "HP:35/100|STA:30/100|SAT:78/100|COIN:0|MOR:48/100"
    let cleanText = text.replace(/HP:\d+\/\d+\|STA:.+/gi, '').trim();

    // 1. Extract and remove stat deltas like "SAT -5, STA -5, COIN +2"
    const patterns = [
        { regex: /HP\s*([+-]\d+)/gi },
        { regex: /STA\s*([+-]\d+)/gi },
        { regex: /SAT\s*([+-]\d+)/gi },
        { regex: /COIN\s*([+-]\d+)/gi },
        { regex: /MOR\s*([+-]\d+)/gi },
        { regex: /REP\s*([+-]\d+)/gi },
        { regex: /(Выживание|Охота|Бой|Атлетика|Скрытность|Красноречие|Интуиция|Эмпатия|Интеллект|Ремесло)\s*([+-]\d+)/gi }
    ];

    patterns.forEach(p => {
        let match;
        while ((match = p.regex.exec(text)) !== null) {
            // Remove the matched text + any commas/spaces around it
            cleanText = cleanText.replace(match[0], '');
        }
    });

    // Clean up trailing commas or floating punctuation left behind
    cleanText = cleanText.replace(/[,.]\s*(?=[,.]|\s*$)/g, '').trim();

    // 2. Format paragraphs and dialogue
    const paragraphs = cleanText.split(/\n\n+/);
    return paragraphs.map(p => {
        return `<p>${p}</p>`;
    }).join('');
}

function getSvgIcon(type) {
    const size = 24;
    const baseClass = "inv-svg-icon";

    switch (type) {
        case 'weapon':
            return `<svg class="${baseClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 17.5L3 6V3h3l11.5 11.5"></path><path d="M13 19l6-6"></path><path d="M16 16l4 4"></path><path d="M19 21l2-2"></path></svg>`;
        case 'food':
            return `<svg class="${baseClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9Z"></path><path d="M21 12A9 9 0 0 0 3 12"></path></svg>`;
        case 'potion':
            return `<svg class="${baseClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3h4"></path><path d="M12 3v3"></path><path d="M8 12c0-3 2-4 2-6v-3h4v3c0 2 2 3 2 6v5a4 4 0 0 1-8 0v-5z"></path></svg>`;
        case 'clothing':
            // Средневековая длинная рубаха/рубище (Коричневая)
            return `<svg class="${baseClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#A0522D" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4 C10.5 6, 13.5 6, 15 4 L20 6 L22 12 L19 14 L18 10 V22 H6 V10 L5 14 L2 12 L4 6 Z"></path></svg>`;
        case 'armor':
            // Кираса/Панцирь вместо щита
            return `<svg class="${baseClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3h8l4 5v8c0 3-3 6-8 6s-8-3-8-6V8z"></path><path d="M6 8h12"></path></svg>`;
        case 'ring':
            return `<svg class="${baseClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="4" r="2"></circle></svg>`;
        case 'key':
            return `<svg class="${baseClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>`;
        default:
            return `<svg class="${baseClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`; // Box/Cube
    }
}

function getItemIcon(itemName) {
    const lower = itemName.toLowerCase();
    if (lower.includes('меч') || lower.includes('кинжал') || lower.includes('нож') || lower.includes('топор')) return getSvgIcon('weapon');
    if (lower.includes('хлеб') || lower.includes('еда') || lower.includes('мясо') || lower.includes('яблоко')) return getSvgIcon('food');
    if (lower.includes('зелье') || lower.includes('отвар')) return getSvgIcon('potion');
    if (lower.includes('ключ')) return getSvgIcon('key');
    if (lower.includes('кольцо')) return getSvgIcon('ring');

    // Clothing vs Armor
    if (lower.includes('лохмотья') || lower.includes('рубище') || lower.includes('тряпки') || lower.includes('одежда') || lower.includes('рубаха') || lower.includes('штаны')) return getSvgIcon('clothing');
    if (lower.includes('кожан') || lower.includes('стеганк') || lower.includes('кольчуга') || lower.includes('броня') || lower.includes('лат') || lower.includes('панцирь') || lower.includes('шлем')) return getSvgIcon('armor');

    return getSvgIcon('box');
}

function updateUIState(state) {
    // Detect drops for shake animation
    const currentSatiety = state.satiety !== undefined ? state.satiety : 80;
    const currentInvCount = state.inventory ? state.inventory.length : 0;
    const currentQuestsCount = state.quests ? Object.keys(state.quests).length : 0;

    let popupsToSpawn = [];

    const checkStat = (newVal, oldVal, label, positiveIsGood = true, isGold = false) => {
        if (newVal !== undefined && oldVal !== undefined && newVal !== oldVal) {
            const diff = newVal - oldVal;
            // Hack for JS floating point on coins
            let formattedDiff = diff;
            if (isGold && diff % 1 !== 0) {
                formattedDiff = parseFloat(diff.toFixed(1));
            }
            const sign = formattedDiff > 0 ? '+' : '';
            let type = (diff > 0) === positiveIsGood ? 'positive' : 'negative';
            if (isGold) type = 'gold';
            popupsToSpawn.push({ text: `${label} ${sign}${formattedDiff}`, type });
            return true;
        }
        return false;
    };

    if (prevStats) {
        if (checkStat(state.health, prevStats.health, 'ЗДОРОВЬЕ', true)) triggerShake(hpFill.parentElement);
        if (checkStat(state.stamina, prevStats.stamina, 'ВЫНОСЛИВОСТЬ', true)) triggerShake(staminaFill.parentElement);
        if (checkStat(currentSatiety, prevStats.satiety, 'СЫТОСТЬ', true)) triggerShake(satietyFill.parentElement);
        if (checkStat(state.morality, prevStats.morality, 'МОРАЛЬ', true)) triggerShake(morFill.parentElement);
        checkStat(state.coins, prevStats.coins, 'ГРОШИ', true, true);
        checkStat(state.reputation, prevStats.reputation, 'РЕПУТАЦИЯ', true);

        if (state.skills && prevStats.skills) {
            Object.keys(state.skills).forEach(skill => {
                checkStat(state.skills[skill], prevStats.skills[skill], skill.toUpperCase(), true);
            });
        }

        if (currentInvCount > prevStats.invCount) {
            const invTab = document.querySelector('.tab-btn[data-target="tab-inventory"]');
            if (invTab && !invTab.classList.contains('active')) invTab.classList.add('tab-notify');
        }

        if (currentQuestsCount > prevStats.questsCount) {
            const questTab = document.querySelector('.tab-btn[data-target="tab-quests"]');
            if (questTab && !questTab.classList.contains('active')) questTab.classList.add('tab-notify');
        }

        // Spawn computed UI popups with delay
        popupsToSpawn.forEach((popup, index) => {
            setTimeout(() => {
                spawnStatPopup(popup.text, popup.type);
            }, index * 400);
        });
    }

    prevStats = {
        health: state.health,
        stamina: state.stamina,
        satiety: currentSatiety,
        morality: state.morality,
        coins: state.coins,
        reputation: state.reputation,
        skills: state.skills ? { ...state.skills } : {},
        invCount: currentInvCount,
        questsCount: currentQuestsCount
    };

    // Core stats
    const hpPct = Math.min(100, Math.max(0, (state.health / state.maxHealth) * 100));
    hpFill.style.width = `${hpPct}%`;
    hpText.textContent = `${state.health}/${state.maxHealth}`;

    const staPct = Math.min(100, Math.max(0, (state.stamina / state.maxStamina) * 100));
    staminaFill.style.width = `${staPct}%`;
    staminaText.textContent = `${state.stamina}/${state.maxStamina}`;

    const maxSatiety = state.maxSatiety || 100;
    const satPct = Math.min(100, Math.max(0, (currentSatiety / maxSatiety) * 100));
    satietyFill.style.width = `${satPct}%`;
    satietyText.textContent = `${currentSatiety}/${maxSatiety}`;

    const morPct = Math.min(100, Math.max(0, (state.morality / (state.maxMorality || 100)) * 100));
    morFill.style.width = `${morPct}%`;
    morText.textContent = `${state.morality}/${state.maxMorality || 100}`;

    locDisplay.textContent = state.location.replace(/_/g, ' ');

    // Convert exact time to time of day
    // Expected format: "День 1, 09:00" or similar
    let timeStr = state.time.replace(/_/g, ' ');
    const timeMatch = timeStr.match(/(\d{2}):(\d{2})/);
    if (timeMatch) {
        const hour = parseInt(timeMatch[1], 10);
        let timeOfDay = 'Ночь';
        if (hour >= 6 && hour < 12) timeOfDay = 'Утро';
        else if (hour >= 12 && hour < 18) timeOfDay = 'День';
        else if (hour >= 18 && hour < 23) timeOfDay = 'Вечер';

        // E.g., "День 1, Утро"
        timeStr = timeStr.replace(/\d{2}:\d{2}/, timeOfDay);
    }
    timeDisplay.textContent = timeStr;

    coinsDisplay.textContent = state.coins % 1 === 0 ? state.coins : state.coins.toFixed(1);
    reputationDisplay.textContent = state.reputation;

    const weapon = state.equipment?.weapon || 'Нет';
    weaponDisplay.innerHTML = weapon.toLowerCase() === 'нет' ? 'Нет' : `<span style="margin-right:0.5rem">${getItemIcon(weapon)}</span>${weapon}`;

    const armor = state.equipment?.armor || 'Лохмотья';
    armorDisplay.innerHTML = armor.toLowerCase() === 'нет' ? 'Нет' : `<span style="margin-right:0.5rem">${getItemIcon(armor)}</span>${armor}`;

    const profession = state.profession || 'Нет';
    if (professionDisplay) {
        professionDisplay.innerHTML = profession.toLowerCase() === 'нет' ? 'Нет' : profession;
    }

    // Inventory Grid
    inventoryList.innerHTML = '';
    if (state.inventory && state.inventory.length > 0) {
        state.inventory.forEach(item => {
            const div = document.createElement('div');
            div.className = 'inv-slot';
            div.title = item; // Adds native browser tooltip on hover
            div.innerHTML = `<div class="inv-icon">${getItemIcon(item)}</div><div class="inv-name">${item}</div>`;
            inventoryList.appendChild(div);
        });
    } else {
        inventoryList.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;">Рюкзак пуст</div>';
    }

    // Skills Grid
    skillsList.innerHTML = '';
    if (state.skills && Object.keys(state.skills).length > 0) {
        Object.entries(state.skills).forEach(([skill, value]) => {
            const div = document.createElement('div');
            div.className = 'skill-item';
            div.innerHTML = `
                <div class="skill-name">${skill}</div>
                <div class="skill-value">${value}/100</div>
                <div class="skill-bar"><div class="skill-fill" style="width:${value}%"></div></div>
            `;
            skillsList.appendChild(div);
        });
    } else {
        skillsList.innerHTML = '<div class="empty-state">Нет данных о навыках...</div>';
    }

    // Relationships
    relationshipsList.innerHTML = '';
    const relKeys = Object.keys(state.relationships || {});
    if (relKeys.length === 0) {
        relationshipsList.innerHTML = '<li class="empty-state">Нет знакомых лиц в этом проклятом городе...</li>';
    } else {
        relKeys.forEach(char => {
            const val = state.relationships[char];
            let color = '#a1a1aa';
            if (val > 0) color = '#10b981';
            if (val < 0) color = '#ef4444';
            relationshipsList.innerHTML += `
            <li>
                <span class="rel-name">👤 ${char}</span>
                <span class="rel-val" style="color: ${color}">${val > 0 ? '+' : ''}${val}</span>
            </li>`;
        });
    }

    // Quests
    questsList.innerHTML = '';
    const questKeys = Object.keys(state.quests || {});
    if (questKeys.length === 0) {
        questsList.innerHTML = '<li class="empty-state">Пока у вас нет долгов или работы...</li>';
    } else {
        questKeys.forEach(quest => {
            const q = state.quests[quest];

            let statusIcon = '📜';
            let statusColor = '#a1a1aa';
            let statusText = 'Активно';

            if (q.status === 'completed') {
                statusIcon = '✅';
                statusColor = '#10b981';
                statusText = 'Выполнено';
            } else if (q.status === 'failed') {
                statusIcon = '❌';
                statusColor = '#ef4444';
                statusText = 'Провалено';
            } else if (q.status === 'active') {
                statusIcon = '⚔️';
                statusColor = '#d4d4d8';
                statusText = 'Активно';
            }

            const timeStr = q.endTime ? `${q.startTime} ➔ ${q.endTime}` : `С: ${q.startTime}`;

            questsList.innerHTML += `
            <li class="quest-item ${q.status}">
                <div class="quest-header">
                    <span class="quest-name" style="color: ${statusColor}">${statusIcon} ${quest}</span>
                </div>
                <div class="quest-meta">${statusText} | <span class="quest-time">${timeStr}</span></div>
            </li>`;
        });
    }
}

sendBtn.addEventListener('click', sendAction);
actionInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendAction();
    }
});

// Auto-focus input on load
window.onload = () => actionInput.focus();

// ---- Scene Image ----
let imageTimer = null;

function showSceneImage(url, isInit) {
    if (!sceneImageContainer) return;

    // Очищаем предыдущий таймер, если он был
    if (imageTimer) {
        clearInterval(imageTimer);
        imageTimer = null;
    }

    if (!url) {
        // Показываем skeleton только при активном обновлении (не init без картинки)
        if (!isInit) {
            sceneImageContainer.innerHTML = `
                <div class="scene-skeleton">
                    <div class="skeleton-timer-text" id="skeleton-timer">Мир обретает краски... <span>20</span></div>
                </div>
            `;

            let timeLeft = 20;
            const timerSpan = document.querySelector('#skeleton-timer span');
            if (timerSpan) {
                imageTimer = setInterval(() => {
                    timeLeft--;
                    if (timeLeft > 0) {
                        timerSpan.textContent = timeLeft;
                    } else {
                        const timerText = document.getElementById('skeleton-timer');
                        if (timerText) timerText.innerHTML = 'Завершение мазков кисти...';
                        clearInterval(imageTimer);
                    }
                }, 1000);
            }
        } else {
            sceneImageContainer.innerHTML = '';
        }
        return;
    }

    // Создаём обёртку для fade-in
    const wrapper = document.createElement('div');
    wrapper.className = 'scene-image-wrapper';

    const img = document.createElement('img');
    img.className = 'scene-image';
    img.alt = 'Сцена';
    img.style.opacity = '0';
    img.style.transition = 'opacity 0.7s ease';

    img.onload = () => {
        img.style.opacity = '1';
    };
    img.onerror = () => {
        wrapper.remove();
    };
    img.src = url;

    wrapper.appendChild(img);
    sceneImageContainer.innerHTML = '';
    sceneImageContainer.appendChild(wrapper);
}
