// KINGDOM COME: AI RPG - Сервер с WebSocket
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { promises as fs } from 'fs';
import { join } from 'path';

const PORT = process.env.PORT || 3000;
const COMET_API_KEY = 'sk-jwPgtUPNYyGb7YoirTUy26AKqmdFVzHLsHye55rV6OxIYDMK';
const COMET_API_BASE = 'https://api.cometapi.com/v1';
const MODEL_NAME = 'grok-4-1-fast-reasoning';

// HTTP сервер для статики
const httpServer = createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(readFileSync('index.html'));
    } else if (req.url === '/style.css') {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        res.end(readFileSync('style.css'));
    } else if (req.url === '/client.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(readFileSync('client.js'));
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

// WebSocket сервер
const wss = new WebSocketServer({ server: httpServer });

// Игровое состояние для каждого клиента
const gameSessions = new Map();

// Путь к папке сохранений
const SAVES_DIR = join(process.cwd(), 'saves');
const AI_ERROR_LOG = join(process.cwd(), 'ai_errors.log');

// Создаем папку для сохранений, если её нет
(async () => {
    try {
        await fs.mkdir(SAVES_DIR, { recursive: true });
    } catch (error) {
        console.error('Error creating saves directory:', error);
    }
})();

// Функции сохранения/загрузки
async function saveGame(sessionId, gameState) {
    try {
        const savePath = join(SAVES_DIR, `save_${sessionId}.json`);
        const saveData = {
            sessionId,
            gameState,
            timestamp: new Date().toISOString()
        };
        await fs.writeFile(savePath, JSON.stringify(saveData, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('Error saving game:', error);
        return false;
    }
}

async function loadGame(sessionId) {
    try {
        const savePath = join(SAVES_DIR, `save_${sessionId}.json`);
        const data = await fs.readFile(savePath, 'utf8');
        const saveData = JSON.parse(data);
        return saveData.gameState;
    } catch (error) {
        console.error('Error loading game:', error);
        return null;
    }
}

async function listSaves() {
    try {
        const files = await fs.readdir(SAVES_DIR);
        const saves = [];
        
        for (const file of files) {
            if (file.startsWith('save_') && file.endsWith('.json')) {
                try {
                    const data = await fs.readFile(join(SAVES_DIR, file), 'utf8');
                    const saveData = JSON.parse(data);
                    saves.push({
                        sessionId: saveData.sessionId,
                        name: saveData.gameState.name,
                        location: saveData.gameState.location,
                        day: saveData.gameState.day,
                        timestamp: saveData.timestamp
                    });
                } catch (error) {
                    console.error(`Error reading save file ${file}:`, error);
                }
            }
        }
        
        return saves;
    } catch (error) {
        console.error('Error listing saves:', error);
        return [];
    }
}

async function logAIParseFailure(sessionId, choice, attempt, rawResponse, errorMessage) {
    const lines = [
        '═══════════════════════════════════════════════',
        `🕒 ${new Date().toISOString()}`,
        `SessionID: ${sessionId}`,
        `Choice: ${choice}`,
        `Attempt: ${attempt + 1}`,
        `Error: ${errorMessage}`,
        'RAW RESPONSE START ===>',
        rawResponse,
        '<=== RAW RESPONSE END',
        ''
    ].join('\n');

    console.error('❌ AI FORMAT ERROR', {
        sessionId,
        choice,
        attempt: attempt + 1,
        error: errorMessage
    });

    try {
        await fs.appendFile(AI_ERROR_LOG, lines, 'utf8');
    } catch (logError) {
        console.error('❌ Failed to write AI error log:', logError.message);
    }
}

function createGameState(name, gender = 'male') {
    const genderText = gender === 'female' ? 'женщина' : 'мужчина';
    const genderPronoun = gender === 'female' ? 'она' : 'он';
    
    return {
        name,
        gender,
        location: 'Ратай, улица у рынка',
        time: 'утро',
        // Система дат: начало 12 июня 1403 года
        date: {
            day: 12,
            month: 6,
            year: 1403,
            dayOfGame: 1,
            hour: 9, // 9 утра
            timeOfDay: 'утро' // утро, день, вечер, ночь
        },
        health: 65, // Травмы от столкновения с конём
        maxHealth: 100,
        stamina: 50, // Сильно истощен
        maxStamina: 100,
        coins: 0, // Без денег
        reputation: 25, // Никто не знает
        morality: 50, // Нейтральная мораль
        equipment: {
            weapon: { name: 'нет', condition: 0 },
            armor: { name: 'нет', condition: 0 }
        },
        inventory: [], // Полностью пустой инвентарь
        skills: {
            combat: { level: 0, xp: 0, maxLevel: 100, nextLevel: 100 },
            stealth: { level: 0, xp: 0, maxLevel: 100, nextLevel: 100 },
            speech: { level: 0, xp: 0, maxLevel: 100, nextLevel: 100 },
            survival: { level: 0, xp: 0, maxLevel: 100, nextLevel: 100 }
        },
        character: {
            background: `${name} - ${genderText}, очнувш${genderPronoun === 'он' ? 'ийся' : 'аяся'} в грязи на улице Ратая. ${genderPronoun === 'он' ? 'Его' : 'Её'} сбил всадник на коне - ${genderPronoun === 'он' ? 'он' : 'она'} валяется избитым, без одежды и вещей. ${genderPronoun === 'он' ? 'Он' : 'Она'} ничего не помнит о себе. Есть только смутные обрывки чего-то странного - но что это? Местные жители не знают, кто это. Нужно выживать в этом средневековом мире.`,
            traits: ['растерянный', 'стойкий', 'адаптивный', 'наблюдательный'],
            recentEvents: [], // Последние события
            importantChoices: [], // Важные выборы
            relationships: {},
            // Смутные обрывки "памяти" - реальны ли они?
            memories: [
                'Обрывок чего-то: огромные железные коробки на колесах, несущиеся быстрее лошадей... Сон? Видение?',
                'Неясные образы: толпы людей в странной гладкой одежде, яркие огни повсюду, шум и суета',
                'Смутное ощущение: гладкие поверхности, светящиеся символы, звуки, которых здесь нет',
                'Странная уверенность: я не отсюда. Но откуда? Другое место? Другое время? Или это всё в моей голове?'
            ],
            // Новая система: хронология важных вех
            milestones: [
                {
                    date: { day: 12, month: 6, year: 1403 },
                    event: 'Пробуждение на улице Ратая после столкновения с всадником',
                    dayOfGame: 1
                }
            ]
        },
        quests: [],
        history: [], // Полная история всех действий с датами
        _lastRepIncreaseDay: null
    };
}

async function generateWithAI(prompt) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 90000);
        
        const response = await fetch(`${COMET_API_BASE}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${COMET_API_KEY}`
            },
            body: JSON.stringify({
                model: MODEL_NAME,
                messages: [
                    {
                        role: 'system',
                        content: 'Ты мастер RPG-игр в стиле Kingdom Come: Deliverance. ⚠️ ОТВЕЧАЙ СТРОГО ТОЛЬКО ВАЛИДНЫМ JSON БЕЗ MARKDOWN БЛОКОВ! ⚠️ Формат: {"description": "...", "health": 0, "usedItems": [], "newItems": [], "skillXP": {}, "choices": []}. Все текстовые поля на русском.\n\n🔴 КРИТИЧЕСКИ ВАЖНО - ОБЯЗАТЕЛЬНЫЕ ПОЛЯ В КАЖДОМ ОТВЕТЕ:\n1) "usedItems" - ВСЕГДА массив (пустой [] если ничего не использовано)\n2) "newItems" - ВСЕГДА массив (пустой [] если ничего не получено)\n3) "skillXP" - ВСЕГДА объект (пустой {} если навыки не использовались)\n4) "choices" - ВСЕГДА массив из 3 вариантов\n\n📝 ОПИСАНИЕ: ДЕТАЛЬНОЕ и АТМОСФЕРНОЕ - МАКСИМУМ 130 СЛОВ! (4-6 предложений). ОБЯЗАТЕЛЬНО ДЕЛИ НА АБЗАЦЫ используя \\n\\n для разделения. Каждый абзац = отдельная мысль/сцена (2-3 предложения).\n\n📦 ИНВЕНТАРЬ (КРИТИЧЕСКИ ВАЖНО): Если игрок съел, выбросил, использовал, потерял или отдал предмет - ВСЕГДА указывай его в "usedItems". Это КРИТИЧЕСКИ ВАЖНО для игровой логики! Без этого игра сломается!\n\n⚔️ НАВЫКИ (КРИТИЧЕСКИ ВАЖНО): Если игрок успешно применил навык (бой, скрытность, красноречие, выживание) - ВСЕГДА указывай прирост опыта в "skillXP": {"combat": 15}. Это КРИТИЧЕСКИ ВАЖНО для прогрессии персонажа!\n\nСоздавай живое и захватывающее повествование с деталями окружения, действий персонажей, атмосферы и последствий выбора игрока. Используй короткие динамичные предложения для лучшей читаемости. ВСЕГДА используй обращение "вы/вас/ваш", НИКОГДА не упоминай имя персонажа в описании. НЕ упоминай навыки, уровни, репутацию в описании - только сюжет и атмосферу.'
                    },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.8,
                max_tokens: 2000
            }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`API error ${response.status}`);
        }
        
        const data = await response.json();
        return data.choices[0].message.content;
        
    } catch (error) {
        console.error('AI Error:', error.message);
        throw error;
    }
}

