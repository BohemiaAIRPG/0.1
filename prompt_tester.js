import { readFile } from 'fs/promises';

const COMET_API_KEY = 'sk-jwPgtUPNYyGb7YoirTUy26AKqmdFVzHLsHye55rV6OxIYDMK';
const COMET_API_BASE = 'https://api.cometapi.com/v1';
const MODEL_NAME = 'grok-4-1-fast-non-reasoning';

function formatDate(date) {
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
        'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    return `${date.day} ${months[date.month - 1]} ${date.year} года`;
}

function buildHistoryContext(gameState) {
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

    const milestones = gameState.character.milestones || [];
    const ancientMilestones = milestones.filter(m => currentDay - m.dayOfGame > 30);
    const recentMilestones = milestones.filter(m => {
        const diff = currentDay - m.dayOfGame;
        return diff >= 7 && diff <= 30;
    });

    const recentEvents = gameState.character.recentEvents || [];
    const lastActions = gameState.history.slice(-15);
    const veryRecentActions = lastActions.slice(-5);
    const recentActions = lastActions.slice(-15, -5);

    let historyText = '';

    if (ancientMilestones.length > 0) {
        historyText += '═══ ВАЖНЫЕ ВЕХИ ПУТЕШЕСТВИЯ ═══\n';
        ancientMilestones.forEach(m => {
            historyText += `📜 ${formatDate(m.date)}: ${m.event}\n`;
        });
        historyText += '\n';
    }

    if (recentMilestones.length > 0) {
        historyText += '═══ СОБЫТИЯ ПОСЛЕДНИХ НЕДЕЛЬ ═══\n';
        recentMilestones.forEach(m => {
            historyText += `📅 ${formatDate(m.date)}: ${m.event}\n`;
        });
        historyText += '\n';
    }

    if (recentEvents.length > 0) {
        historyText += '═══ НЕДАВНИЕ СОБЫТИЯ (последние 7 дней) ═══\n';
        recentEvents.slice(-15).forEach(e => {
            historyText += `- ${e}\n`;
        });
        historyText += '\n';
    }

    if (recentActions.length > 0) {
        historyText += '═══ ПРЕДЫДУЩИЕ ДЕЙСТВИЯ (10 ходов назад) ═══\n';
        recentActions.forEach(h => {
            historyText += `• "${h.choice}" → ${h.scene.substring(0, 100)}...\n`;
        });
        historyText += '\n';
    }

    if (veryRecentActions.length > 0) {
        historyText += '═══ ПОСЛЕДНИЕ ДЕЙСТВИЯ (полное описание) ═══\n';
        veryRecentActions.forEach((h, idx) => {
            historyText += `\n[${veryRecentActions.length - idx} ход назад]\n`;
            historyText += `Выбор: "${h.choice}"\n`;
            historyText += `Что произошло: ${h.scene}\n`;
        });
    }

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
- Сытость (satiety): ${gameState.satiety}/100
- Бодрость (energy): ${gameState.energy}/100

ЭКИПИРОВКА:
- Оружие: ${gameState.equipment.weapon.name}
- Доспех: ${gameState.equipment.armor.name}

ИНВЕНТАРЬ: ${gameState.inventory.map(i => `${i.name} x${i.quantity}`).join(', ') || 'ПУСТО'}

═══ ТЕКУЩАЯ СИТУАЦИЯ ═══
Предыдущая сцена: ${previousScene || 'Начало игры'}
Действие игрока: "${playerChoice}"

═══ ПРАВИЛА ИГРЫ ═══
1. РЕАЛИСТИЧНОСТЬ: Мир жестокий.
2. ИЗМЕНЕНИЯ (ЧИСЛА - ЭТО ДЕЛЬТЫ!):
   - health/stamina: +10/-5 (дельта)
   - coins: +10/-5 (дельта). БЕЗ случайных монет! Только если деньги РЕАЛЬНО перешли из рук в руки!
   - timeChange: Часы (0.5-12)
   - locationChange: Новая локация или ""

⚠️ ВЫЖИВАНИЕ (satiety/energy) - СТРОГИЕ ПРАВИЛА:
1. ИЗМЕНЯТЬ ТОЛЬКО если действие игрока ПРЯМО влияет на это (поел, поспал).
2. "Надел одежду" / "Посмотрел" / "Спросил" -> satiety: 0, energy: 0. (НЕ МЕНЯТЬ! Отправляй 0 или не отправляй вовсе)
3. ВСЕ ЧИСЛА - ЭТО ИЗМЕНЕНИЯ (+/-), А НЕ ЗНАЧЕНИЯ!
   - ❌ НЕЛЬЗЯ: "satiety": 80 (это сделает +80!)
   - ✅ МОЖНО: "satiety": 10 (это добавит +10), "satiety": -5 (это отнимет 5)
   - "Съел яблоко" -> "satiety": 10
   - "Поспал" -> "energy": 40, "stamina": 30
   - timeChange АВТОМАТИЧЕСКИ их снижает. НЕ снижай их вручную за время.

⚠️ ИНВЕНТАРЬ newItems:
- КАЖДЫЙ предмет ОТДЕЛЬНО! НЕ "Штаны и рубаха", а [{name:"Штаны"}, {name:"Рубаха"}]
- НЕ дублируй предметы, которые уже есть в инвентаре!

═══ ФОРМАТ ОТВЕТА (ТОЛЬКО JSON) ═══
{
  "description": "...",
  "health": 0,
  "stamina": 0,
  "coins": 0,
  "satiety": 0,
  "energy": 0,
  "timeChange": 0,
  "newItems": [],
  "usedItems": [],
  "isDialogue": false,
  "speakerName": "",
  "choices": ["Вариант1", "Вариант2", "Вариант3"]
}
`;
}

function parseAIResponse(text) {
    const jsonMatch = text.replace(/\r/g, '').match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        throw new Error('JSON not found in response');
    }
    let cleaned = jsonMatch[0]
        .replace(/\/\/.*$/gm, '')
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']')
        .replace(/\\"(\w+)\\"/g, '"$1"') // Fix: \"key\" -> "key"
        .replace(/:(\s*)\+(\d)/g, ':$1$2') // Fix +numbers
        .trim();

    console.log('🧹 Cleaned AI response:', cleaned);

    const parsed = JSON.parse(cleaned);
    console.log('🔍 Parsed response:', JSON.stringify(parsed, null, 2));
    return parsed;
}

async function generateWithAI(prompt) {
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
                    content: 'Ты мастер RPG-игр. ⚠️ ОТВЕЧАЙ СТРОГО ТОЛЬКО ВАЛИДНЫМ JSON БЕЗ ЛЮБОГО ДОПОЛНИТЕЛЬНОГО ТЕКСТА!'
                },
                { role: 'user', content: prompt }
            ],
            temperature: 0.8,
            max_tokens: 2000
        })
    });

    if (!response.ok) {
        throw new Error(`API error ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

async function readSaveData() {
    const cliPath = process.argv[2];
    const candidates = [
        cliPath,
        './saves/kingdom_save_Пашек_20251107_0015.json',
        '../kingdom_save_Пашек_20251107_0015.json',
        './kingdom_save_Пашек_20251107_0015.json'
    ].filter(Boolean);

    for (const candidate of candidates) {
        try {
            const data = await readFile(candidate, 'utf8');
            console.log(`📂 Используется файл сохранения: ${candidate}`);
            return JSON.parse(data);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    }
    throw new Error('Не найден файл сохранения. Передайте путь аргументом или поместите файл в ./saves.');
}

async function main() {
    const saveData = await readSaveData();
    const { gameState, currentScene, currentChoices } = saveData;

    const choicesToTest = [
        // === SURVIVAL TESTS ===
        'Надеть рваную рубаху и штаны',           // 1. Equip -> Satiety 0
        'Съесть черствый хлеб',                   // 2. Eat -> Satiety +10..+30, usedItems=["хлеб"]
        'Лечь спать на сеновале',                 // 3. Sleep -> Energy +, Time +

        // === GAMEPLAY TESTS ===
        'Поговорить с кузнецом о работе',         // 4. Dialogue -> Dialogue true
        'Дойти до соседней деревни',              // 5. Walk -> Time change
        'Украсть яблоко с прилавка',              // 6. Stealth -> Reputation negative
        'Напасть на стражника',                   // 7. Combat -> Health -, Stamina -
        'Купить пива за последние гроши',         // 8. Trade -> Coins -
        'Помолиться в церкви',                    // 9. Morality -> Morality +
        'Попытаться поймать рыбу руками'          // 10. Skill -> Survival XP +
    ];

    for (let i = 0; i < choicesToTest.length; i++) {
        const choice = choicesToTest[i];
        console.log(`\n===== ЗАПРОС ${i + 1}: ${choice} =====`);
        const prompt = buildPrompt(gameState, choice, currentScene);

        try {
            const aiRaw = await generateWithAI(prompt);
            console.log('📝 RAW AI RESPONSE:', aiRaw);
            const parsed = parseAIResponse(aiRaw);

            // Validation Report
            console.log('🧪 VALIDATION REPORT:');
            if (parsed.satiety > 0 && (!parsed.usedItems || parsed.usedItems.length === 0)) console.warn('🔴 FAIL: Phantom Satiety!');
            else console.log('🟢 Satiety logic OK');

            if (parsed.energy > 5 && parsed.timeChange < 1) console.warn('🔴 FAIL: Phantom Energy!');
            else console.log('🟢 Energy logic OK');

        } catch (error) {
            console.error('❌ Ошибка при обработке ответа:', error.message);
        }
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

