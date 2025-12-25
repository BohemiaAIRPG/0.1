import fetch from 'node-fetch';
import { logAIParseFailure } from './storage.js';
import { getSkillValue } from './game.js';
import { formatDate } from './utils.js';

// Configuration
const COMET_API_BASE = process.env.COMET_API_BASE || 'https://api.comet.com/v1'; // Fallback URL
const COMET_API_KEY = process.env.COMET_API_KEY;
const MODEL_ID = 'grok-beta'; // Using Grok Beta as requested

export async function generateWithAI(prompt) {
    if (!COMET_API_KEY) {
        throw new Error('COMET_API_KEY is not defined in environment variables!');
    }

    // console.log('🤖 Sending prompt to AI:', prompt.substring(0, 500) + '...');

    const response = await fetch(`${COMET_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${COMET_API_KEY}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({
            model: MODEL_ID,
            messages: [
                {
                    role: 'system',
                    content: 'Ты — мастер средневековой RPG (Kingdom Come: Deliverance). \n\n⚠️ ПРАВИЛО ОТВЕТА: СТРОГО JSON. НИКАКОГО ТЕКСТА ВНЕ СТРУКТУРЫ. \n\n🔴 СТРУКТУРА ПРАВИЛ (JSON-центричность):\n1. "description": Атмосферный текст (вы/вас), деление на абзацы через \\n\\n. Очищай от технических артефактов.\n2. "newEquipment": Если игрок надевает что-то (рубаху, штаны, броню) или берет оружие — ОБЯЗАТЕЛЬНО обнови это поле. { "weapon": { "name": "...", "condition": 100 }, "armor": { "name": "...", "condition": 100 } }. Если не менялось — не включай.\n3. "newItems" / "usedItems": Если предмет получен/потерян. Каждый предмет — отдельный объект в массиве. \n4. "stats": health/stamina/coins/reputation/morality/satiety/energy — это ДЕЛЬТЫ (+/-). satiety/energy убывают сами по времени, НЕ уменьшай их вручную за "ход", если не было прямого действия (удар, голод).\n\n📦 ЭКИПИРОВКА: Если игрок надевает одежду (даже лохмотья), это "armor". Если берет меч — это "weapon".\n\n🛡️ РЕАЛИЗМ: Грязная одежда дает штраф к харизме, но прикрывает наготу. Босой человек на камнях теряет выносливость.'
                },
                { role: 'user', content: prompt }
            ],
            response_format: { type: "json_object" },
            temperature: 0.6,
            max_tokens: 2000
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI API Error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    if (!data.choices || data.choices.length === 0) {
        throw new Error('AI returned empty response (no choices)');
    }

    return data.choices[0].message.content;
}

export function buildHistoryContext(history) {
    if (!history || history.length === 0) return '';
    // Take last 3 entries to keep context relevant but concise
    const recent = history.slice(-3);
    return recent.map((entry, i) => {
        return `[Ход -${recent.length - i}]:
Выбор: ${entry.choice}
Сцена: ${entry.scene.substring(0, 150)}...
`;
    }).join('\n');
}

export function buildPrompt(gameState, choice, previousScene) {
    // 1. Core State
    const gender = gameState.gender || 'male';
    const name = gameState.name || 'Странник';
    const day = gameState.date?.dayOfGame || 1;
    const time = gameState.date?.timeOfDay || 'утро';
    const dateStr = gameState.date ? formatDate(gameState.date) : 'Неизвестная дата';

    // 2. Vitals
    const health = gameState.health;
    const stamina = gameState.stamina;
    const coins = gameState.coins;
    const satiety = gameState.satiety !== undefined ? gameState.satiety : 20;
    const energy = gameState.energy !== undefined ? gameState.energy : 55;
    const rep = gameState.reputation;

    // 3. Equipment & Inventory
    const weapon = gameState.equipment?.weapon?.name || 'нет';
    const armor = gameState.equipment?.armor?.name || 'нет';
    const inventory = gameState.inventory.map(i => `${i.name}(${i.quantity})`).join(', ') || 'пусто';

    // 4. Skills & Attributes
    const strength = gameState.attributes.strength || 1;
    const agility = gameState.attributes.agility || 1;
    const speech = getSkillValue(gameState, 'speech'); // 0..100
    const stealth = getSkillValue(gameState, 'stealth'); // 0..100
    const combat = getSkillValue(gameState, 'combat'); // 0..100

    // 5. Context
    // Get currently known NPCs in this location for context
    const nearbyNPCs = Object.values(gameState.npcs || {})
        .filter(n => n.lastSeen?.locationName === gameState.location) // or match ID
        .map(n => `${n.name}(отнош:${n.disposition})`)
        .join(', ');

    const context = buildHistoryContext(gameState.history);

    return `
# ТЕКУЩЕЕ СОСТОЯНИЕ МИРА (Богемия, 1403 год)
Имя: ${name} (${gender === 'female' ? 'Женщина' : 'Мужчина'})
Дата: ${dateStr}, День ${day}, ${time}
Локация: ${gameState.location}
Здоровье: ${health}/100, Выносливость: ${stamina}/100
Голод: ${satiety}/100 (низкий=плохо), Энергия: ${energy}/100
Деньги: ${coins} грошей. Репутация: ${rep}/100.
Экипировка: Оружие [${weapon}], Броня [${armor}]
Инвентарь: [${inventory}]

# НАВЫКИ
Сила: ${strength}, Ловкость: ${agility}
Красноречие: ${speech}, Скрытность: ${stealth}, Бой: ${combat}

# ОКРУЖЕНИЕ
Люди рядом: ${nearbyNPCs || 'Никого примечательного'}

# ИСТОРИЯ ПОСЛЕДНИХ ДЕЙСТВИЙ
${context}

# ПРЕДЫДУЩАЯ СЦЕНА
${previousScene}

# ДЕЙСТВИЕ ИГРОКА
"${choice}"

# ИНСТРУКЦИЯ МАСТЕРУ
1. Опиши последствия выбора игрока (художественно, 2-3 абзаца).
2. Если игрок пробует навык (украсть, убедить, ударить) -> реши, получилось или нет, опираясь на статы.
3. Предложи 3-4 варианта дальнейших действий.
4. В поле "effects" укажи изменения в JSON.
5. В поле "stats" укажи изменения (+/-) для health, stamina, coins, и т.д.
6. ВАЖНО: Если игрок взял или купил предмет -> добавь в newItems.
7. ВАЖНО: Если игрок съел или использовал предмет -> добавь в usedItems.
8. Если игрок надел броню/оружие -> newEquipment.
9. Если сменилась локация -> locationChange: "Название".
10. Если игрок умер -> gameOver: true, deathReason: "..."

ВЕРНИ ОТВЕТ ТОЛЬКО В JSON ФОРМАТЕ.
{
  "description": "Текст...",
  "choices": ["Вариант 1", "Вариант 2", "Вариант 3"],
  "health": 0, "stamina": 0, "coins": 0, "satiety": 0, "energy": 0,
  "reputation": 0, "morality": 0,
  "timeChange": 1,
  "locationChange": "",
  "isDialogue": false,
  "speakerName": "",
  "newItems": [],
  "usedItems": [],
  "gameOver": false,
  "deathReason": ""
}
`;
}

// Helper to extract JSON by balancing brackets
function extractJsonBlock(text) {
    let startIndex = text.indexOf('{');
    if (startIndex === -1) return null;

    let braceCount = 0;
    let inString = false;
    let escaped = false;

    // We only care about the outer block
    for (let i = startIndex; i < text.length; i++) {
        const char = text[i];

        if (inString) {
            if (char === '\\' && !escaped) {
                escaped = true;
            } else if (char === '"' && !escaped) {
                inString = false;
            } else {
                escaped = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }

        if (char === '{') {
            braceCount++;
        } else if (char === '}') {
            braceCount--;
            if (braceCount === 0) {
                // Found the closing brace of the root object
                return text.substring(startIndex, i + 1);
            }
        }
    }
    // If we're here, braces didn't balance (likely incomplete or malformed)
    // Fallback: Try regex aggressive match
    return null;
}

export function parseAIResponse(text) {
    // 0. DEBUG LOG
    console.log('\n\n🔍 ========== [DEBUG] RAW AI RESPONSE START ==========');
    console.log(text);
    console.log('🔍 ========== [DEBUG] RAW AI RESPONSE END ============\n');

    try {
        // 1. Предварительная очистка (удаляем Markdown блоки)
        let cleaned = text
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .trim();

        // 2. Попытка извлечь JSON через баланс скобок (надежнее regex)
        let jsonStr = extractJsonBlock(cleaned);

        // Fallback на Regex, если баланс не сошелся
        if (!jsonStr) {
            const jsonMatch = cleaned.replace(/\r/g, '').match(/\{[\s\S]*\}/);
            if (jsonMatch) jsonStr = jsonMatch[0];
        }

        if (!jsonStr) {
            throw new Error('JSON object not found in response');
        }

        // 3. Чистка внутри JSON строки
        jsonStr = jsonStr
            .replace(/,\s*}/g, '}')   // Remove trailing commas
            .replace(/,\s*]/g, ']')
            .replace(/\\"(\w+)\\"/g, '"$1"') // Fix: \"key\" -> "key"
            .replace(/:(\s*)\+(\d)/g, ':$1$2') // Fix: :+10 → :10
            .trim();

        console.log('🧹 Cleaned JSON string:', jsonStr.substring(0, 100) + '...');

        const parsed = JSON.parse(jsonStr);

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

        // Init Arrays
        if (!Array.isArray(parsed.usedItems)) parsed.usedItems = [];
        if (!Array.isArray(parsed.newItems)) parsed.newItems = [];
        if (!Array.isArray(parsed.effects)) parsed.effects = [];

        // Validation - newItems
        if (parsed.newItems.length > 0) {
            parsed.newItems = parsed.newItems.filter(item => {
                if (!item.name || typeof item.name !== 'string') return false;
                if (typeof item.quantity !== 'number') item.quantity = 1;
                if (!item.type) item.type = 'item';
                return true;
            });
        }

        // Validation - usedItems
        if (parsed.usedItems.length > 0) {
            parsed.usedItems = parsed.usedItems.filter(itemName => {
                return (typeof itemName === 'string' && itemName.trim());
            });
        }

        return parsed;

    } catch (error) {
        console.error('❌ Parse error! Raw text:', text);
        console.error('❌ Parse error details:', error.message);
        error.message = `Failed to parse AI response: ${error.message}`;
        throw error;
    }
}

export async function requestAIResponse(gameState, choice, previousScene, attempt = 0, sessionId = 'unknown') {
    const maxAttempts = 2;
    const basePrompt = buildPrompt(gameState, choice, previousScene);
    const prompt = attempt === 0
        ? basePrompt
        : `${basePrompt} \n\n⚠️ ТЫ ПРИСЛАЛ НЕВЕРНЫЙ ФОРМАТ! ПОВТОРИ ТОТ ЖЕ ОТВЕТ СТРОГО В ВАЛИДНОМ JSON БЕЗ ТЕКСТА ВНЕ { }.`;

    // Only allow retry if it's NOT a critical error (like API failure), generally we assume generateWithAI throws on API fail
    // But here we retry on PARSE fail.

    let aiResponse;
    try {
        aiResponse = await generateWithAI(prompt);
    } catch (apiError) {
        // If API fails, we probably can't simply retry immediately with same key if it's quota, 
        // but if it's a glitch, maybe. 
        // For now, let's treat API errors as fatal for this request OR delegate to fallback
        console.error(`Status API Fail (Attempt ${attempt}): ${apiError.message}`);
        // If it's a rate limit or auth, retrying won't help much. 
        // Let's just create a dummy response to safely failover to fallback message
        aiResponse = null;
    }

    if (!aiResponse) {
        // If we failed to get a response content
        if (attempt + 1 < maxAttempts) {
            // Maybe retry?
            return requestAIResponse(gameState, choice, previousScene, attempt + 1, sessionId);
        }
        // Else fallback
        return getFallbackResponse();
    }

    // console.log(`🧠 RAW AI RESPONSE(attempt ${attempt + 1}): `, aiResponse);

    try {
        return parseAIResponse(aiResponse);
    } catch (error) {
        await logAIParseFailure(sessionId, choice, attempt, aiResponse, error.message);
        if (attempt + 1 < maxAttempts) {
            console.warn(`⚠️ AI response parse failed(attempt ${attempt + 1}).Retrying...`);
            return requestAIResponse(gameState, choice, previousScene, attempt + 1, sessionId);
        }

        console.error('❌ Все попытки парсинга провалились. Возвращаем fallback.');
        return getFallbackResponse();
    }
}

function getFallbackResponse() {
    return {
        description: 'Мир замер на мгновение... Попробуйте повторить действие.',
        choices: ['Попробовать снова', 'Осмотреться', 'Подождать'],
        health: 0, stamina: 0, coins: 0, reputation: 0, morality: 0,
        timeChange: 0, locationChange: '', isDialogue: false, speakerName: '',
        skillXP: {}, usedItems: [], newItems: [],
        characterUpdate: { recentEvents: [], importantChoices: [], relationships: {}, milestone: '' }
    };
}