// Функция для форматирования даты
function formatDate(date) {
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 
                    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    return `${date.day} ${months[date.month - 1]} ${date.year} года`;
}

// Функция умной буферизации истории
function buildHistoryContext(gameState) {
    // Совместимость со старыми сохранениями
    if (!gameState.date) {
        gameState.date = {
            day: 5,
            month: 6,
            year: 1403,
            dayOfGame: gameState.day || 1,
            hour: 9,
            timeOfDay: gameState.time || 'утро'
        };
    }
    
    const currentDay = gameState.date.dayOfGame;
    
    // 1. ДРЕВНЯЯ ИСТОРИЯ (>30 дней назад) - только вехи
    const milestones = gameState.character.milestones || [];
    const ancientMilestones = milestones.filter(m => currentDay - m.dayOfGame > 30);
    
    // 2. СРЕДНЯЯ ИСТОРИЯ (7-30 дней назад) - сжато
    const recentMilestones = milestones.filter(m => {
        const diff = currentDay - m.dayOfGame;
        return diff >= 7 && diff <= 30;
    });
    
    // 3. НЕДАВНИЕ СОБЫТИЯ (последние 7 дней) - подробно
    const recentEvents = gameState.character.recentEvents || [];
    
    // 4. ПОСЛЕДНИЕ ДЕЙСТВИЯ - РАСШИРЕННАЯ ИСТОРИЯ
    // Берем последние 15 действий для полного контекста!
    const lastActions = gameState.history.slice(-15);
    
    // Разделяем на группы для лучшей читаемости
    const veryRecentActions = lastActions.slice(-5); // Последние 5 - полностью
    const recentActions = lastActions.slice(-15, -5); // Предыдущие 10 - сжато
    
    let historyText = '';
    
    // Древние вехи
    if (ancientMilestones.length > 0) {
        historyText += '═══ ВАЖНЫЕ ВЕХИ ПУТЕШЕСТВИЯ ═══\n';
        ancientMilestones.forEach(m => {
            historyText += `📜 ${formatDate(m.date)}: ${m.event}\n`;
        });
        historyText += '\n';
    }
    
    // Средняя история
    if (recentMilestones.length > 0) {
        historyText += '═══ СОБЫТИЯ ПОСЛЕДНИХ НЕДЕЛЬ ═══\n';
        recentMilestones.forEach(m => {
            historyText += `📅 ${formatDate(m.date)}: ${m.event}\n`;
        });
        historyText += '\n';
    }
    
    // Недавние события - РАСШИРЕНО до 15!
    if (recentEvents.length > 0) {
        historyText += '═══ НЕДАВНИЕ СОБЫТИЯ (последние 7 дней) ═══\n';
        recentEvents.slice(-15).forEach(e => {
            historyText += `- ${e}\n`;
        });
        historyText += '\n';
    }
    
    // История действий - структурированно
    if (recentActions.length > 0) {
        historyText += '═══ ПРЕДЫДУЩИЕ ДЕЙСТВИЯ (10 ходов назад) ═══\n';
        recentActions.forEach(h => {
            historyText += `• "${h.choice}" → ${h.scene.substring(0, 100)}...\n`;
        });
        historyText += '\n';
    }
    
    // Последние действия - ПОЛНЫЙ КОНТЕКСТ
    if (veryRecentActions.length > 0) {
        historyText += '═══ ПОСЛЕДНИЕ ДЕЙСТВИЯ (полное описание) ═══\n';
        veryRecentActions.forEach((h, idx) => {
            historyText += `\n[${veryRecentActions.length - idx} ход назад]\n`;
            historyText += `Выбор: "${h.choice}"\n`;
            historyText += `Что произошло: ${h.scene}\n`;
        });
    }
    
    // КРИТИЧЕСКИ ВАЖНО: 3 последних ПОЛНЫХ сцены для максимального контекста
    const last3Scenes = gameState.history.slice(-3);
    if (last3Scenes.length > 0) {
        historyText += '\n\n═══════════════════════════════════════════════════════════════\n';
        historyText += 'ПОСЛЕДНИЕ 3 ПОЛНЫЕ СЦЕНЫ (для глубокого контекста)\n';
        historyText += '═══════════════════════════════════════════════════════════════\n';
        
        last3Scenes.forEach((scene, idx) => {
            historyText += `\n┌─────────────────────────────────────────────────────────────┐\n`;
            historyText += `│ СЦЕНА ${idx + 1} (${last3Scenes.length - idx} ход назад)\n`;
            historyText += `└─────────────────────────────────────────────────────────────┘\n\n`;
            historyText += `ВЫБОР ИГРОКА:\n"${scene.choice}"\n\n`;
            historyText += `ПОЛНОЕ ОПИСАНИЕ:\n${scene.scene}\n\n`;
            if (scene.choices && scene.choices.length > 0) {
                historyText += `ВАРИАНТЫ ДЕЙСТВИЙ:\n`;
                scene.choices.forEach((choice, i) => {
                    historyText += `${i + 1}. ${choice}\n`;
                });
                historyText += `\n`;
            }
        });
    }
    
    return historyText || 'Начало приключения';
}

