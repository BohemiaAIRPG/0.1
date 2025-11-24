let ws;
let gameState = null;
let currentScene = '';
let currentChoices = [];
let currentSessionId = null;

document.addEventListener('DOMContentLoaded', () => {
    console.log('🏁 Test phase 0.1 ended. Game access disabled.');
    // Logic for restore and start is disabled.
});

function startGame() {
    const playerName = document.getElementById('playerName').value.trim() || 'Странник';
    const playerGender = document.getElementById('playerGender').value || 'male';
    
    console.log(`🎮 Начало игры: ${playerName} (${playerGender})`);
    
    // Очищаем старое сохранение при старте новой игры
    clearLocalStorageSave();
    
    // Подключение к WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);
    
    ws.onopen = () => {
        console.log('Connected to server');
        ws.send(JSON.stringify({
            type: 'start',
            name: playerName,
            gender: playerGender
        }));
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        // Сохраняем sessionId из ответа сервера
        if (data.sessionId) {
            currentSessionId = data.sessionId;
        }
        
        handleMessage(data);
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        alert('Ошибка подключения к серверу!');
    };
    
    ws.onclose = () => {
        console.log('Disconnected from server');
    };
    
    // Показываем игровой экран
    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
    
    setTimeout(() => {
        initTabHandlers();
        initCustomChoiceHandlers();
        initHistoryModal();
        initSaveLoadHandlers();
    }, 100);
}

function handleMessage(data) {
    console.log('📨 Получено сообщение:', data.type);
    
    if (data.type === 'connected') {
        currentSessionId = data.sessionId;
        console.log(`🔗 Подключено к серверу, SessionID: ${currentSessionId}`);
    } else if (data.type === 'scene') {
        gameState = data.gameState;
        currentScene = data.description;
        currentChoices = data.choices;
        
        saveGameToLocalStorage();
        updateUI();
        displayScene(currentScene, currentChoices, data.isDialogue, data.speakerName);
        hideLoading();
    } else if (data.type === 'generating') {
        showLoading();
    } else if (data.type === 'loaded') {
        // Обработка загруженного сохранения
        currentSessionId = data.sessionId; // КРИТИЧЕСКИ ВАЖНО!
        gameState = data.gameState;
        currentScene = data.description;
        currentChoices = data.choices;
        
        console.log('✅ Сохранение успешно загружено и восстановлено!');
        console.log(`🔗 SessionID обновлен: ${currentSessionId}`);
        
        saveGameToLocalStorage();
        updateUI();
        displayScene(currentScene, currentChoices);
        hideLoading();
    } else if (data.type === 'gameOver') {
        hideLoading();
        showGameOver(data);
    } else if (data.type === 'error') {
        hideLoading();
        console.error('❌ Ошибка от сервера:', data.message);
        alert('❌ Ошибка от сервера:\n\n' + data.message);
    }
}

