import { clamp, hashStringToInt, mulberry32, stableIdFromName, getTurnIndex, formatDate } from './utils.js';

export function getSkillValue(gameState, key) {
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

export function resolveSkillCheck(gameState, skillCheck, sessionId) {
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

export function normalizeWorldMap(gameState) {
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

export function findLocationByName(gameState, name) {
    if (!name) return null;
    const n = String(name).trim().toLowerCase();
    if (!n) return null;
    // Prefer exact match; fallback to includes
    let loc = gameState.worldMap.find(l => l.name && l.name.toLowerCase() === n);
    if (loc) return loc;
    loc = gameState.worldMap.find(l => n.includes(l.name.toLowerCase()) || l.name.toLowerCase().includes(n));
    return loc || null;
}

export function ensureGameStateIntegrity(gameState) {
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

export function applyWorldRules(gameState, parsed) {
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

export function createGameState(name, gender = 'male') {
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

export function updateTime(gameState, hoursToAdd) {
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

export function applyChanges(gameState, parsed) {
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