function buildPrompt(gameState, playerChoice, previousScene) {
    const historyContext = buildHistoryContext(gameState);
    
    return `⚠️⚠️⚠️ ОТВЕЧАЙ СТРОГО ТОЛЬКО ВАЛИДНЫМ JSON! БЕЗ markdown, текста, комментариев, объяснений или подписи. Начинай СРАЗУ с { и заканчивай } ⚠️⚠️⚠️

Ты мастер повествования RPG в стиле Kingdom Come: Deliverance (средневековая Богемия 1403). Создавай реалистичный, жестокий мир с последствиями.

═══ КОНТЕКСТ ПЕРСОНАЖА ═══
ИМЯ: ${gameState.name}
ПОЛ: ${gameState.gender === 'female' ? 'женский' : 'мужской'}
ДАТА: ${formatDate(gameState.date)} (День: ${gameState.date.dayOfGame})
ВРЕМЯ: ${gameState.date.timeOfDay} (${gameState.date.hour}:00)
ЛОКАЦИЯ: ${gameState.location}

ХАРАКТЕРИСТИКИ:
- Здоровье: ${gameState.health}/${gameState.maxHealth}
- Выносливость: ${gameState.stamina}/${gameState.maxStamina}
- Монеты: ${gameState.coins} (для справки, возвращай ИЗМЕНЕНИЕ!)
- Репутация: ${gameState.reputation}/100
- Мораль: ${gameState.morality}/100

ЭКИПИРОВКА:
- Оружие: ${gameState.equipment.weapon.name} (${gameState.equipment.weapon.condition}%)
- Доспех: ${gameState.equipment.armor.name} (${gameState.equipment.armor.condition}%)

ИНВЕНТАРЬ: ${gameState.inventory.map(i => `${i.name} x${i.quantity}`).join(', ') || 'ПУСТО'}

НАВЫКИ: ${Object.entries(gameState.skills).map(([k, v]) => `${k}: уровень ${v.level} (${v.xp}/${v.nextLevel} XP)`).join(', ')}

═══ ПРЕДЫСТОРИЯ ═══
${gameState.character.background}
Черты: ${gameState.character.traits.join(', ')}
Смутные воспоминания: ${gameState.character.memories.map(m => m).join('; ')}

═══ ИСТОРИЯ ПУТЕШЕСТВИЯ ═══
${historyContext}

═══ ТЕКУЩАЯ СИТУАЦИЯ ═══
Предыдущая сцена: ${previousScene || 'Начало игры'}
Действие игрока: "${playerChoice}"

═══ ПРАВИЛА ИГРЫ ═══
1. РЕАЛИСТИЧНОСТЬ: Мир жестокий. Ошибки приводят к смерти. Учитывай низкие навыки (0 уровень = новичок, провал вероятен).
2. СМЕРТЬ: Если травмы несовместимы с жизнью (меч в сердце, падение с высоты) - gameOver: true, deathReason: "Причина", description: "Описание смерти".
3. ТЮРЬМА: Не конец игры. Продолжай историю с вариантами побега. Используй gameOver: false.
4. ОПИСАНИЕ: Макс 130 слов, 4-6 предложений. Дели на абзацы \\n\\n. Атмосферно: детали, звуки, запахи. Используй "вы/вас". Не упоминать механики.
5. ИЗМЕНЕНИЯ:
   - health/stamina: +10/-5 (дельта)
   - coins: ИЗМЕНЕНИЕ (+10/-5/0), игра обновит баланс
   - reputation: ЧИСЛО (дельта). ПО УМОЛЧАНИЮ 0! Меняй только если поступок заметен и значим.
     * Никто не видел / действовал ради себя → 0
     * Обычная вежливость / работа / покупка → 0
     * Малое доброе дело (кто-то благодарен) → +1 (если репутация < 60)
     * Героический поступок при свидетелях → +2..+3 (если репутация < 70)
     * При репутации ≥ 70 положительное изменение максимум +1 и только за подвиг, иначе 0
     * Плохие поступки: -3..-10 (воровство, насилие, обман), если заметили
     * Тяжкое преступление → -12..-20
     * Если сомневаешься → 0
   - timeChange: Часы (0.5-12)
   - locationChange: Новая локация или ""
6. НАВЫКИ: Давай XP за применение (успех: 8-20, частичный: 4-10, неудача: 2-5, пассив: 0). Навыки: combat, stealth, speech, survival.
7. ИНВЕНТАРЬ: usedItems: массив имен (повтор для количества, e.g. ["хлеб", "хлеб"]). newItems: [{name, quantity, type}].
8. ДИАЛОГИ: isDialogue: true, speakerName: "Имя", choices: реплики. Иначе false.
9. ОБНОВЛЕНИЕ ПЕРСОНАЖА: characterUpdate с recentEvents, importantChoices, relationships, milestone (только эпохальное).
10. ВЫБОРЫ: 3 варианта, разнообразные, на русском.

═══ ФОРМАТ ОТВЕТА (ТОЛЬКО JSON) ═══
{
  "description": "...",
  "health": 0,
  "stamina": 0,
  "coins": 0,
  "reputation": 0,
  "morality": 0,
  "timeChange": 0,
  "locationChange": "",
  "isDialogue": false,
  "speakerName": "",
  "skillXP": {},
  "equipment": {weapon: {name: "", condition: 0}, armor: {name: "", condition: 0}},
  "characterUpdate": {recentEvents: [], importantChoices: [], relationships: {}, milestone: ""},
  "usedItems": [],
  "newItems": [],
  "choices": ["Вариант1", "Вариант2", "Вариант3"]
}

═══ САМОПРОВЕРКА ═══
1. JSON валидный?
2. Все поля есть? (usedItems/newItems/skillXP/choices обязательны)
3. Описание: <=130 слов, с \\n\\n, "вы/вас"?
4. Навыки: XP за применение?
5. Монеты: дельта (+/-)?
6. Репутация: ЧИСЛО (дельта). □ Ничего заметного? → 0. □ Высокая репутация (70+) → максимум +1? Учтена история?
7. Инвентарь: usedItems с повторами для количества?
8. Смерть: gameOver только при реальной смерти?
9. Диалог: правильные реплики если isDialogue?

Исправь ошибки перед отправкой! ОТВЕЧАЙ ТОЛЬКО ЧИСТЫМ JSON БЕЗ ТЕКСТА ВНЕ { }!`;
}