function showGameOver(data) {
    console.log('💀 GAME OVER:', data.deathReason);
    
    // Очищаем сохранение
    clearLocalStorageSave();
    
    // Преобразуем описание смерти с абзацами
    const paragraphs = data.description.split('\n\n').filter(p => p.trim());
    const formattedDescription = paragraphs.map(p => `<p style="color: #e0e0e0; line-height: 1.8; margin-bottom: 20px; font-size: 1.1em;">${p.trim()}</p>`).join('');
    
    // Создаём экран смерти на весь экран
    const gameScreen = document.getElementById('gameScreen');
    gameScreen.innerHTML = `
        <div style="
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: linear-gradient(180deg, #000000 0%, #1a1a1a 50%, #000000 100%);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 40px;
            box-sizing: border-box;
            overflow-y: auto;
        ">
            <div style="
                width: 100%;
                max-width: 900px;
                text-align: center;
            ">
                <!-- БОЛЬШАЯ НАДПИСЬ СВЕРХУ -->
                <h1 style="
                    color: #ffffff;
                    font-size: 72px;
                    font-weight: 300;
                    letter-spacing: 10px;
                    margin-bottom: 40px;
                    text-shadow: 0 0 30px rgba(255, 255, 255, 0.5);
                    animation: fadeIn 1s ease-in;
                ">
                    ЭТО КОНЕЦ
                </h1>
                
                <!-- ПРИЧИНА СМЕРТИ -->
                <h2 style="
                    color: #c0c0c0;
                    font-size: 24px;
                    font-weight: 300;
                    margin-bottom: 40px;
                    font-style: italic;
                ">
                    ${data.deathReason}
                </h2>
                
                <!-- ОПИСАНИЕ СМЕРТИ НА ВЕСЬ ЭКРАН -->
                <div style="
                    background: rgba(255, 255, 255, 0.05);
                    padding: 40px;
                    border-radius: 10px;
                    border: 1px solid rgba(255, 255, 255, 0.15);
                    margin-bottom: 40px;
                    text-align: left;
                    max-width: 800px;
                    margin-left: auto;
                    margin-right: auto;
                ">
                    ${formattedDescription}
                </div>
                
                <!-- СТАТИСТИКА -->
                <div style="
                    background: rgba(255, 255, 255, 0.03);
                    padding: 30px;
                    border-radius: 10px;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    margin-bottom: 40px;
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 20px;
                    max-width: 600px;
                    margin-left: auto;
                    margin-right: auto;
                ">
                    <div style="text-align: center;">
                        <p style="color: #808080; font-size: 14px; margin-bottom: 5px;">Дней прожито</p>
                        <p style="color: #ffffff; font-size: 32px; font-weight: 300;">${data.finalStats.daysPlayed}</p>
                    </div>
                    <div style="text-align: center;">
                        <p style="color: #808080; font-size: 14px; margin-bottom: 5px;">Действий совершено</p>
                        <p style="color: #ffffff; font-size: 32px; font-weight: 300;">${data.finalStats.actions}</p>
                    </div>
                    <div style="text-align: center;">
                        <p style="color: #808080; font-size: 14px; margin-bottom: 5px;">Монет</p>
                        <p style="color: #ffffff; font-size: 32px; font-weight: 300;">${data.finalStats.coins}</p>
                    </div>
                    <div style="text-align: center;">
                        <p style="color: #808080; font-size: 14px; margin-bottom: 5px;">Репутация</p>
                        <p style="color: #ffffff; font-size: 32px; font-weight: 300;">${data.finalStats.reputation}</p>
                    </div>
                </div>
                
                <!-- КНОПКА НАЧАТЬ ЗАНОВО -->
                <button onclick="location.reload()" style="
                    padding: 20px 60px;
                    font-size: 20px;
                    font-weight: 300;
                    background: linear-gradient(135deg, #ffffff 0%, #e0e0e0 100%);
                    color: #000000;
                    border: 1px solid #ffffff;
                    border-radius: 10px;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    box-shadow: 0 5px 20px rgba(255, 255, 255, 0.2);
                ">
                    ⟲ Начать заново
                </button>
            </div>
            
            <style>
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(-20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            </style>
        </div>
    `;
}

function makeChoice(choice) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('Нет подключения к серверу!');
        return;
    }
    
    console.log(`🎯 Выбор игрока: ${choice}`);
    
    // Сразу показываем "Мир реагирует..." с миганием
    showWorldReacting();
    
    // Отключаем все кнопки выбора
    const choicesList = document.getElementById('choicesList');
    if (choicesList) {
        choicesList.querySelectorAll('.choice-btn').forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
        });
    }
    
    ws.send(JSON.stringify({
        type: 'choice',
        choice: choice,
        previousScene: currentScene
    }));
}

function showWorldReacting() {
    const sceneDescriptionDiv = document.getElementById('sceneDescription');
    if (!sceneDescriptionDiv) return;
    
    sceneDescriptionDiv.innerHTML = `
        <p class="world-reacting" style="text-align: center; font-size: 1.3em; color: #ffd700; margin: 50px 0; font-weight: 500; letter-spacing: 1px;">
            🌍 Мир реагирует на ваши действия...
        </p>
    `;
}

