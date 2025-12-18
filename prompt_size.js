import { readFile } from 'fs/promises';

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
     * Никто не видел / действовал ради себя / тренировка / патруль без результата / разговор с командиром → 0
     * Обычная вежливость / работа / покупка / исполнение приказа → 0
     * Малое доброе дело (кто-то благодарен) → +1 (если репутация < 60)
     * Героический поступок при свидетелях → +2..+3 (если репутация < 70)
     * При репутации ≥ 60 подумай дважды: чаще всего 0. При репутации ≥ 70 положительное изменение максимум +1 и только за подвиг, иначе 0
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
6. Репутация: ЧИСЛО (дельта). □ Ничего заметного? → 0. □ Патруль / выполнение приказа / разговор → 0? □ Высокая репутация (70+) → максимум +1 и только подвиг? Учтена история?
7. Инвентарь: usedItems с повторами для количества?
8. Смерть: gameOver только при реальной смерти?
9. Диалог: правильные реплики если isDialogue?

Исправь ошибки перед отправкой! ОТВЕЧАЙ ТОЛЬКО ЧИСТЫМ JSON БЕЗ ТЕКСТА ВНЕ { }!`;
}

async function main() {
    const cliPath = process.argv[2];
    const candidates = [
        cliPath,
        './saves/kingdom_save_Пашек_20251107_0015.json',
        '../kingdom_save_Пашек_20251107_0015.json',
        './kingdom_save_Пашек_20251107_0015.json'
    ].filter(Boolean);

    let saveData;
    for (const path of candidates) {
        try {
            const text = await readFile(path, 'utf8');
            saveData = JSON.parse(text);
            console.log(`📂 Используется файл сохранения: ${path}`);
            break;
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    }

    if (!saveData) {
        throw new Error('Не удалось найти файл сохранения. Укажите путь аргументом.');
    }

    const { gameState, currentScene, currentChoices } = saveData;
    const choice = currentChoices?.[0] || 'Пойти к реке и попытаться порыбачить голыми руками';

    const prompt = buildPrompt(gameState, choice, currentScene);
    const length = prompt.length;
    const words = prompt.split(/\s+/).length;
    const approxTokens = Math.round(length / 4);

    console.log('===== Статистика промпта =====');
    console.log(`Длина (символы): ${length}`);
    console.log(`Слов (приблизительно): ${words}`);
    console.log(`Оценка токенов (≈длина/4): ${approxTokens}`);
    console.log('==============================');
    console.log(prompt);
}

main().catch(err => {
    console.error('Ошибка вычисления промпта:', err);
    process.exit(1);
});