function parseAIResponse(text) {
    try {
        const jsonMatch = text.replace(/\r/g, '').match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('JSON not found');
        }
        let cleaned = jsonMatch[0]
            .replace(/\/\/.*$/gm, '')
            .replace(/,\s*}/g, '}')
            .replace(/,\s*]/g, ']')
            .trim();
        
        console.log('🧹 Cleaned AI response:', cleaned);
        
        const parsed = JSON.parse(cleaned);
        
        console.log('🔍 RAW AI RESPONSE:', JSON.stringify(parsed, null, 2));
        
        // КРИТИЧЕСКИ ВАЖНО: Валидация обязательных полей
        if (!parsed.description) parsed.description = 'Вы продолжаете свой путь...';
        
        // Логируем длину описания
        if (parsed.description) {
            const words = parsed.description.split(/\s+/);
            console.log(`📝 Получено описание: ${words.length} слов`);
        }
        
        if (!Array.isArray(parsed.choices) || parsed.choices.length === 0) {
            parsed.choices = ['Продолжить', 'Осмотреться', 'Отдохнуть'];
        }
        
        // КРИТИЧЕСКИ ВАЖНО: Проверка и инициализация инвентарных полей
        if (!Array.isArray(parsed.usedItems)) {
            console.warn('⚠️ AI НЕ ПРИСЛАЛ usedItems! Инициализирую пустым массивом.');
            parsed.usedItems = [];
                } else {
            console.log(`✅ AI прислал usedItems:`, parsed.usedItems);
        }
        
        if (!Array.isArray(parsed.newItems)) {
            console.warn('⚠️ AI НЕ ПРИСЛАЛ newItems! Инициализирую пустым массивом.');
            parsed.newItems = [];
        } else {
            console.log(`✅ AI прислал newItems:`, parsed.newItems);
        }
        
        // Валидация структуры newItems
        if (Array.isArray(parsed.newItems) && parsed.newItems.length > 0) {
            parsed.newItems = parsed.newItems.filter(item => {
                if (!item.name || typeof item.name !== 'string') {
                    console.warn('⚠️ Некорректный предмет в newItems (нет name):', item);
                    return false;
                }
                if (typeof item.quantity !== 'number') {
                    item.quantity = 1;
                }
                if (!item.type) {
                    item.type = 'item';
                }
                return true;
            });
        }
        
        // Валидация usedItems
        if (Array.isArray(parsed.usedItems) && parsed.usedItems.length > 0) {
            parsed.usedItems = parsed.usedItems.filter(itemName => {
                if (typeof itemName !== 'string' || !itemName.trim()) {
                    console.warn('⚠️ Некорректное имя предмета в usedItems:', itemName);
                    return false;
                }
                return true;
            });
        }
        
        return parsed;
    } catch (error) {
        console.error('❌ Parse error! Raw text:', text);
        error.message = `Failed to parse AI response: ${error.message}`;
        throw error;
    }
}