function displayScene(description, choices, isDialogue = false, speakerName = '') {
    const sceneDescriptionDiv = document.getElementById('sceneDescription');
    
    // Преобразуем \n\n в HTML абзацы для правильного отображения
    const paragraphs = description.split('\n\n').filter(p => p.trim());
    const formattedDescription = paragraphs.map(p => `<p style="margin-bottom: 15px; line-height: 1.6;">${p.trim()}</p>`).join('');
    
    if (isDialogue && speakerName) {
        sceneDescriptionDiv.innerHTML = `
            <div style="border-left: 4px solid #4a90e2; padding-left: 15px; margin: 10px 0;">
                <div style="color: #4a90e2; font-weight: bold; margin-bottom: 8px;">
                    💬 ${speakerName} говорит:
                </div>
                <div style="font-style: italic;">${formattedDescription}</div>
            </div>
        `;
    } else {
        sceneDescriptionDiv.innerHTML = formattedDescription;
    }
    
    const choicesList = document.getElementById('choicesList');
    const choicesHeader = document.querySelector('.choices-container h4');
    
    if (isDialogue) {
        choicesHeader.textContent = '💬 Выберите ответ:';
    } else {
        choicesHeader.textContent = '🎮 Выберите действие:';
    }
    
    choicesList.innerHTML = '';
    
    choices.forEach((choice, index) => {
        const choiceBtn = document.createElement('button');
        choiceBtn.className = 'choice-btn';
        
        if (isDialogue) {
            choiceBtn.style.borderLeft = '4px solid #4a90e2';
            choiceBtn.innerHTML = `<span style="color: #4a90e2;">➤</span> ${choice}`;
        } else {
            choiceBtn.textContent = `${index + 1}. ${choice}`;
        }
        
        choiceBtn.addEventListener('click', () => makeChoice(choice));
        
        choicesList.appendChild(choiceBtn);
    });
}

function updateUI() {
    if (!gameState) return;
    
    saveGameToLocalStorage();
    
    document.getElementById('charName').textContent = gameState.name;
    
    let dateText = '';
    if (gameState.date) {
        const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
        dateText = `${gameState.date.day} ${months[gameState.date.month - 1]} ${gameState.date.year} • ${gameState.date.timeOfDay}`;
    } else {
        dateText = `${gameState.time} • День ${gameState.day || 1}`;
    }
    
    document.getElementById('location').textContent = `📍 ${gameState.location} • ${dateText}`;
    
    const healthPercent = (gameState.health / gameState.maxHealth) * 100;
    document.getElementById('healthBar').style.width = healthPercent + '%';
    document.getElementById('healthText').textContent = `${gameState.health}/${gameState.maxHealth}`;
    
    const staminaPercent = (gameState.stamina / gameState.maxStamina) * 100;
    document.getElementById('staminaBar').style.width = staminaPercent + '%';
    document.getElementById('staminaText').textContent = `${gameState.stamina}/${gameState.maxStamina}`;
    
    document.getElementById('coins').textContent = gameState.coins;
    document.getElementById('reputation').textContent = `${gameState.reputation}/100`;
    
    document.getElementById('weaponName').textContent = gameState.equipment.weapon.name;
    document.getElementById('weaponCondition').style.width = gameState.equipment.weapon.condition + '%';
    document.getElementById('armorName').textContent = gameState.equipment.armor.name;
    document.getElementById('armorCondition').style.width = gameState.equipment.armor.condition + '%';
    
    // Обновляем все вкладки чтобы данные были актуальными
    updateInventory();
    updateSkills();
    updateCharacter();
}

