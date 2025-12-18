// KINGDOM COME: AI RPG - Сервер с WebSocket
import 'dotenv/config';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { promises as fs } from 'fs';
import { join } from 'path';

const PORT = process.env.PORT || 3000;
const COMET_API_KEY = process.env.COMET_API_KEY || ''; // Ключ теперь в .env или настройках облака
const COMET_API_BASE = 'https://api.cometapi.com/v1';
const MODEL_NAME = 'grok-4-1-fast-non-reasoning';

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

function clamp(n, min, max) {
    if (typeof n !== 'number' || Number.isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
}

function hashStringToInt(str) {
    // FNV-1a 32-bit
    let h = 2166136261;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function getTurnIndex(gameState) {
    return Array.isArray(gameState.history) ? gameState.history.length : 0;
}

function getSkillValue(gameState, key) {
    if (!key) return 0;
    const k = String(key).toLowerCase();
    // Skills: combat/stealth/speech/survival are 0..100 levels in this project
    if (gameState.skills && gameState.skills[k] && typeof gameState.skills[k].level === 'number') {
        return clamp(gameState.skills[k].level, 0, 100);
    }
    // Attributes: strength/agility/intelligence/charisma are 1..10
    if (gameState.attributes && typeof gameState.attributes[k] === 'number') {
        return clamp(gameState.attributes[k], 1, 10) * 10; // normalize to 0..100-ish
    }
    return 0;
}

function resolveSkillCheck(gameState, skillCheck, sessionId) {
    if (!skillCheck || typeof skillCheck !== 'object') return null;
    const kind = typeof skillCheck.kind === 'string' ? skillCheck.kind : 'skill';
    const key = typeof skillCheck.key === 'string' ? skillCheck.key : '';
    const difficulty = typeof skillCheck.difficulty === 'number' ? clamp(Math.round(skillCheck.difficulty), 0, 100) : 50;

    const actor = getSkillValue(gameState, key);
    // Chance curve: start at 50%, add (actor - difficulty) * 0.7
    const chance = clamp(Math.round(50 + (actor - difficulty) * 0.7), 5, 95);

    const seed = hashStringToInt(`${sessionId}|${getTurnIndex(gameState)}|${kind}|${key}|${difficulty}`);
    const rng = mulberry32(seed);
    const roll = Math.floor(rng() * 100) + 1; // 1..100
    const success = roll <= chance;

    return { kind, key, difficulty, actor, chance, roll, success };
}

function stableIdFromName(name) {
    const s = String(name || '').trim().toLowerCase();
    if (!s) return 'loc_' + Math.random().toString(36).slice(2, 10);
    // Simple stable-ish id (not cryptographic) to keep saves readable
    return 'loc_' + s
        .replace(/ё/g, 'е')
        .replace(/[^a-z0-9а-я\s_-]/gi, '')
        .replace(/\s+/g, '_')
        .slice(0, 40);
}

function normalizeWorldMap(gameState) {
    if (!Array.isArray(gameState.worldMap)) gameState.worldMap = [];
    gameState.worldMap = gameState.worldMap
        .filter(loc => loc && typeof loc === 'object' && loc.name)
        .map(loc => ({
            id: loc.id || stableIdFromName(loc.name),
            name: String(loc.name),
            x: typeof loc.x === 'number' ? loc.x : 0,
            y: typeof loc.y === 'number' ? loc.y : 0,
            description: loc.description ? String(loc.description) : '',
            type: loc.type ? String(loc.type) : 'place',
            discovered: loc.discovered !== false,
            discoveredAtDay: typeof loc.discoveredAtDay === 'number' ? loc.discoveredAtDay : (gameState.date?.dayOfGame ?? 1),
            visitedCount: typeof loc.visitedCount === 'number' ? loc.visitedCount : 0
        }));

    // De-duplicate by id (keep first)
    const seen = new Set();
    gameState.worldMap = gameState.worldMap.filter(loc => {
        if (seen.has(loc.id)) return false;
        seen.add(loc.id);
        return true;
    });

    // If map is empty, create a starting anchor at (0,0)
    if (gameState.worldMap.length === 0 && gameState.location) {
        gameState.worldMap.push({
            id: stableIdFromName(gameState.location),
            name: gameState.location,
            x: 0,
            y: 0,
            description: 'Текущее место',
            type: 'area',
            discovered: true,
            discoveredAtDay: gameState.date?.dayOfGame ?? 1,
            visitedCount: 1
        });
    }
}

function findLocationByName(gameState, name) {
    if (!name) return null;
    const n = String(name).trim().toLowerCase();
    if (!n) return null;
    // Prefer exact match; fallback to includes
    let loc = gameState.worldMap.find(l => l.name && l.name.toLowerCase() === n);
    if (loc) return loc;
    loc = gameState.worldMap.find(l => n.includes(l.name.toLowerCase()) || l.name.toLowerCase().includes(n));
    return loc || null;
}

function ensureGameStateIntegrity(gameState) {
    if (!gameState || typeof gameState !== 'object') return;
    if (!gameState.date) {
        gameState.date = { day: 5, month: 6, year: 1403, dayOfGame: gameState.day || 1, hour: 9, timeOfDay: gameState.time || 'утро' };
    }

    normalizeWorldMap(gameState);

    if (!gameState.playerPos || typeof gameState.playerPos !== 'object') {
        const loc = findLocationByName(gameState, gameState.location) || gameState.worldMap[0] || null;
        gameState.playerPos = {
            x: loc ? loc.x : 0,
            y: loc ? loc.y : 0,
            locationId: loc ? loc.id : null
        };
    } else {
        if (typeof gameState.playerPos.x !== 'number') gameState.playerPos.x = 0;
        if (typeof gameState.playerPos.y !== 'number') gameState.playerPos.y = 0;
        if (!('locationId' in gameState.playerPos)) gameState.playerPos.locationId = null;
    }

    if (!Array.isArray(gameState.worldEdges)) gameState.worldEdges = [];
    gameState.worldEdges = gameState.worldEdges
        .filter(e => e && typeof e === 'object' && e.fromId && e.toId)
        .map(e => ({
            fromId: String(e.fromId),
            toId: String(e.toId),
            kind: e.kind ? String(e.kind) : 'road',
            discoveredAtDay: typeof e.discoveredAtDay === 'number' ? e.discoveredAtDay : (gameState.date?.dayOfGame ?? 1)
        }));

    if (!gameState.npcs || typeof gameState.npcs !== 'object') gameState.npcs = {};
    if (!gameState.factions || typeof gameState.factions !== 'object') gameState.factions = {};
    if (!Array.isArray(gameState.debts)) gameState.debts = [];
    if (!gameState.character) gameState.character = {};
    if (!gameState.character.relationships || typeof gameState.character.relationships !== 'object') {
        gameState.character.relationships = {};
    }
    if (!gameState.character.npcLocations || typeof gameState.character.npcLocations !== 'object') {
        gameState.character.npcLocations = {};
    }

    if (!gameState.mapWaypoint || typeof gameState.mapWaypoint !== 'object') {
        gameState.mapWaypoint = { locationId: null, name: '' };
    }

    // Cooldown trackers (world rules)
    if (gameState._lastMoralityChangeDay === undefined) gameState._lastMoralityChangeDay = null;
    if (!gameState._npcDispositionLastChangeTurn || typeof gameState._npcDispositionLastChangeTurn !== 'object') {
        gameState._npcDispositionLastChangeTurn = {};
    }
}

function applyWorldRules(gameState, parsed) {
    // Called BEFORE applyChanges; may adjust parsed deltas/fields.
    ensureGameStateIntegrity(gameState);

    const currentDay = gameState.date?.dayOfGame ?? null;
    const turn = getTurnIndex(gameState);

    // Morality cooldown: don't change multiple times per day unless big event
    if (parsed.morality !== 0) {
        const big = Math.abs(parsed.morality) >= 3;
        if (!big && currentDay !== null && gameState._lastMoralityChangeDay === currentDay) {
            console.log(`ℹ️ Мораль не изменена: уже менялась сегодня (день ${currentDay}).`);
            parsed.morality = 0;
        } else if (parsed.morality !== 0 && currentDay !== null) {
            gameState._lastMoralityChangeDay = currentDay;
        }
        parsed.morality = clamp(parsed.morality, -5, 5);
    }

    // Reputation: keep existing logic later, but reduce extreme swings
    parsed.reputation = clamp(parsed.reputation, -5, 5);

    // Economy guardrails: big coin swings require justification in effects
    if (parsed.coins !== 0 && Math.abs(parsed.coins) > 30) {
        const txt = (Array.isArray(parsed.effects) ? parsed.effects : [])
            .map(e => (e?.reason ? String(e.reason).toLowerCase() : ''))
            .join(' ');
        const hasJustification = /оплат|плат|торг|награ|контракт|штраф|взятк|продал|купил/.test(txt);
        if (!hasJustification) {
            console.warn(`⚠️ Big coins delta without justification (${parsed.coins}) → clamping to +/-30`);
            parsed.coins = parsed.coins > 0 ? 30 : -30;
        }
    }

    // Relationship/disposition cooldown: prevent spammy oscillations
    if (parsed.characterUpdate && parsed.characterUpdate.relationships && typeof parsed.characterUpdate.relationships === 'object') {
        Object.keys(parsed.characterUpdate.relationships).forEach(npcName => {
            const rel = parsed.characterUpdate.relationships[npcName];
            if (!rel || typeof rel !== 'object') return;
            if (typeof rel.disposition !== 'number' || Number.isNaN(rel.disposition)) return;

            const lastTurn = gameState._npcDispositionLastChangeTurn[npcName];
            const tooSoon = typeof lastTurn === 'number' && (turn - lastTurn) < 3;
            if (tooSoon) {
                // strip disposition update, keep notes/role/status
                console.log(`ℹ️ Disposition for "${npcName}" not changed: cooldown (3 turns).`);
                delete rel.disposition;
                return;
            }
            // clamp per-update move (AI gives absolute target sometimes; treat as absolute but clamp delta)
            const npc = gameState.npcs?.[npcName];
            const current = typeof npc?.disposition === 'number' ? npc.disposition : 0;
            const target = clamp(Math.round(rel.disposition), -100, 100);
            const delta = clamp(target - current, -5, 5);
            rel.disposition = current + delta;
            gameState._npcDispositionLastChangeTurn[npcName] = turn;
        });
    }
}

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

    const gameState = {
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
        health: 35,
        maxHealth: 100,
        stamina: 30,
        maxStamina: 100,
        coins: 0,
        satiety: 20,  // 100 = сыт, 0 = голодает (теряет здоровье)
        energy: 55,   // 100 = бодр, < 35 = устал (теряет выносливость)
        reputation: 25,
        morality: 50, // Нейтральная мораль
        equipment: {
            weapon: { name: 'нет', condition: 0 },
            armor: { name: 'нет', condition: 0 }
        },
        worldMap: [], // Dynamic Map (normalized in ensureGameStateIntegrity)
        worldEdges: [], // Connections between locations (roads/paths)
        playerPos: { x: 0, y: 0, locationId: null }, // Explicit player position on map
        mapWaypoint: { locationId: null, name: '' }, // Optional marker for player
        inventory: [], // Полностью пустой инвентарь
        skills: {
            combat: { level: 0, xp: 0, maxLevel: 100, nextLevel: 100 },
            stealth: { level: 0, xp: 0, maxLevel: 100, nextLevel: 100 },
            speech: { level: 0, xp: 0, maxLevel: 100, nextLevel: 100 },
            survival: { level: 0, xp: 0, maxLevel: 100, nextLevel: 100 }
        },
        attributes: {
            strength: 3,      // Сила: Вес, тяжелое оружие, проламывание дверей. (1-10)
            agility: 3,       // Ловкость: Уклонение, скрытность, стрельба. (1-10)
            intelligence: 3,  // Интеллект: Обучение, магия, расследование. (1-10)
            charisma: 3       // Харизма: Убеждение, цены, лидерство. (1-10)
        },
        character: {
            background: `${name} - ${genderText}, очнувш${genderPronoun === 'он' ? 'ийся' : 'аяся'} в грязи на улице Ратая. ${genderPronoun === 'он' ? 'Его' : 'Её'} сбил всадник на коне - ${genderPronoun === 'он' ? 'он' : 'она'} валяется избитым, без одежды и вещей. ${genderPronoun === 'он' ? 'Он' : 'Она'} ничего не помнит о себе. Есть только смутные обрывки чего-то странного - но что это? Местные жители не знают, кто это. Нужно выживать в этом средневековом мире.`,
            traits: ['растерянный', 'стойкий', 'адаптивный', 'наблюдательный'],
            recentEvents: [], // Последние события
            importantChoices: [], // Важные выборы
            relationships: {},
            npcLocations: {}, // Map of "NPC Name" -> "Location Name"
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
        _lastRepIncreaseDay: null,
        npcs: {} // NPC registry: name -> {role,status,disposition,lastSeen,notes}
    };
    ensureGameStateIntegrity(gameState);
    return gameState;
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
                        content: 'Ты — мастер средневековой RPG (Kingdom Come: Deliverance). \n\n⚠️ ПРАВИЛО ОТВЕТА: СТРОГО JSON. НИКАКОГО ТЕКСТА ВНЕ СТРУКТУРЫ. \n\n🔴 СТРУКТУРА ПРАВИЛ (JSON-центричность):\n1. "description": Атмосферный текст (вы/вас), деление на абзацы через \\n\\n. Очищай от технических артефактов.\n2. "newEquipment": Если игрок надевает что-то (рубаху, штаны, броню) или берет оружие — ОБЯЗАТЕЛЬНО обнови это поле. { "weapon": { "name": "...", "condition": 100 }, "armor": { "name": "...", "condition": 100 } }. Если не менялось — не включай.\n3. "newItems" / "usedItems": Если предмет получен/потерян. Каждый предмет — отдельный объект в массиве. \n4. "stats": health/stamina/coins/reputation/morality/satiety/energy — это ДЕЛЬТЫ (+/-). satiety/energy убывают сами по времени, НЕ уменьшай их вручную за "ход", если не было прямого действия (удар, голод).\n\n📦 ЭКИПИРОВКА: Если игрок надевает одежду (даже лохмотья), это "armor". Если берет меч — это "weapon".\n\n🛡️ РЕАЛИЗМ: Грязная одежда дает штраф к харизме, но прикрывает наготу. Босой человек на камнях теряет выносливость.'
                    },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.6,
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
    ensureGameStateIntegrity(gameState);

    // Подготовка компактного контекста для JSON
    const context = {
        character: {
            name: gameState.name,
            gender: gameState.gender,
            background: gameState.character.background,
            traits: gameState.character.traits,
            stats: {
                health: `${gameState.health}/${gameState.maxHealth}`,
                stamina: `${gameState.stamina}/${gameState.maxStamina}`,
                coins: gameState.coins,
                reputation: gameState.reputation,
                morality: gameState.morality,
                satiety: gameState.satiety ?? 100,
                energy: gameState.energy ?? 100
            }
        },
        location: {
            current: gameState.location,
            position: gameState.playerPos,
            knownPlaces: (gameState.worldMap || []).map(l => ({ name: l.name, type: l.type }))
        },
        equipment: {
            weapon: gameState.equipment.weapon,
            armor: gameState.equipment.armor
        },
        inventory: gameState.inventory.map(i => ({ name: i.name, quantity: i.quantity, type: i.type })),
        skills: Object.entries(gameState.skills).map(([k, v]) => `${k}: lv.${v.level}`),
        activeQuests: (gameState.quests || []).filter(q => q.status === 'active').map(q => q.name),
        currentSituation: {
            previousScene: previousScene || 'Начало игры',
            playerAction: playerChoice,
            day: gameState.date.dayOfGame,
            time: `${gameState.date.hour}:00 (${gameState.date.timeOfDay})`
        }
    };

    return `Данные текущего состояния игры (JSON):
${JSON.stringify(context, null, 2)}

═══ ПРАВИЛА ИГРЫ (ОБЯЗАТЕЛЬНО) ═══
1. ОТВЕТ: Только JSON. Русский язык.
2. ОПИСАНИЕ: Строго 3 небольших абзаца. МАКСИМАЛЬНАЯ детальность (вы/вас). ЛИМИТ: 500 символов.
3. ПРЯМАЯ РЕЧЬ: Всегда выделяй кавычками «» или "". ПЕРЕД всей конструкцией прямой речи (включая имя говорящего и кавычки) ОБЯЗАТЕЛЬНО ставь маркер "dialogue-speech">. Это сделает всю фразу золотой.
   Пример: "dialogue-speech">«Помогите мне!» — взываете вы.
4. ЗАПРЕТ HTML: Не используй теги <p>, <span>. Используй только маркер "dialogue-speech"> для речи.
5. ЭКИПИРОВКА: Если игрок надевает предмет (даже "Лохмотья" или "Тряпье"), ОБЯЗАТЕЛЬНО обнови поле "newEquipment.armor". Если берет меч — "newEquipment.weapon".
6. ПРЕДМЕТЫ: Если персонаж получил предмет, добавь его в "newItems". Если использовал/потерял — в "usedItems".
7. СТАТЫ И АТРИБУТЫ: Возвращай только дельты (изменения). 0 — если нет причины менять.
   - СТАТЫ: health, stamina, satiety, energy, coins, reputation, morality.
   - АТРИБУТЫ: strength, agility, intelligence, charisma.
   - Используй атрибуты для поощрения усилий! Пример: если игрок долго бежал с грузом, можно дать strength: 1.
8. СМЕРТЬ: Если (здоровье + дельта health) <= 0 -> gameOver: true, deathReason: "причина".

═══ ВАЖНЫЕ УТОЧНЕНИЯ ВРЕМЕНИ И ПОГОДЫ ═══
- Текущее время: ${context.currentSituation.time}. ТВОЕ ОПИСАНИЕ ОБЯЗАНО СООТВЕТСТВОВАТЬ ЭТОМУ ВРЕМЕНИ. Если это "ночь" — должно быть темно. Если "утро" — рассвет.
- СТРОГО СЛЕДИ ЗА ЛОГИКОЙ: Нельзя сказать "солнце в зените", если сейчас ночь.

═══ СТИЛЬ ПОВЕСТВОВАНИЯ ═══
- ЖАНР: Dark Medieval RPG (Kingdom Come: Deliverance style).
- ТОН: Суровый, реалистичный, приземленный. Грязь, кровь, голод, холод. Никакой магии, никаких благородных эльфов. Только люди и суровая реальность.
- РОЛЬ (GM): Ты — безжалостный мастер подземелий. Ты не спасаешь игрока. Если он делает глупость — он страдает.
- ДЕТАЛИЗАЦИЯ: Описывай запахи (вонь, гарь), тактильные ощущения (холод камня, зуд), звуки. Это погружает.
- ИНТЕРАКТИВНОСТЬ: Мир должен реагировать. Если игрок голый — над ним смеются. Если он избит — он хромает.

⚠️ КРИТИЧЕСКИ ВАЖНО: Нейросеть часто забывает обновлять "newEquipment", когда игрок надевает одежду в описании. НЕ ЗАБЫВАЙ ЭТО. Если одежда на персонаже — она должна быть в слоте armor.
`;
}

function parseAIResponse(text) {
    try {
        // 1. Предварительная очистка (удаляем Markdown блоки)
        let cleaned = text
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .trim();

        // 2. Поиск JSON объекта
        const jsonMatch = cleaned.replace(/\r/g, '').match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('JSON object not found in response');
        }

        cleaned = jsonMatch[0]
            .replace(/\/\/.*$/gm, '') // Remove JS comments
            .replace(/,\s*}/g, '}')   // Remove trailing commas
            .replace(/,\s*]/g, ']')
            .replace(/\\"(\w+)\\"/g, '"$1"') // Fix: \"key\" -> "key"
            .replace(/:(\s*)\+(\d)/g, ':$1$2') // Fix: :+10 → :10
            .trim();

        console.log('🧹 Cleaned AI response (start):', cleaned.substring(0, 100) + '...');

        const parsed = JSON.parse(cleaned);

        console.log('🔍 RAW AI RESPONSE:', JSON.stringify(parsed, null, 2));

        // === STRICT SCHEMA NORMALIZATION (drop unknown keys, coerce types, defaults) ===
        const allowedKeys = new Set([
            // narrative / flow
            'description', 'choices', 'isDialogue', 'speakerName',
            'gameOver', 'deathReason',
            // deltas
            'health', 'stamina', 'coins', 'reputation', 'morality', 'timeChange', 'satiety', 'energy',
            // world
            'locationChange', 'newLocation', 'npcLocation',
            // progression
            'skillXP',
            // inventory/equipment
            'usedItems', 'newItems', 'equipment', 'newEquipment',
            // character/meta
            'characterUpdate', 'questsUpdate',
            // intention → outcome
            'effects',
            // deterministic checks (optional)
            'skillCheck',
            // npc systems (optional)
            'npcUpdates', 'debtsUpdate', 'factionUpdates'
        ]);

        // Remove unknown keys to prevent hallucinated state
        Object.keys(parsed).forEach(k => {
            if (!allowedKeys.has(k)) delete parsed[k];
        });

        // Defaults for mandatory-ish fields
        if (typeof parsed.description !== 'string' || !parsed.description.trim()) {
            parsed.description = 'Вы продолжаете свой путь...';
        }
        if (!Array.isArray(parsed.choices) || parsed.choices.length === 0) {
            parsed.choices = ['Продолжить', 'Осмотреться', 'Отдохнуть'];
        }
        if (typeof parsed.isDialogue !== 'boolean') parsed.isDialogue = false;
        if (typeof parsed.speakerName !== 'string') parsed.speakerName = '';
        if (typeof parsed.gameOver !== 'boolean') parsed.gameOver = false;
        if (typeof parsed.deathReason !== 'string') parsed.deathReason = '';

        // Логируем длину описания
        if (parsed.description) {
            const words = parsed.description.split(/\s+/);
            console.log(`📝 Получено описание: ${words.length} слов`);
        }

        // КРИТИЧЕСКИ ВАЖНО: Проверка и инициализация инвентарных полей
        if (!Array.isArray(parsed.usedItems)) {
            console.warn('⚠️ AI НЕ ПРИСЛАЛ usedItems! Инициализирую пустым массивом.');
            parsed.usedItems = [];
        } else {
            console.log(`✅ AI прислал usedItems: `, parsed.usedItems);
        }

        if (!Array.isArray(parsed.newItems)) {
            console.warn('⚠️ AI НЕ ПРИСЛАЛ newItems! Инициализирую пустым массивом.');
            parsed.newItems = [];
        } else {
            console.log(`✅ AI прислал newItems: `, parsed.newItems);
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

        // === STRICT NUMERIC VALIDATION ===
        // Ensure all numeric fields are actually numbers, default to 0 if not
        const numericFields = [
            'health', 'stamina', 'coins', 'reputation', 'morality', 'timeChange', 'satiety', 'energy',
            'strength', 'agility', 'intelligence', 'charisma'
        ];
        numericFields.forEach(field => {
            if (typeof parsed[field] !== 'number' || isNaN(parsed[field])) {
                if (parsed[field] !== undefined) {
                    // console.warn(`⚠️ Field '${field}' is not a number: `, parsed[field], '→ Setting to 0');
                }
                parsed[field] = 0;
            }
        });

        console.log('🔍 [DEBUG] Parsed Stats:', {
            health: parsed.health,
            stamina: parsed.stamina,
            satiety: parsed.satiety,
            energy: parsed.energy,
            strength: parsed.strength
        });

        // Clamp extreme values to prevent abuse
        if (parsed.coins > 100) {
            console.warn(`⚠️ Suspicious coins value: ${parsed.coins} → Clamping to 100`);
            parsed.coins = 100;
        }
        if (parsed.coins < -100) parsed.coins = -100;
        if (parsed.health > 50) parsed.health = 50;
        if (parsed.health < -50) parsed.health = -50;
        if (parsed.reputation > 10) parsed.reputation = 10;
        if (parsed.reputation < -10) parsed.reputation = -10;

        // Clamp Survival Stats (deltas should be reasonable)
        if (parsed.satiety > 50) parsed.satiety = 50;
        if (parsed.satiety < -100) parsed.satiety = -100;
        if (parsed.energy > 50) parsed.energy = 50;
        if (parsed.energy < -100) parsed.energy = -100;

        // Validate skillXP
        if (!parsed.skillXP || typeof parsed.skillXP !== 'object') {
            parsed.skillXP = {};
        }

        // Validate effects (intention → outcome)
        if (!Array.isArray(parsed.effects)) {
            parsed.effects = [];
        } else {
            const allowedStats = new Set([
                'health', 'stamina', 'coins', 'reputation', 'morality', 'satiety', 'energy', 'timeChange',
                'strength', 'agility', 'intelligence', 'charisma'
            ]);
            parsed.effects = parsed.effects
                .filter(e => e && typeof e === 'object')
                .map(e => ({
                    stat: typeof e.stat === 'string' ? e.stat : '',
                    delta: typeof e.delta === 'number' && !Number.isNaN(e.delta) ? e.delta : 0,
                    reason: typeof e.reason === 'string' ? e.reason : ''
                }))
                .filter(e => allowedStats.has(e.stat) && e.delta !== 0)
                .slice(0, 20);
        }

        // Validate skillCheck (deterministic checks)
        if (parsed.skillCheck && typeof parsed.skillCheck === 'object') {
            const sc = parsed.skillCheck;
            parsed.skillCheck = {
                kind: typeof sc.kind === 'string' ? sc.kind : 'skill', // 'skill' | 'attribute'
                key: typeof sc.key === 'string' ? sc.key : '', // 'speech' or 'charisma', etc.
                difficulty: typeof sc.difficulty === 'number' && !Number.isNaN(sc.difficulty) ? sc.difficulty : 50,
                // Branch outcomes (optional but recommended)
                onSuccess: sc.onSuccess && typeof sc.onSuccess === 'object' ? sc.onSuccess : null,
                onFail: sc.onFail && typeof sc.onFail === 'object' ? sc.onFail : null
            };
        } else {
            parsed.skillCheck = null;
        }

        // Fallback: auto-generate effects from deltas if AI didn't provide them
        if (parsed.effects.length === 0) {
            const auto = [];
            const add = (stat, delta, reason) => {
                if (delta && typeof delta === 'number' && !Number.isNaN(delta) && delta !== 0) {
                    auto.push({ stat, delta, reason });
                }
            };
            add('health', parsed.health, parsed.health < 0 ? 'Получен урон' : 'Восстановление');
            add('stamina', parsed.stamina, parsed.stamina < 0 ? 'Усталость/усилие' : 'Отдых/восстановление');
            add('coins', parsed.coins, parsed.coins < 0 ? 'Расход' : 'Доход');
            add('reputation', parsed.reputation, 'Репутация изменилась');
            add('morality', parsed.morality, 'Мораль изменилась');
            add('satiety', parsed.satiety, parsed.satiety < 0 ? 'Голодание' : 'Еда/напиток');
            add('energy', parsed.energy, parsed.energy < 0 ? 'Усталость' : 'Сон/отдых');
            add('timeChange', parsed.timeChange, 'Прошло времени');
            parsed.effects = auto.filter(e => e.delta !== 0);
        }

        // Validate characterUpdate
        // Validate characterUpdate
        if (!parsed.characterUpdate || typeof parsed.characterUpdate !== 'object') {
            parsed.characterUpdate = { recentEvents: [], importantChoices: [], relationships: {}, milestone: '' };
        }

        return parsed;
    } catch (error) {
        console.error('❌ Parse error! Raw text:', text);
        error.message = `Failed to parse AI response: ${error.message} `;
        throw error;
    }
}