async function requestAIResponse(gameState, choice, previousScene, attempt = 0, sessionId = 'unknown') {
    const maxAttempts = 2;
    const basePrompt = buildPrompt(gameState, choice, previousScene);
    const prompt = attempt === 0
        ? basePrompt
        : `${basePrompt}\n\n⚠️ ТЫ ПРИСЛАЛ НЕВЕРНЫЙ ФОРМАТ! ПОВТОРИ ТОТ ЖЕ ОТВЕТ СТРОГО В ВАЛИДНОМ JSON БЕЗ ТЕКСТА ВНЕ { }.`;
    
    const aiResponse = await generateWithAI(prompt);
    console.log(`🧠 RAW AI RESPONSE (attempt ${attempt + 1}):`, aiResponse);
    try {
        return parseAIResponse(aiResponse);
    } catch (error) {
        await logAIParseFailure(sessionId, choice, attempt, aiResponse, error.message);
        if (attempt + 1 < maxAttempts) {
            console.warn(`⚠️ AI response parse failed (attempt ${attempt + 1}). Retrying...`);
            return requestAIResponse(gameState, choice, previousScene, attempt + 1, sessionId);
        }
        throw error;
    }
}

// Функция обновления времени
function updateTime(gameState, hoursToAdd) {
    if (!gameState.date) {
        gameState.date = {
            day: 5,
            month: 6,
            year: 1403,
            dayOfGame: 1,
            hour: 9,
            timeOfDay: 'утро'
        };
    }
    
    // Добавляем часы
    gameState.date.hour += hoursToAdd;
    
    // Обрабатываем переход через сутки
    while (gameState.date.hour >= 24) {
        gameState.date.hour -= 24;
        gameState.date.day += 1;
        gameState.date.dayOfGame += 1;
        
        // Обрабатываем переход месяца (июнь - 30 дней)
        const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        if (gameState.date.day > daysInMonth[gameState.date.month - 1]) {
            gameState.date.day = 1;
            gameState.date.month += 1;
            if (gameState.date.month > 12) {
                gameState.date.month = 1;
                gameState.date.year += 1;
            }
        }
        
        console.log(`📅 Новый день: ${formatDate(gameState.date)} (День ${gameState.date.dayOfGame})`);
    }
    
    // Определяем время суток
    const hour = gameState.date.hour;
    if (hour >= 5 && hour < 12) {
        gameState.date.timeOfDay = 'утро';
    } else if (hour >= 12 && hour < 18) {
        gameState.date.timeOfDay = 'день';
    } else if (hour >= 18 && hour < 22) {
        gameState.date.timeOfDay = 'вечер';
                } else {
        gameState.date.timeOfDay = 'ночь';
    }
    
    console.log(`⏰ Время обновлено: ${gameState.date.hour}:00 (${gameState.date.timeOfDay}), +${hoursToAdd} часов`);
}