function updateCharacter() {
    if (!gameState) return;
    
    const characterInfo = document.getElementById('characterInfo');
    if (!characterInfo) return;
    
    // Формируем список знакомств и отношений
    let relationshipsHTML = '';
    const relationships = gameState.character.relationships || {};
    const relationshipKeys = Object.keys(relationships);
    
    if (relationshipKeys.length > 0) {
        relationshipsHTML = `
            <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
                <h5 style="color: #4a90e2; margin-bottom: 10px; font-size: 1.1em;">👥 Знакомства и отношения:</h5>
                <div style="display: flex; flex-direction: column; gap: 10px;">
        `;
        
        relationshipKeys.forEach(name => {
            const relation = relationships[name];
            relationshipsHTML += `
                <div style="background: rgba(74, 144, 226, 0.1); padding: 10px; border-radius: 5px; border-left: 3px solid #4a90e2;">
                    <strong style="color: #4a90e2;">${name}</strong>
                    <p style="margin-top: 5px; color: #ccc; font-size: 0.9em; line-height: 1.4;">${relation}</p>
        </div>
    `;
        });
        
        relationshipsHTML += `
                </div>
            </div>
        `;
    } else {
        relationshipsHTML = `
            <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
                <h5 style="color: #4a90e2; margin-bottom: 10px; font-size: 1.1em;">👥 Знакомства и отношения:</h5>
                <p style="color: #888; font-style: italic; font-size: 0.9em;">Пока никого не знаете</p>
            </div>
        `;
    }
    
    // Формируем список недавних событий (опционально)
    let recentEventsHTML = '';
    const recentEvents = gameState.character.recentEvents || [];
    if (recentEvents.length > 0) {
        const lastEvents = recentEvents.slice(-5); // Последние 5 событий
        recentEventsHTML = `
            <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
                <h5 style="color: #ffd700; margin-bottom: 10px; font-size: 1.1em;">📜 Недавние события:</h5>
                <ul style="list-style: none; padding: 0; margin: 0;">
        `;
        
        lastEvents.forEach(event => {
            recentEventsHTML += `
                <li style="margin-bottom: 8px; padding-left: 20px; position: relative; color: #ccc; font-size: 0.9em; line-height: 1.4;">
                    <span style="position: absolute; left: 0; color: #ffd700;">•</span>
                    ${event}
                </li>
            `;
        });
        
        recentEventsHTML += `
                </ul>
            </div>
        `;
    }
    
    characterInfo.innerHTML = `
        <div style="padding: 10px;">
            <h4 style="color: #ffd700; margin-bottom: 10px;">${gameState.name}</h4>
            <p style="color: #ccc; line-height: 1.6; margin-bottom: 15px; font-size: 0.95em;">${gameState.character.background}</p>
            <div style="margin-bottom: 15px;">
                <strong style="color: #4a90e2;">Черты характера:</strong>
                <p style="color: #ccc; margin-top: 5px; font-size: 0.9em;">${gameState.character.traits.join(', ')}</p>
            </div>
            ${relationshipsHTML}
            ${recentEventsHTML}
                </div>
        `;
}