async function requestAIResponse(gameState, choice, previousScene, attempt = 0, sessionId = 'unknown') {
    const maxAttempts = 2;
    const basePrompt = buildPrompt(gameState, choice, previousScene);
    const prompt = attempt === 0
        ? basePrompt
        : `${basePrompt} \n\n⚠️ ТЫ ПРИСЛАЛ НЕВЕРНЫЙ ФОРМАТ! ПОВТОРИ ТОТ ЖЕ ОТВЕТ СТРОГО В ВАЛИДНОМ JSON БЕЗ ТЕКСТА ВНЕ { }.`;

    const aiResponse = await generateWithAI(prompt);
    console.log(`🧠 RAW AI RESPONSE(attempt ${attempt + 1}): `, aiResponse);
    try {
        return parseAIResponse(aiResponse);
    } catch (error) {
        await logAIParseFailure(sessionId, choice, attempt, aiResponse, error.message);
        if (attempt + 1 < maxAttempts) {
            console.warn(`⚠️ AI response parse failed(attempt ${attempt + 1}).Retrying...`);
            return requestAIResponse(gameState, choice, previousScene, attempt + 1, sessionId);
        }
        // Fallback вместо ошибки — чтобы игра не ломалась
        console.error('❌ Все попытки парсинга провалились. Возвращаем fallback.');
        return {
            description: 'Мир замер на мгновение... Попробуйте повторить действие.',
            choices: ['Попробовать снова', 'Осмотреться', 'Подождать'],
            health: 0, stamina: 0, coins: 0, reputation: 0, morality: 0,
            timeChange: 0, locationChange: '', isDialogue: false, speakerName: '',
            skillXP: {}, usedItems: [], newItems: [],
            characterUpdate: { recentEvents: [], importantChoices: [], relationships: {}, milestone: '' }
        };
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

    console.log(`⏰ Время обновлено: ${gameState.date.hour}:00(${gameState.date.timeOfDay}), +${hoursToAdd} часов`);
}

function applyChanges(gameState, parsed) {
    ensureGameStateIntegrity(gameState);
    // Обновляем время
    if (parsed.timeChange !== undefined && parsed.timeChange !== null) {
        updateTime(gameState, parsed.timeChange);
    }

    // Обновляем локацию
    if (parsed.locationChange && parsed.locationChange.trim()) {
        const oldLocation = gameState.location;
        gameState.location = parsed.locationChange;
        console.log(`📍 Локация изменена: ${oldLocation} → ${gameState.location} `);

        // Move player marker to known map location if possible
        const loc = findLocationByName(gameState, gameState.location);
        if (loc) {
            gameState.playerPos.x = loc.x;
            gameState.playerPos.y = loc.y;
            gameState.playerPos.locationId = loc.id;
            loc.visitedCount = (loc.visitedCount || 0) + 1;
        } else {
            // Create placeholder at current coords (keeps map stable instead of "jumping" by string heuristics)
            const id = stableIdFromName(gameState.location);
            const exists = gameState.worldMap.find(l => l.id === id);
            if (!exists) {
                gameState.worldMap.push({
                    id,
                    name: gameState.location,
                    x: gameState.playerPos.x,
                    y: gameState.playerPos.y,
                    description: 'Место отмечено по названию (без координат от AI)',
                    type: 'area',
                    discovered: true,
                    discoveredAtDay: gameState.date?.dayOfGame ?? 1,
                    visitedCount: 1
                });
            }
            gameState.playerPos.locationId = id;
        }
    }

    // Применяем изменения характеристик
    if (parsed.health) {
        const old = gameState.health;
        gameState.health = Math.max(0, Math.min(gameState.maxHealth, gameState.health + parsed.health));
        console.log(`❤️ Health update: ${old} -> ${gameState.health} (delta: ${parsed.health})`);
    }
    if (parsed.stamina) {
        const old = gameState.stamina;
        gameState.stamina = Math.max(0, Math.min(gameState.maxStamina, gameState.stamina + parsed.stamina));
        console.log(`💪 Stamina update: ${old} -> ${gameState.stamina} (delta: ${parsed.stamina})`);
    }
    // Характеристики (Attributes)
    if (parsed.strength) gameState.attributes.strength = clamp(gameState.attributes.strength + parsed.strength, 1, 20);
    if (parsed.agility) gameState.attributes.agility = clamp(gameState.attributes.agility + parsed.agility, 1, 20);
    if (parsed.intelligence) gameState.attributes.intelligence = clamp(gameState.attributes.intelligence + parsed.intelligence, 1, 20);
    if (parsed.charisma) gameState.attributes.charisma = clamp(gameState.attributes.charisma + parsed.charisma, 1, 20);

    // Монеты: Grok возвращает ИЗМЕНЕНИЕ (дельту), игра сама прибавляет/убирает
    if (parsed.coins !== undefined && parsed.coins !== null) {
        const oldCoins = gameState.coins;
        const change = parsed.coins; // Это изменение (дельта): +10, -5, 0
        gameState.coins = Math.max(0, gameState.coins + change); // Прибавляем/убираем изменение
        if (change !== 0) {
            console.log(`💰 Монеты изменены: ${oldCoins} ${change >= 0 ? '+' : ''}${change} = ${gameState.coins} `);
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
                console.log(`ℹ️ Репутация не увеличена: уже росла сегодня(день ${currentDay}).`);
                delta = 0;
            } else {
                if (gameState.reputation >= 70 && delta > 1) {
                    console.log(`⚠️ Репутация ≥70: ограничиваю прирост + 1 вместо + ${delta}.`);
                    delta = 1;
                } else if (gameState.reputation >= 60 && delta > 1) {
                    console.log(`⚠️ Репутация ≥60: ограничиваю прирост до + 1 вместо + ${delta}.`);
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
            console.log(`📣 Репутация изменена: ${oldReputation} ${delta >= 0 ? '+' : ''}${delta} = ${gameState.reputation} `);
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
                console.log(`📈 Навык ${skill}: получено ${xp} опыта(было: ${oldXP}, стало: ${gameState.skills[skill].xp})`);

                while (gameState.skills[skill].xp >= gameState.skills[skill].nextLevel) {
                    gameState.skills[skill].level++;
                    gameState.skills[skill].xp -= gameState.skills[skill].nextLevel;
                    gameState.skills[skill].nextLevel = Math.floor(gameState.skills[skill].nextLevel * 1.5);
                    console.log(`🎉 Навык ${skill} повысился! Уровень: ${oldLevel} → ${gameState.skills[skill].level} `);
                }
            }
        });
    }

    // Обновляем экипировку (КРИТИЧЕСКИ ВАЖНО!)
    if (parsed.equipment) {
        // === WEAPON SWAP ===
        if (parsed.equipment.weapon && parsed.equipment.weapon.name) {
            const newWeaponName = parsed.equipment.weapon.name;
            const oldWeaponName = gameState.equipment.weapon.name;

            if (newWeaponName !== oldWeaponName) {
                console.log(`⚔️ Смена оружия: "${oldWeaponName}" → "${newWeaponName}"`);

                // 1. Попытка найти новый предмет в инвентаре и забрать его
                const invIdx = gameState.inventory.findIndex(i => i.name.toLowerCase() === newWeaponName.toLowerCase());
                if (invIdx >= 0) {
                    gameState.inventory[invIdx].quantity--;
                    if (gameState.inventory[invIdx].quantity <= 0) {
                        gameState.inventory.splice(invIdx, 1);
                    }
                }

                // 2. Вернуть старое оружие в инвентарь (если это не "нет" и не "кулаки")
                if (oldWeaponName && oldWeaponName !== 'нет' && oldWeaponName !== 'кулаки') {
                    const existingOld = gameState.inventory.find(i => i.name.toLowerCase() === oldWeaponName.toLowerCase());
                    if (existingOld) {
                        existingOld.quantity++;
                    } else {
                        gameState.inventory.push({ name: oldWeaponName, quantity: 1, type: 'weapon' });
                    }
                }

                // 3. Надеть новое
                gameState.equipment.weapon = {
                    name: newWeaponName,
                    condition: parsed.equipment.weapon.condition || 100
                };
            }
        }

        // === ARMOR SWAP ===
        if (parsed.equipment.armor && parsed.equipment.armor.name) {
            const newArmorName = parsed.equipment.armor.name;
            const oldArmorName = gameState.equipment.armor.name;

            if (newArmorName !== oldArmorName) {
                console.log(`🛡️ Смена брони: "${oldArmorName}" → "${newArmorName}"`);

                // 1. Попытка найти новый предмет в инвентаре и забрать его
                const invIdx = gameState.inventory.findIndex(i => i.name.toLowerCase() === newArmorName.toLowerCase());
                if (invIdx >= 0) {
                    gameState.inventory[invIdx].quantity--;
                    if (gameState.inventory[invIdx].quantity <= 0) {
                        gameState.inventory.splice(invIdx, 1);
                    }
                }

                // 2. Вернуть старую броню в инвентарь (если это не "нет", "тряпье" или "голое тело")
                // Примечание: "тряпье" можно считать одеждой, если AI решит снять его ради лат.
                if (oldArmorName && oldArmorName !== 'нет' && oldArmorName !== 'голое тело') {
                    const existingOld = gameState.inventory.find(i => i.name.toLowerCase() === oldArmorName.toLowerCase());
                    if (existingOld) {
                        existingOld.quantity++;
                    } else {
                        gameState.inventory.push({ name: oldArmorName, quantity: 1, type: 'armor' });
                    }
                }

                // 3. Надеть новое
                gameState.equipment.armor = {
                    name: newArmorName,
                    condition: parsed.equipment.armor.condition || 100
                };
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
            Object.entries(parsed.characterUpdate.relationships).forEach(([name, rel]) => {
                const npcName = String(name || '').trim();
                if (!npcName) return;

                // Store as-is (string or object) — client can render both
                gameState.character.relationships[npcName] = rel;

                // Normalize into NPC registry
                if (!gameState.npcs) gameState.npcs = {};
                const npc = gameState.npcs[npcName] || { name: npcName, disposition: 0 };
                npc.name = npcName;

                if (typeof rel === 'string') {
                    npc.notes = rel;
                } else if (rel && typeof rel === 'object') {
                    if (rel.role && typeof rel.role === 'string') npc.role = rel.role;
                    if (rel.status && typeof rel.status === 'string') npc.status = rel.status;
                    if (rel.notes && typeof rel.notes === 'string') npc.notes = rel.notes;
                    if (rel.faction && typeof rel.faction === 'string') npc.faction = rel.faction;
                    if (typeof rel.disposition === 'number' && !Number.isNaN(rel.disposition)) {
                        npc.disposition = clamp(Math.round(rel.disposition), -100, 100);
                    }
                    if (Array.isArray(rel.memory)) {
                        const mem = rel.memory
                            .filter(x => typeof x === 'string' && x.trim().length > 0)
                            .map(x => x.trim())
                            .slice(-5);
                        if (mem.length) npc.memory = mem;
                    } else if (Array.isArray(rel.memoryAdd)) {
                        const add = rel.memoryAdd
                            .filter(x => typeof x === 'string' && x.trim().length > 0)
                            .map(x => x.trim());
                        if (add.length) {
                            const existing = Array.isArray(npc.memory) ? npc.memory : [];
                            const merged = [...existing, ...add].slice(-5);
                            npc.memory = merged;
                        }
                    }
                }

                // Ensure lastSeen if we have npcLocations
                const locName = gameState.character.npcLocations?.[npcName];
                if (locName) {
                    const locObj = findLocationByName(gameState, locName);
                    npc.lastSeen = {
                        dayOfGame: gameState.date?.dayOfGame ?? null,
                        locationId: locObj ? locObj.id : null,
                        locationName: locName
                    };
                }
                gameState.npcs[npcName] = npc;
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

    // Обновляем квесты
    if (parsed.questsUpdate) {
        if (!gameState.quests) gameState.quests = [];
        parsed.questsUpdate.forEach(q => {
            const existing = gameState.quests.find(existingQ => existingQ.name === q.name);
            if (existing) {
                existing.status = q.status;
                existing.description = q.description;
                console.log(`📜 Квест обновлён: "${q.name}"(${q.status})`);
            } else {
                gameState.quests.push(q);
                console.log(`✨ Новый квест: "${q.name}"`);
            }
        });
    }

    // Обновляем Карту (Fog of War)
    if (parsed.newLocation && parsed.newLocation.name) {
        if (!gameState.worldMap) gameState.worldMap = [];
        const newLocId = parsed.newLocation.id || stableIdFromName(parsed.newLocation.name);
        const exists = gameState.worldMap.find(loc => loc.id === newLocId || loc.name === parsed.newLocation.name);
        if (!exists) {
            const fromId = gameState.playerPos?.locationId || (findLocationByName(gameState, gameState.location)?.id ?? null);
            gameState.worldMap.push({
                id: newLocId,
                name: parsed.newLocation.name,
                x: parsed.newLocation.x || 0,
                y: parsed.newLocation.y || 0,
                description: parsed.newLocation.description,
                type: parsed.newLocation.type || 'place',
                discovered: true,
                discoveredAtDay: gameState.date?.dayOfGame ?? 1,
                visitedCount: 0
            });
            console.log(`🗺️ Новая локация открыта: "${parsed.newLocation.name}"`);

            // Auto-connect new location to current one
            if (fromId && fromId !== newLocId) {
                if (!Array.isArray(gameState.worldEdges)) gameState.worldEdges = [];
                const already = gameState.worldEdges.find(e =>
                    (e.fromId === fromId && e.toId === newLocId) || (e.fromId === newLocId && e.toId === fromId)
                );
                if (!already) {
                    gameState.worldEdges.push({
                        fromId,
                        toId: newLocId,
                        kind: 'path',
                        discoveredAtDay: gameState.date?.dayOfGame ?? 1
                    });
                }
            }
        }
    }

    // Обновляем Локации NPC
    if (parsed.npcLocation && parsed.npcLocation.name && parsed.npcLocation.location) {
        if (!gameState.character.npcLocations) gameState.character.npcLocations = {};

        gameState.character.npcLocations[parsed.npcLocation.name] = parsed.npcLocation.location;
        console.log(`👤 NPC ${parsed.npcLocation.name} замечен в локации "${parsed.npcLocation.location}"`);

        // Update NPC registry for map/relations UI
        if (!gameState.npcs) gameState.npcs = {};
        const npcName = String(parsed.npcLocation.name).trim();
        if (npcName) {
            const locObj = findLocationByName(gameState, parsed.npcLocation.location);
            const npc = gameState.npcs[npcName] || { name: npcName, disposition: 0 };
            npc.name = npcName;
            npc.lastSeen = {
                dayOfGame: gameState.date?.dayOfGame ?? null,
                locationId: locObj ? locObj.id : null,
                locationName: parsed.npcLocation.location
            };
            gameState.npcs[npcName] = npc;
        }
    }

    // Обновляем инвентарь (Использованные предметы)
    if (Array.isArray(parsed.usedItems) && parsed.usedItems.length > 0) {
        console.log(`📦 AI указал использованные предметы: `, parsed.usedItems);
        parsed.usedItems.forEach(itemName => {
            const index = gameState.inventory.findIndex(i => i.name === itemName);
            if (index !== -1) {
                gameState.inventory[index].quantity--;
                if (gameState.inventory[index].quantity <= 0) {
                    gameState.inventory.splice(index, 1);
                }
                console.log(`  ➖ Использовано: ${itemName} `);
            }
        });
    } else {
        console.log(`📦 usedItems пустой`);
    }

    if (Array.isArray(parsed.newItems) && parsed.newItems.length > 0) {
        console.log(`📦 AI добавил новые предметы: `, parsed.newItems);
        parsed.newItems.forEach(item => {
            const normalizedName = item.name.trim();

            // Skip combined items (e.g. "Штаны и рубаха") - AI should add them separately
            if (normalizedName.includes(' и ') || normalizedName.includes(' & ')) {
                console.warn(`⚠️ Пропущен комбинированный предмет: "${normalizedName}" - добавляйте предметы отдельно!`);
                return;
            }

            // Skip if name is too short or empty
            if (normalizedName.length < 2) {
                console.warn(`⚠️ Пропущен предмет с коротким именем: "${normalizedName}"`);
                return;
            }

            const existing = gameState.inventory.find(i =>
                i.name.toLowerCase() === normalizedName.toLowerCase() // Case-insensitive match
            );

            if (existing) {
                existing.quantity += item.quantity || 1;
                console.log(`  ➕ Добавлено: ${item.name} x${item.quantity || 1} (всего: ${existing.quantity})`);
            } else {
                gameState.inventory.push({
                    ...item,
                    name: normalizedName, // Use normalized name
                    quantity: item.quantity || 1
                });
                console.log(`  ✨ Новый предмет: ${normalizedName} x${item.quantity || 1} `);
            }
        });
    }

    // Обновляем Экипировку
    if (parsed.newEquipment) {
        if (parsed.newEquipment.weapon) {
            console.log(`⚔️ Смена оружия: ${gameState.equipment.weapon.name} -> ${parsed.newEquipment.weapon.name} `);

            // Если у нас было старое оружие (не "нет"), вернем его в инвентарь
            if (gameState.equipment.weapon.name && gameState.equipment.weapon.name !== 'нет' && gameState.equipment.weapon.name !== 'кулаки') {
                const oldName = gameState.equipment.weapon.name;
                const existing = gameState.inventory.find(i => i.name.toLowerCase() === oldName.toLowerCase());
                if (existing) {
                    existing.quantity++;
                } else {
                    gameState.inventory.push({
                        name: oldName,
                        type: 'weapon',
                        description: 'Бывшее в употреблении оружие',
                        quantity: 1
                    });
                }
                console.log(`  ↩️ Старое оружие возвращено в инвентарь: ${oldName}`);
            }

            gameState.equipment.weapon = parsed.newEquipment.weapon;
        }

        if (parsed.newEquipment.armor) {
            console.log(`🛡️ Смена брони: ${gameState.equipment.armor.name} -> ${parsed.newEquipment.armor.name} `);

            // Если у нас была старая броня, вернем её в инвентарь
            if (gameState.equipment.armor.name && gameState.equipment.armor.name !== 'нет' && gameState.equipment.armor.name !== 'тряпье') {
                const oldName = gameState.equipment.armor.name;
                const existing = gameState.inventory.find(i => i.name.toLowerCase() === oldName.toLowerCase());
                if (existing) {
                    existing.quantity++;
                } else {
                    gameState.inventory.push({
                        name: oldName,
                        type: 'armor',
                        description: 'Поношенная одежда',
                        quantity: 1
                    });
                }
                console.log(`  ↩️ Старая броня возвращена в инвентарь: ${oldName}`);
            }

            gameState.equipment.armor = parsed.newEquipment.armor;
        }
    }

    // === SURVIVAL MECHANICS ===
    // 1. Time Decay (Natural loss over time)
    if (parsed.timeChange && parsed.timeChange > 0) {
        // Use precise values, then floor for display if needed, but keep state as number
        // Lose 4 satiety/hour, 3 energy/hour
        const satietyLoss = parsed.timeChange * 4;
        gameState.satiety = Math.max(0, (gameState.satiety || 100) - satietyLoss);

        const energyLoss = parsed.timeChange * 3;
        gameState.energy = Math.max(0, (gameState.energy || 100) - energyLoss);

        console.log(`📉 Survival Decay(-${parsed.timeChange}h): Satiety -${satietyLoss.toFixed(1)}, Energy -${energyLoss.toFixed(1)}`);
    }

    // 2. Apply Penalties
    if (gameState.satiety <= 0) {
        gameState.health = Math.max(0, gameState.health - 5);
        console.warn('⚠️ STARVATION DAMAGE: Health -5');
        // If hunger killed the player, set gameOver
        if (gameState.health <= 0) {
            parsed.gameOver = true;
            parsed.deathReason = parsed.deathReason || 'Смерть от голода';
        }
    }

    if (gameState.energy < 35) {
        gameState.stamina = Math.min(gameState.stamina, 50);
        console.warn('⚠️ EXHAUSTION PENALTY: Stamina capped at 50');
    }

    // 3. Logic Hardening (Prevent AI Hallucinations)
    // Guard: Cannot gain Satiety (>0) without using items (eating)
    // Relaxed: Allow minor satiety increase or if AI gives a strong reason. Mostly prevent massive (+20) phantom gains.
    if (parsed.satiety > 5) {
        if (!parsed.usedItems || parsed.usedItems.length === 0) {
            console.warn(`🚫 Prevented phantom Satiety increase(+${parsed.satiety}) - No items used!`);
            parsed.satiety = 0;
        }
    }

    // Guard: Energy can decrease naturally or from effort. Increase only from sleep/rest.
    if (parsed.energy > 5) {
        if (!parsed.timeChange || parsed.timeChange < 1) {
            // If energy increases more than 5, we usually expect time to pass (rest)
            console.warn(`🚫 Prevented phantom Energy increase(+${parsed.energy}) - No time passed!`);
            parsed.energy = 0;
        }
    }

    // Recover stats from AI response (Eating/Sleeping)
    if (parsed.satiety) {
        console.log(`🔍[DEBUG] Satiety Update: Old = ${gameState.satiety}, AI_Proposed = ${parsed.satiety}, New = ${Math.min(100, (gameState.satiety || 0) + parsed.satiety)} `);
        gameState.satiety = Math.min(100, (gameState.satiety || 0) + parsed.satiety);
    }
    if (parsed.energy) {
        console.log(`🔍[DEBUG] Energy Update: Old = ${gameState.energy}, AI_Proposed = ${parsed.energy}, New = ${Math.min(100, (gameState.energy || 0) + parsed.energy)} `);
        gameState.energy = Math.min(100, (gameState.energy || 0) + parsed.energy);
    }

    // === FACTIONS ===
    if (Array.isArray(parsed.factionUpdates)) {
        if (!gameState.factions) gameState.factions = {};
        parsed.factionUpdates.forEach(f => {
            if (!f || typeof f !== 'object') return;
            const name = typeof f.name === 'string' ? f.name.trim() : '';
            if (!name) return;
            const existing = gameState.factions[name] || { name, disposition: 0, notes: '' };
            const delta = typeof f.dispositionDelta === 'number' && !Number.isNaN(f.dispositionDelta) ? f.dispositionDelta : 0;
            const abs = typeof f.disposition === 'number' && !Number.isNaN(f.disposition) ? f.disposition : null;
            if (abs !== null) existing.disposition = clamp(Math.round(abs), -100, 100);
            else if (delta) existing.disposition = clamp(existing.disposition + clamp(Math.round(delta), -5, 5), -100, 100);
            if (typeof f.notes === 'string' && f.notes.trim()) existing.notes = f.notes.trim();
            gameState.factions[name] = existing;
        });
    }

    // === DEBTS / PROMISES ===
    if (Array.isArray(parsed.debtsUpdate)) {
        if (!Array.isArray(gameState.debts)) gameState.debts = [];
        parsed.debtsUpdate.forEach(d => {
            if (!d || typeof d !== 'object') return;
            const from = typeof d.from === 'string' ? d.from.trim() : '';
            const to = typeof d.to === 'string' ? d.to.trim() : '';
            if (!from || !to) return;
            const amount = typeof d.amount === 'number' && !Number.isNaN(d.amount) ? clamp(Math.round(d.amount), 1, 5000) : 0;
            const reason = typeof d.reason === 'string' ? d.reason.trim() : '';
            const status = typeof d.status === 'string' ? d.status.trim() : 'active';
            const dueDay = typeof d.dueDay === 'number' && !Number.isNaN(d.dueDay) ? Math.max(0, Math.round(d.dueDay)) : null;

            // Upsert by (from,to,reason,status-active)
            const idx = gameState.debts.findIndex(x =>
                x && x.from === from && x.to === to && (x.reason || '') === reason && x.status !== 'closed'
            );
            const entry = {
                from,
                to,
                amount,
                reason,
                status,
                dueDay,
                createdDay: gameState.date?.dayOfGame ?? null
            };
            if (idx >= 0) gameState.debts[idx] = { ...gameState.debts[idx], ...entry };
            else gameState.debts.push(entry);
        });

        // Keep debts list bounded
        if (gameState.debts.length > 50) gameState.debts = gameState.debts.slice(-50);
    }
}

// Helper to format description on server side
function formatDescription(text) {
    if (!text) return '';
    let processed = text;
    // 1. Decode entities
    processed = processed
        .replace(/&quot;/g, '"')
        .replace(/&laquo;/g, '«')
        .replace(/&raquo;/g, '»')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&nbsp;/g, ' ');

    // 2. Format Dialogue (Simpler Loop)
    // Keep replacing until no matches found (to handle multiple dialogues)
    const regex = /["'„“]?dialogue-speech["'”]?\s*>\s*([«"“][^]+?[»"”])/i;
    let match;
    let loopCount = 0;
    while ((match = regex.exec(processed)) !== null && loopCount < 10) {
        processed = processed.replace(match[0], `<span class="dialogue-speech"><i>${match[1]}</i></span>`);
        loopCount++;
    }

    // 3. Cleanup loose markers
    processed = processed.replace(/["'„“]?dialogue-speech["'”]?\s*>/gi, '');

    return processed;
}

wss.on('connection', (ws) => {
    const sessionId = Math.random().toString(36).substr(2, 9);
    console.log(`✅ Client connected, SessionID: ${sessionId} `);

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
                console.log(`🎮 Новая игра создана для ${gameState.name} (${gameState.gender}), SessionID: ${sessionId} `);
                console.log(`📊 Активных сессий: ${gameSessions.size} `);

                // Генерируем описание с учетом пола
                const genderDesc = gameState.gender === 'female' ?
                    'Резкая боль пронзает всё тело. Вы медленно открываете глаза - перед вами грязная мостовая, лужи, конский навоз. Голова раскалывается. Вы лежите прямо на улице средневекового города, полностью голая и избитая. Тело покрыто ссадинами и грязью.' :
                    'Резкая боль пронзает всё тело. Вы медленно открываете глаза - перед вами грязная мостовая, лужи, конский навоз. Голова раскалывается. Вы лежите прямо на улице средневекового города, полностью голый и избитый. Тело покрыто ссадинами и грязью.';

                const introText = `${genderDesc} Пытаясь сфокусировать взгляд, вы видите деревянные дома с соломенными крышами, повозки, толпу людей в грубой средневековой одежде. Они останавливаются, показывают на вас пальцем. <span class="dialogue-speech"><i>«Смотрите, еще один бродяга!»</i></span>`;

                ws.send(JSON.stringify({
                    type: 'scene',
                    sessionId,
                    gameState,
                    description: introText, // Прямая отправка (HTML уже внутри)
                    choices: [
                        'Попытаться прикрыться руками и попросить помощи у прохожих',
                        'Быстро подняться и забежать в ближайший переулок',
                        'Осмотреться - может, рядом есть тряпки или выброшенная одежда'
                    ]
                }));

            } else if (data.type === 'load') {
                // Загрузка сохраненного состояния
                console.log(`📂 Получен запрос на загрузку сохранения, SessionID: ${sessionId} `);

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

                // 🩹 PATCH: Fix old saves missing new stats
                if (loadedGameState.satiety === undefined) {
                    console.warn('⚠️ Save file missing satiety, defaulting to 20');
                    loadedGameState.satiety = 20;
                }
                if (loadedGameState.energy === undefined) {
                    console.warn('⚠️ Save file missing energy, defaulting to 55');
                    loadedGameState.energy = 55;
                }

                // 🧭 PATCH: Fix old saves missing map/NPC systems
                ensureGameStateIntegrity(loadedGameState);

                gameSessions.set(sessionId, loadedGameState);

                if (!loadedGameState.name) {
                    console.error('❌ В gameState отсутствует поле name!');
                    console.error('Структура gameState:', Object.keys(loadedGameState));
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'В сохранении отсутствует имя персонажа!'
                    }));
                    return;
                }

                console.log(`✅ Загружается сохранение для персонажа: ${loadedGameState.name} `);

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

                console.log(`📂 Загружено сохранение для ${loadedGameState.name}, SessionID: ${sessionId} `);
                console.log(`📊 Активных сессий: ${gameSessions.size} `);
                console.log(`🔍 Сохранено в gameSessions.get(${sessionId}): ${gameSessions.has(sessionId) ? 'ДА ✅' : 'НЕТ ❌'} `);
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
                console.log(`🎯 Получен выбор игрока, SessionID: ${sessionId} `);
                console.log(`📊 Активных сессий: ${gameSessions.size}, Список: [${Array.from(gameSessions.keys()).join(', ')}]`);
                console.log(`🔍 ws.sessionId: ${ws.sessionId} `);
                console.log(`🔍 Проверка наличия сессии: ${gameSessions.has(sessionId) ? 'НАЙДЕНА ✅' : 'НЕ НАЙДЕНА ❌'} `);

                const gameState = gameSessions.get(sessionId);
                if (!gameState) {
                    console.error(`❌ Сессия не найдена! SessionID: ${sessionId} `);
                    console.error(`❌ ws.sessionId: ${ws.sessionId} `);
                    console.error(`❌ Доступные сессии: ${Array.from(gameSessions.keys()).join(', ')} `);
                    ws.send(JSON.stringify({ type: 'error', message: `Session not found.SessionID: ${sessionId} ` }));
                    return;
                }

                console.log(`✅ Сессия найдена для ${gameState.name} `);

                ws.send(JSON.stringify({ type: 'generating' }));

                let parsed;
                try {
                    parsed = await requestAIResponse(gameState, data.choice, data.previousScene, 0, sessionId);
                } catch (error) {
                    console.error('❌ Не удалось получить корректный ответ от AI:', error.message);
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: `AI_FORMAT_ERROR: ${error.message} `
                    }));
                    return;
                }

                // Apply world rules before any state application (cooldowns, economy, etc.)
                applyWorldRules(gameState, parsed);

                // 🔥 Hard rule: if AI reduced health to <=0, character dies even if AI forgot gameOver
                const projectedHealth = Math.max(0, Math.min(gameState.maxHealth, gameState.health + (parsed.health || 0)));
                if (projectedHealth <= 0) {
                    if (!parsed.gameOver) {
                        console.warn('⚠️ AI killed the player (health<=0) but did not set gameOver. Forcing gameOver.');
                    }
                    parsed.gameOver = true;
                    if (!parsed.deathReason || typeof parsed.deathReason !== 'string') {
                        parsed.deathReason = 'Смерть от ран';
                    }
                    if (!parsed.description || typeof parsed.description !== 'string' || !parsed.description.trim()) {
                        parsed.description = 'Ваши силы иссякли. Мир темнеет перед глазами.\n\nВы падаете на землю и больше не поднимаетесь.';
                    }
                }

                applyChanges(gameState, parsed);

                // 🎲 Deterministic skill/attribute check (AI proposes, server decides)
                let resolvedCheck = null;
                if (parsed.skillCheck && typeof parsed.skillCheck === 'object' && parsed.skillCheck.key) {
                    resolvedCheck = resolveSkillCheck(gameState, parsed.skillCheck, sessionId);
                    if (resolvedCheck) {
                        const branch = resolvedCheck.success ? parsed.skillCheck.onSuccess : parsed.skillCheck.onFail;
                        // Apply branch override (optional)
                        if (branch && typeof branch === 'object') {
                            if (typeof branch.description === 'string' && branch.description.trim()) {
                                parsed.description = branch.description;
                            }
                            if (Array.isArray(branch.choices) && branch.choices.length) {
                                parsed.choices = branch.choices;
                            }
                            if (branch.effects && Array.isArray(branch.effects)) {
                                // Replace effects; numeric deltas still applied from top-level fields
                                parsed.effects = branch.effects;
                            }
                        }
                        // Attach check result to effects for UI transparency
                        const checkLine = `${resolvedCheck.success ? 'Успех' : 'Провал'} проверки ${resolvedCheck.key} (сложн.${resolvedCheck.difficulty})`;
                        parsed.effects = Array.isArray(parsed.effects) ? parsed.effects : [];
                        parsed.effects.unshift({ stat: 'timeChange', delta: 0, reason: checkLine });
                        // Normalize: remove 0-delta effects later on client display filter already does
                    }
                }

                // КРИТИЧЕСКИ ВАЖНО: Проверяем, умер ли персонаж (после применения изменений)
                if (parsed.gameOver || gameState.health <= 0) {
                    if (gameState.health <= 0 && !parsed.gameOver) {
                        parsed.gameOver = true;
                        parsed.deathReason = parsed.deathReason || 'Смерть от ран';
                    }

                    console.log(`💀 GAME OVER для ${gameState.name}: ${parsed.deathReason} `);

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
                    description: formatDescription(parsed.description),
                    choices: parsed.choices,
                    isDialogue: parsed.isDialogue || false,
                    speakerName: parsed.speakerName || '',
                    effects: parsed.effects || [],
                    checkResult: resolvedCheck
                }));
            } else if (data.type === 'clientUpdate') {
                // Client-side UX updates that should persist (waypoint, UI prefs, etc.)
                const gameState = gameSessions.get(sessionId);
                if (!gameState) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
                    return;
                }
                ensureGameStateIntegrity(gameState);

                const patch = data.patch && typeof data.patch === 'object' ? data.patch : {};

                // Allowlist fields
                if (patch.mapWaypoint && typeof patch.mapWaypoint === 'object') {
                    const locationId = patch.mapWaypoint.locationId ? String(patch.mapWaypoint.locationId) : null;
                    const name = patch.mapWaypoint.name ? String(patch.mapWaypoint.name) : '';
                    gameState.mapWaypoint = { locationId, name };
                }

                ws.send(JSON.stringify({ type: 'clientUpdateAck', gameState }));
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
                    console.log(`💾 Игра загружена для ${loadedState.name}, SessionID: ${sessionId} `);
                    console.log(`📊 Активных сессий: ${gameSessions.size} `);

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
                message: `${error.name}: ${error.message} `
            }));
        }
    });

    ws.on('close', () => {
        console.log(`🔌 Client disconnected, SessionID: ${sessionId} `);
        gameSessions.delete(sessionId);
        console.log(`📊 Активных сессий: ${gameSessions.size} `);
    });
});

httpServer.listen(PORT, () => {
    console.log(`🏰 KINGDOM COME: AI RPG Server`);
    console.log(`📡 Server running on http://localhost:${PORT}`);
    console.log(`🌐 Open http://localhost:${PORT} in your browser`);
});




