function applyChanges(gameState, parsed) {
    // Обновляем время
    if (parsed.timeChange !== undefined && parsed.timeChange !== null) {
        updateTime(gameState, parsed.timeChange);
    }
    
    // Обновляем локацию
    if (parsed.locationChange && parsed.locationChange.trim()) {
        const oldLocation = gameState.location;
        gameState.location = parsed.locationChange;
        console.log(`📍 Локация изменена: ${oldLocation} → ${gameState.location}`);
    }
    
    // Применяем изменения характеристик
    if (parsed.health) {
        gameState.health = Math.max(0, Math.min(gameState.maxHealth, gameState.health + parsed.health));
    }
    if (parsed.stamina) {
        gameState.stamina = Math.max(0, Math.min(gameState.maxStamina, gameState.stamina + parsed.stamina));
    }
    // Монеты: Grok возвращает ИЗМЕНЕНИЕ (дельту), игра сама прибавляет/убирает
    if (parsed.coins !== undefined && parsed.coins !== null) {
        const oldCoins = gameState.coins;
        const change = parsed.coins; // Это изменение (дельта): +10, -5, 0
        gameState.coins = Math.max(0, gameState.coins + change); // Прибавляем/убираем изменение
        if (change !== 0) {
            console.log(`💰 Монеты изменены: ${oldCoins} ${change >= 0 ? '+' : ''}${change} = ${gameState.coins}`);
        }
    }
    if (parsed.reputation !== undefined && parsed.reputation !== null) {
        const currentDay = gameState.date && gameState.date.dayOfGame !== undefined
            ? gameState.date.dayOfGame
            : null;

        let delta = parsed.reputation;
        if (typeof delta !== 'number' || Number.isNaN(delta)) {
            console.warn('⚠️ Репутация указана некорректно (не число). Игнорирую.', parsed.reputation);
            delta = 0;
        }

        if (delta > 0) {
            if (currentDay !== null && gameState._lastRepIncreaseDay === currentDay) {
                console.log(`ℹ️ Репутация не увеличена: уже росла сегодня (день ${currentDay}).`);
                delta = 0;
            } else {
                if (gameState.reputation >= 70 && delta > 1) {
                    console.log(`⚠️ Репутация ≥70: ограничиваю прирост +1 вместо +${delta}.`);
                    delta = 1;
                } else if (gameState.reputation >= 60 && delta > 1) {
                    console.log(`⚠️ Репутация ≥60: ограничиваю прирост до +1 вместо +${delta}.`);
                    delta = 1;
                }
                if (delta > 0 && currentDay !== null) {
                    gameState._lastRepIncreaseDay = currentDay;
                }
            }
        } else if (delta < 0) {
            if (currentDay !== null) {
                gameState._lastRepIncreaseDay = null;
            }
        }

        if (delta !== 0) {
            const oldReputation = gameState.reputation;
            gameState.reputation = Math.max(0, Math.min(100, gameState.reputation + delta));
            console.log(`📣 Репутация изменена: ${oldReputation} ${delta >= 0 ? '+' : ''}${delta} = ${gameState.reputation}`);
        } else {
            console.log('ℹ️ Репутация без изменений (дельта 0).');
        }
    }
    if (parsed.morality !== undefined && parsed.morality !== null) {
        gameState.morality = Math.max(0, Math.min(100, gameState.morality + parsed.morality));
    }
    
    // Обновляем навыки
    if (parsed.skillXP) {
        Object.entries(parsed.skillXP).forEach(([skill, xp]) => {
            if (gameState.skills[skill] && xp > 0) {
                const oldLevel = gameState.skills[skill].level;
                const oldXP = gameState.skills[skill].xp;
                gameState.skills[skill].xp += xp;
                console.log(`📈 Навык ${skill}: получено ${xp} опыта (было: ${oldXP}, стало: ${gameState.skills[skill].xp})`);
                
                while (gameState.skills[skill].xp >= gameState.skills[skill].nextLevel) {
                    gameState.skills[skill].level++;
                    gameState.skills[skill].xp -= gameState.skills[skill].nextLevel;
                    gameState.skills[skill].nextLevel = Math.floor(gameState.skills[skill].nextLevel * 1.5);
                    console.log(`🎉 Навык ${skill} повысился! Уровень: ${oldLevel} → ${gameState.skills[skill].level}`);
                }
            }
        });
    }
    
    // Обновляем экипировку (КРИТИЧЕСКИ ВАЖНО!)
    if (parsed.equipment) {
        if (parsed.equipment.weapon) {
            const oldWeapon = gameState.equipment.weapon.name;
            gameState.equipment.weapon = {
                name: parsed.equipment.weapon.name || gameState.equipment.weapon.name,
                condition: parsed.equipment.weapon.condition !== undefined ? parsed.equipment.weapon.condition : gameState.equipment.weapon.condition
            };
            if (oldWeapon !== gameState.equipment.weapon.name) {
                console.log(`⚔️ Оружие изменено: "${oldWeapon}" → "${gameState.equipment.weapon.name}"`);
            }
        }
        
        if (parsed.equipment.armor) {
            const oldArmor = gameState.equipment.armor.name;
            gameState.equipment.armor = {
                name: parsed.equipment.armor.name || gameState.equipment.armor.name,
                condition: parsed.equipment.armor.condition !== undefined ? parsed.equipment.armor.condition : gameState.equipment.armor.condition
            };
            if (oldArmor !== gameState.equipment.armor.name) {
                console.log(`🛡️ Доспех изменён: "${oldArmor}" → "${gameState.equipment.armor.name}"`);
            }
        }
    }
    
    // Обновляем историю персонажа
    if (parsed.characterUpdate) {
        if (Array.isArray(parsed.characterUpdate.recentEvents)) {
            gameState.character.recentEvents.push(...parsed.characterUpdate.recentEvents);
            // Храним последние 30 событий для богатой истории!
            if (gameState.character.recentEvents.length > 30) {
                gameState.character.recentEvents = gameState.character.recentEvents.slice(-30);
            }
        }
        
        if (Array.isArray(parsed.characterUpdate.importantChoices)) {
            gameState.character.importantChoices.push(...parsed.characterUpdate.importantChoices);
            // Храним последние 15 важных выборов - они определяют характер!
            if (gameState.character.importantChoices.length > 15) {
                gameState.character.importantChoices = gameState.character.importantChoices.slice(-15);
            }
        }
        
        if (parsed.characterUpdate.relationships) {
            Object.entries(parsed.characterUpdate.relationships).forEach(([name, description]) => {
                gameState.character.relationships[name] = description;
            });
        }
        
        // Добавляем веху если AI указал её
        if (parsed.characterUpdate.milestone && parsed.characterUpdate.milestone.trim()) {
            if (!gameState.character.milestones) {
                gameState.character.milestones = [];
            }
            gameState.character.milestones.push({
                date: { ...gameState.date },
                event: parsed.characterUpdate.milestone,
                dayOfGame: gameState.date.dayOfGame
            });
            console.log(`📜 Добавлена веха: "${parsed.characterUpdate.milestone}"`);
        }
    }
    
    // Обновляем инвентарь
    if (Array.isArray(parsed.usedItems) && parsed.usedItems.length > 0) {
        console.log(`📦 AI указал использованные предметы:`, parsed.usedItems);
        parsed.usedItems.forEach(itemName => {
            const index = gameState.inventory.findIndex(i => i.name === itemName);
            if (index !== -1) {
                gameState.inventory[index].quantity--;
                console.log(`  ➖ Убрано: ${itemName} (осталось: ${gameState.inventory[index].quantity})`);
                if (gameState.inventory[index].quantity <= 0) {
                    gameState.inventory.splice(index, 1);
                    console.log(`  🗑️ Предмет "${itemName}" полностью убран из инвентаря`);
                }
            } else {
                console.warn(`  ⚠️ Предмет "${itemName}" не найден в инвентаре!`);
            }
        });
    } else {
        console.log(`📦 AI не указал использованные предметы (usedItems пустой)`);
    }
    
    if (Array.isArray(parsed.newItems) && parsed.newItems.length > 0) {
        console.log(`📦 AI добавил новые предметы:`, parsed.newItems);
        parsed.newItems.forEach(item => {
            const existing = gameState.inventory.find(i => i.name === item.name);
            if (existing) {
                existing.quantity += item.quantity || 1;
                console.log(`  ➕ Добавлено: ${item.name} x${item.quantity || 1} (всего: ${existing.quantity})`);
            } else {
                gameState.inventory.push({ ...item, quantity: item.quantity || 1 });
                console.log(`  ✨ Новый предмет: ${item.name} x${item.quantity || 1}`);
            }
        });
    }
}