function updateSkills() {
    const skillsList = document.getElementById('skillsList');
    if (!skillsList || !gameState) return;
    
    // Словарь перевода названий навыков на русский
    const skillNames = {
        'combat': '⚔️ Бой',
        'stealth': '🗡️ Скрытность',
        'speech': '💬 Красноречие',
        'survival': '🏕️ Выживание'
    };
    
    skillsList.innerHTML = '';
    
    Object.entries(gameState.skills).forEach(([skillName, skillData]) => {
        const skillDiv = document.createElement('div');
        skillDiv.className = 'skill-item';
        const displayName = skillNames[skillName] || skillName;
        
        // Вычисляем прогресс до следующего уровня
        const currentXP = skillData.xp || 0;
        const nextLevelXP = skillData.nextLevel || 100;
        const progressPercent = Math.min(100, Math.round((currentXP / nextLevelXP) * 100));
        
        // Создаем визуальную шкалу прогресса (10 делений)
        const filledBlocks = Math.floor(progressPercent / 10);
        const emptyBlocks = 10 - filledBlocks;
        const progressBar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);
        
        skillDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                <span style="font-weight: 500;">${displayName}</span>
                <span style="color: #b0b0b0; font-size: 0.9em;">Уровень ${skillData.level}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; font-size: 0.85em;">
                <span style="color: #808080; font-family: monospace; letter-spacing: 2px;">${progressBar}</span>
                <span style="color: #4a90e2; font-weight: 500;">${currentXP}/${nextLevelXP} XP</span>
            </div>
            <div style="background: #1a1a1a; height: 4px; border-radius: 2px; border: 1px solid #333;">
                <div style="background: linear-gradient(90deg, #ffffff, #d0d0d0); height: 100%; width: ${progressPercent}%; border-radius: 2px; transition: width 0.3s ease;"></div>
            </div>
        `;
        skillsList.appendChild(skillDiv);
    });
}

function updateInventory() {
    const inventoryList = document.getElementById('inventoryList');
    if (!inventoryList || !gameState) return;
    
    inventoryList.innerHTML = '';
    
    if (gameState.inventory.length === 0) {
        inventoryList.innerHTML = '<p class="empty-text">Инвентарь пуст</p>';
        return;
    }
    
    gameState.inventory.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'inventory-item';
        itemDiv.innerHTML = `
            <span>${item.name}</span>
            <span>x${item.quantity}</span>
        `;
        inventoryList.appendChild(itemDiv);
    });
}

function updateHistory() {
    const historyList = document.getElementById('historyList');
    if (!historyList || !gameState) return;
    
    historyList.innerHTML = '';
    
    if (!gameState.history || gameState.history.length === 0) {
        historyList.innerHTML = '<p class="empty-text">Начало приключения</p>';
        return;
    }
    
    const recentHistory = gameState.history.slice(-20).reverse();
    
    recentHistory.forEach(entry => {
        const historyDiv = document.createElement('div');
        historyDiv.className = 'history-item';
        historyDiv.innerHTML = `
            <p><strong>Выбор:</strong> ${entry.choice}</p>
            <p style="margin-top: 5px; font-size: 0.85em; color: #a0a0a0;">${entry.scene.substring(0, 150)}${entry.scene.length > 150 ? '...' : ''}</p>
        `;
        historyList.appendChild(historyDiv);
    });
}

function initTabHandlers() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        
        newBtn.addEventListener('click', () => {
            const tab = newBtn.dataset.tab;
            
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            newBtn.classList.add('active');
            
            const tabContent = document.getElementById(tab + 'Tab');
            if (tabContent) {
                tabContent.classList.add('active');
            }
            
            if (gameState) {
                if (tab === 'character') updateCharacter();
                else if (tab === 'skills') updateSkills();
                else if (tab === 'inventory') updateInventory();
                else if (tab === 'history') updateHistory();
            }
        });
    });
}

function initCustomChoiceHandlers() {
    const customChoiceBtn = document.getElementById('customChoiceBtn');
    const customChoiceInput = document.getElementById('customChoice');
    
    if (!customChoiceBtn || !customChoiceInput) return;
    
    const newBtn = customChoiceBtn.cloneNode(true);
    customChoiceBtn.parentNode.replaceChild(newBtn, customChoiceBtn);
    
    const newInput = customChoiceInput.cloneNode(true);
    customChoiceInput.parentNode.replaceChild(newInput, customChoiceInput);
    
    newBtn.addEventListener('click', () => {
        const custom = newInput.value.trim();
        if (custom) {
            makeChoice(custom);
            newInput.value = '';
        }
    });
    
    newInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            newBtn.click();
        }
    });
}

function initHistoryModal() {
    const historyBtn = document.getElementById('historyBtn');
    const historyModal = document.getElementById('historyModal');
    const closeHistoryModal = document.getElementById('closeHistoryModal');
    
    if (!historyBtn || !historyModal) return;
    
    const newHistoryBtn = historyBtn.cloneNode(true);
    historyBtn.parentNode.replaceChild(newHistoryBtn, historyBtn);
    
    newHistoryBtn.addEventListener('click', () => {
        historyModal.classList.remove('hidden');
        updateHistory();
    });
    
    if (closeHistoryModal) {
        const newCloseBtn = closeHistoryModal.cloneNode(true);
        closeHistoryModal.parentNode.replaceChild(newCloseBtn, closeHistoryModal);
        
        newCloseBtn.addEventListener('click', () => {
            historyModal.classList.add('hidden');
        });
    }
    
    historyModal.addEventListener('click', (e) => {
        if (e.target === historyModal) {
            historyModal.classList.add('hidden');
        }
    });
}

function restoreGame(savedData) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);
    
    ws.onopen = () => {
        console.log('✅ WebSocket подключен при восстановлении');
        window.pendingRestore = {
            gameState: savedData.gameState,
            currentScene: savedData.currentScene || '',
            currentChoices: savedData.currentChoices || []
        };
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'connected') {
            currentSessionId = data.sessionId;
            console.log(`🔗 Подключено, SessionID: ${currentSessionId}`);
            
            if (window.pendingRestore) {
                gameState = window.pendingRestore.gameState;
                currentScene = window.pendingRestore.currentScene;
                currentChoices = window.pendingRestore.currentChoices;
                
                updateUI();
                displayScene(currentScene, currentChoices);
                
                document.getElementById('startScreen').classList.add('hidden');
                document.getElementById('gameScreen').classList.remove('hidden');
                
                setTimeout(() => {
                    initTabHandlers();
                    initCustomChoiceHandlers();
                    initHistoryModal();
                    initSaveLoadHandlers();
                }, 100);
                
                // Отправляем загруженное состояние на сервер
    ws.send(JSON.stringify({
                    type: 'load', 
                    gameState: gameState,
                    currentScene: currentScene,
                    currentChoices: currentChoices
                }));
                delete window.pendingRestore;
                
                console.log('✅ Сохранение загружено успешно!');
            }
        } else {
            handleMessage(data);
        }
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        alert('Ошибка подключения к серверу!');
    };
    
    ws.onclose = () => {
        console.log('Disconnected from server');
    };
}

function saveGameToLocalStorage() {
    if (!gameState) return;
    
    const saveData = {
        gameState,
        currentScene,
        currentChoices,
        timestamp: Date.now()
    };
    
    localStorage.setItem('kingdomSave', JSON.stringify(saveData));
}

function loadGameFromLocalStorage() {
    const saved = localStorage.getItem('kingdomSave');
    return saved ? JSON.parse(saved) : null;
}

function clearLocalStorageSave() {
    localStorage.removeItem('kingdomSave');
}

function showLoading() {
    const loading = document.getElementById('loadingIndicator');
    if (loading) loading.style.display = 'block';
}

function hideLoading() {
    const loading = document.getElementById('loadingIndicator');
    if (loading) loading.style.display = 'none';
}

// Функция для скачивания сохранения
function downloadSave() {
    if (!gameState) {
        alert('Нет данных для сохранения!');
        return;
    }
    
    const saveData = {
        gameState,
        currentScene,
        currentChoices,
        timestamp: Date.now(),
        version: '1.0'
    };
    
    const json = JSON.stringify(saveData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    // Создаём имя файла с датой и именем персонажа
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = date.toTimeString().slice(0, 5).replace(/:/g, '');
    const fileName = `kingdom_save_${gameState.name}_${dateStr}_${timeStr}.json`;
    
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log(`💾 Сохранение скачано: ${fileName}`);
    alert(`💾 Сохранение скачано: ${fileName}`);
}

// Функция для загрузки сохранения из файла
function loadSaveFromFile(file) {
    const reader = new FileReader();
    
    reader.onload = (e) => {
        try {
            const saveData = JSON.parse(e.target.result);
            
            if (!saveData.gameState) {
                alert('❌ Файл сохранения повреждён или неверного формата!');
                return;
            }
            
            console.log('📂 Загружено сохранение из файла:', file.name);
            
            // Подтверждение загрузки
            const confirmLoad = confirm(
                `📂 Загрузить сохранение?\n\n` +
                `Персонаж: ${saveData.gameState.name}\n` +
                `Дата сохранения: ${saveData.timestamp ? new Date(saveData.timestamp).toLocaleString('ru-RU') : 'неизвестно'}\n\n` +
                `Текущий прогресс будет потерян!`
            );
            
            if (confirmLoad) {
                // Очищаем текущее сохранение
                clearLocalStorageSave();
                
                // Восстанавливаем игру
                restoreGame(saveData);
            }
        } catch (error) {
            console.error('Ошибка при загрузке файла:', error);
            alert('❌ Ошибка при чтении файла сохранения! Проверьте формат файла.');
        }
    };
    
    reader.onerror = () => {
        alert('❌ Ошибка при чтении файла!');
    };
    
    reader.readAsText(file);
}

// Инициализация обработчиков сохранения и загрузки
function initSaveLoadHandlers() {
    const saveBtn = document.getElementById('saveBtn');
    const loadBtn = document.getElementById('loadBtn');
    const fileInput = document.getElementById('fileInput');
    
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            if (!gameState) {
                alert('Нет данных для сохранения! Начните игру.');
                return;
            }
            downloadSave();
        });
    }
    
    if (loadBtn && fileInput) {
        loadBtn.addEventListener('click', () => {
            fileInput.click();
        });
        
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
                    alert('❌ Пожалуйста, выберите JSON файл!');
                    return;
                }
                loadSaveFromFile(file);
                // Сбрасываем input, чтобы можно было загрузить тот же файл снова
                fileInput.value = '';
            }
        });
    }
}

