wss.on('connection', (ws) => {
    const sessionId = Math.random().toString(36).substr(2, 9);
    console.log(`✅ Client connected, SessionID: ${sessionId}`);
    
    // Сохраняем sessionId в объекте ws для использования в обработчиках
    ws.sessionId = sessionId;
    
    // Отправляем sessionId клиенту
    ws.send(JSON.stringify({ type: 'connected', sessionId }));
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            const sessionId = ws.sessionId;
            
            if (data.type === 'start') {
                const gameState = createGameState(data.name || 'Странник', data.gender || 'male');
                gameSessions.set(sessionId, gameState);
                console.log(`🎮 Новая игра создана для ${gameState.name} (${gameState.gender}), SessionID: ${sessionId}`);
                console.log(`📊 Активных сессий: ${gameSessions.size}`);
                
                // Генерируем описание с учетом пола
                const genderDesc = gameState.gender === 'female' ? 
                    'Резкая боль пронзает всё тело. Вы медленно открываете глаза - перед вами грязная мостовая, лужи, конский навоз. Голова раскалывается. Вы лежите прямо на улице средневекового города, полностью голая и избитая. Тело покрыто ссадинами и грязью.' :
                    'Резкая боль пронзает всё тело. Вы медленно открываете глаза - перед вами грязная мостовая, лужи, конский навоз. Голова раскалывается. Вы лежите прямо на улице средневекового города, полностью голый и избитый. Тело покрыто ссадинами и грязью.';
                
                ws.send(JSON.stringify({
                    type: 'scene',
                    sessionId,
                    gameState,
                    description: `${genderDesc} Пытаясь сфокусировать взгляд, вы видите деревянные дома с соломенными крышами, повозки, толпу людей в грубой средневековой одежде. Они останавливаются, показывают на вас пальцем, шепчутся. Старуха плюётся и отворачивается. Несколько детей смеются и кидают камешки. Вы пытаетесь вспомнить - что произошло? Кто вы? В голове вспыхивают странные образы: огромные металлические коробки на колёсах, несущиеся быстрее любой лошади, ревущие и сверкающие огнями... Толпы людей, тысячи, в гладкой, яркой одежде, движущиеся между высокими, невероятно высокими зданиями из стекла и металла... Слепящие огни повсюду - красные, жёлтые, синие, мигающие, светящиеся даже ночью... Но это бред, правда? Удар по голове? Лихорадка? Это не может быть реальным. Вокруг вас грязь, навоз, деревянные хижины и люди в тряпье. Всё тело болит. Нужно срочно что-то делать.`,
                    choices: [
                        'Попытаться прикрыться руками и попросить помощи у прохожих',
                        'Быстро подняться и забежать в ближайший переулок',
                        'Осмотреться - может, рядом есть тряпки или выброшенная одежда'
                    ]
                }));
                
            } else if (data.type === 'load') {
                // Загрузка сохраненного состояния
                console.log(`📂 Получен запрос на загрузку сохранения, SessionID: ${sessionId}`);
                
                const loadedGameState = data.gameState;
                
                // Проверка обязательных полей
                if (!loadedGameState) {
                    console.error('❌ loadedGameState пустой или undefined!');
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Файл сохранения пустой или поврежден!'
                    }));
                    return;
                }
                
                if (!loadedGameState.name) {
                    console.error('❌ В gameState отсутствует поле name!');
                    console.error('Структура gameState:', Object.keys(loadedGameState));
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'В сохранении отсутствует имя персонажа!'
                    }));
                    return;
                }
                
                console.log(`✅ Загружается сохранение для персонажа: ${loadedGameState.name}`);
                
                // Совместимость со старыми сохранениями
                if (!loadedGameState.date) {
                    loadedGameState.date = {
                        day: 5,
                        month: 6,
                        year: 1403,
                        dayOfGame: loadedGameState.day || 1,
                        hour: 9,
                        timeOfDay: loadedGameState.time || 'утро'
                    };
                }
                
                // Убираем старое поле time если оно есть
                if (loadedGameState.time) {
                    delete loadedGameState.time;
                }
                
                // Убираем старое поле day если оно есть
                if (loadedGameState.day) {
                    delete loadedGameState.day;
                }
                
                // Проверяем навыки
                if (loadedGameState.skills) {
                    Object.keys(loadedGameState.skills).forEach(skillName => {
                        const skill = loadedGameState.skills[skillName];
                        if (!skill.nextLevel) {
                            skill.nextLevel = 100;
                        }
                        if (!skill.xp) {
                            skill.xp = 0;
                        }
                    });
                }

                if (loadedGameState._lastRepIncreaseDay === undefined) {
                    loadedGameState._lastRepIncreaseDay = null;
                }
                
                // Сохраняем состояние в сессии
                gameSessions.set(sessionId, loadedGameState);
                
                console.log(`📂 Загружено сохранение для ${loadedGameState.name}, SessionID: ${sessionId}`);
                console.log(`📊 Активных сессий: ${gameSessions.size}`);
                console.log(`🔍 Сохранено в gameSessions.get(${sessionId}): ${gameSessions.has(sessionId) ? 'ДА ✅' : 'НЕТ ❌'}`);
                console.log(`🔍 Список всех сессий: [${Array.from(gameSessions.keys()).join(', ')}]`);
                
                // Отправляем подтверждение загрузки
                ws.send(JSON.stringify({
                    type: 'loaded',
                    sessionId,
                    gameState: loadedGameState,
                    description: data.currentScene || 'Вы продолжаете свое путешествие...',
                    choices: data.currentChoices || [
                        'Продолжить',
                        'Осмотреться',
                        'Отдохнуть'
                    ]
                }));
                
            } else if (data.type === 'choice') {
                console.log(`🎯 Получен выбор игрока, SessionID: ${sessionId}`);
                console.log(`📊 Активных сессий: ${gameSessions.size}, Список: [${Array.from(gameSessions.keys()).join(', ')}]`);
                console.log(`🔍 ws.sessionId: ${ws.sessionId}`);
                console.log(`🔍 Проверка наличия сессии: ${gameSessions.has(sessionId) ? 'НАЙДЕНА ✅' : 'НЕ НАЙДЕНА ❌'}`);
                
                const gameState = gameSessions.get(sessionId);
                if (!gameState) {
                    console.error(`❌ Сессия не найдена! SessionID: ${sessionId}`);
                    console.error(`❌ ws.sessionId: ${ws.sessionId}`);
                    console.error(`❌ Доступные сессии: ${Array.from(gameSessions.keys()).join(', ')}`);
                    ws.send(JSON.stringify({ type: 'error', message: `Session not found. SessionID: ${sessionId}` }));
                    return;
                }
                
                console.log(`✅ Сессия найдена для ${gameState.name}`);
                
                ws.send(JSON.stringify({ type: 'generating' }));
                
                let parsed;
                try {
                    parsed = await requestAIResponse(gameState, data.choice, data.previousScene, 0, sessionId);
                } catch (error) {
                    console.error('❌ Не удалось получить корректный ответ от AI:', error.message);
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: `AI_FORMAT_ERROR: ${error.message}`
                    }));
                    return;
                }
                
                // КРИТИЧЕСКИ ВАЖНО: Проверяем, умер ли персонаж
                if (parsed.gameOver) {
                    console.log(`💀 GAME OVER для ${gameState.name}: ${parsed.deathReason}`);
                    
                    // Сохраняем последнее действие перед смертью
                    gameState.history.push({
                        choice: data.choice,
                        scene: parsed.description,
                        choices: [],
                        location: gameState.location,
                        date: { ...gameState.date },
                        gameOver: true,
                        deathReason: parsed.deathReason
                    });
                    
                    // Отправляем сообщение о смерти
                    ws.send(JSON.stringify({
                        type: 'gameOver',
                        sessionId,
                        deathReason: parsed.deathReason,
                        description: parsed.description,
                        finalStats: {
                            daysPlayed: gameState.date.dayOfGame,
                            actions: gameState.history.length,
                            coins: gameState.coins,
                            reputation: gameState.reputation
                        }
                    }));
                    
                    // Удаляем сессию
                    gameSessions.delete(sessionId);
                    console.log(`🗑️ Сессия ${sessionId} удалена после смерти`);
                    return;
                }
                
                applyChanges(gameState, parsed);
                
                // Сохраняем полную историю: выбор, описание И варианты действий
                gameState.history.push({
                    choice: data.choice,
                    scene: parsed.description,
                    choices: parsed.choices || [], // Сохраняем варианты для полного контекста
                    location: gameState.location,
                    date: { ...gameState.date }
                });
                
                ws.send(JSON.stringify({
                    type: 'scene',
                    sessionId,
                    gameState,
                    description: parsed.description,
                    choices: parsed.choices,
                    isDialogue: parsed.isDialogue || false,
                    speakerName: parsed.speakerName || ''
                }));
            } else if (data.type === 'save') {
                const gameState = gameSessions.get(sessionId);
                if (!gameState) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
                    return;
                }
                
                const success = await saveGame(sessionId, gameState);
                if (success) {
                    ws.send(JSON.stringify({ type: 'saved', message: 'Игра сохранена!' }));
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Ошибка сохранения' }));
                }
            } else if (data.type === 'load') {
                const loadedState = await loadGame(data.sessionId || sessionId);
                if (loadedState) {
                    gameSessions.set(sessionId, loadedState);
                    console.log(`💾 Игра загружена для ${loadedState.name}, SessionID: ${sessionId}`);
                    console.log(`📊 Активных сессий: ${gameSessions.size}`);
                    
                    ws.send(JSON.stringify({
                        type: 'loaded',
                        gameState: loadedState,
                        message: 'Игра загружена!'
                    }));
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Сохранение не найдено' }));
                }
            } else if (data.type === 'listSaves') {
                const saves = await listSaves();
                ws.send(JSON.stringify({
                    type: 'savesList',
                    saves
                }));
            }
            
        } catch (error) {
            console.error('❌❌❌ КРИТИЧЕСКАЯ ОШИБКА ❌❌❌');
            console.error('Тип ошибки:', error.name);
            console.error('Сообщение:', error.message);
            console.error('Stack trace:', error.stack);
            console.error('SessionID:', ws.sessionId);
            
            ws.send(JSON.stringify({
                type: 'error',
                message: `${error.name}: ${error.message}`
            }));
        }
    });
    
    ws.on('close', () => {
        console.log(`🔌 Client disconnected, SessionID: ${sessionId}`);
        gameSessions.delete(sessionId);
        console.log(`📊 Активных сессий: ${gameSessions.size}`);
    });
});

httpServer.listen(PORT, () => {
    console.log(`🏰 KINGDOM COME: AI RPG Server`);
    console.log(`📡 Server running on http://localhost:${PORT}`);
    console.log(`🌐 Open http://localhost:${PORT} in your browser`);
});



























