
import { readFile } from 'fs/promises';
import { performance } from 'perf_hooks';

const COMET_API_KEY = 'sk-jwPgtUPNYyGb7YoirTUy26AKqmdFVzHLsHye55rV6OxIYDMK';
const COMET_API_BASE = 'https://api.cometapi.com/v1';

const MODELS = [
    'grok-4-fast-reasoning',
    'grok-4-1-fast-non-reasoning'
];

const SCENARIOS = [
    {
        name: "⚔️ COMBAT (Бой)",
        choice: "Выхватить меч и атаковать разбойника",
        contextOverride: {
            equipment: { weapon: { name: "Ржавый меч", condition: 50 }, armor: { name: "Стеганая куртка", condition: 40 } },
            skills: { combat: { level: 2, xp: 10, nextLevel: 100 } }
        }
    },
    {
        name: "🗣️ DIALOGUE (Убеждение)",
        choice: "Попытаться убедить стражника пропустить вас без пошлины",
        contextOverride: {
            skills: { speech: { level: 3, xp: 20, nextLevel: 100 } }
        }
    },
    {
        name: "🍞 INVENTORY (Еда)",
        choice: "Съесть яблоко, чтобы восстановить силы",
        contextOverride: {
            inventory: [{ name: "Яблоко", quantity: 2, type: "food" }],
            health: 50,
            maxHealth: 100
        }
    }
];

function buildPrompt(gameState, playerChoice) {
    return `⚠️⚠️⚠️ ОТВЕЧАЙ СТРОГО ТОЛЬКО ВАЛИДНЫМ JSON!

    Ты мастер RPG.

    ═══ КОНТЕКСТ ═══
    Имя: ${gameState.name}
    Здоровье: ${gameState.health}/${gameState.maxHealth}
    Выносливость: ${gameState.stamina}/${gameState.maxStamina}
    Монеты: ${gameState.coins}
    Экипировка: ${gameState.equipment.weapon.name || 'Кулаки'}, ${gameState.equipment.armor.name || 'Одежда'}
    Инвентарь: ${gameState.inventory.map(i => `${i.name} x${i.quantity}`).join(', ') || 'ПУСТО'}
    Навыки: ${Object.entries(gameState.skills).map(([k, v]) => `${k}:${v.level}`).join(', ')}

    Действие: "${playerChoice}"

    ═══ ПРАВИЛА ═══
    1. ОПИСАНИЕ: Атмосферное, до 130 слов.
    2. ЛОГИКА:
       - Бой: меняй health/stamina, давай skillXP.combat
       - Еда: добавляй в usedItems, меняй health/stamina
       - Диалог: давай skillXP.speech
    3. ИНВЕНТАРЬ: usedItems/newItems - массивы. ОБЯЗАТЕЛЬНО указывай съеденное в usedItems!

    ═══ ФОРМАТ JSON ═══
    {
      "description": "...",
      "health": 0,
      "stamina": 0,
      "coins": 0,
      "skillXP": {},
      "usedItems": [],
      "newItems": [],
      "choices": ["...", "...", "..."]
    }
    
    ОТВЕЧАЙ ТОЛЬКО JSON!`;
}

async function runModelTest(modelName, prompt) {
    const start = performance.now();
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        const response = await fetch(`${COMET_API_BASE}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${COMET_API_KEY}`
            },
            body: JSON.stringify({
                model: modelName,
                messages: [
                    { role: 'system', content: 'Ты RPG-мастер. ОТВЕЧАЙ ТОЛЬКО JSON.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.8,
                max_tokens: 1000
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const end = performance.now();
        const duration = (end - start).toFixed(2);

        if (!response.ok) {
            return { success: false, model: modelName, duration, error: `API error ${response.status}` };
        }

        const data = await response.json();
        const content = data.choices[0].message.content;

        try {
            const jsonMatch = content.replace(/\r/g, '').match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("No JSON");

            const cleaned = jsonMatch[0]
                .replace(/\/\/.*$/gm, '')
                .replace(/,\s*}/g, '}')
                .replace(/,\s*]/g, ']')
                .trim();

            const parsed = JSON.parse(cleaned);
            return { success: true, model: modelName, duration, content: parsed };
        } catch (e) {
            return { success: false, model: modelName, duration, error: `Parse: ${e.message}` };
        }
    } catch (error) {
        return { success: false, model: modelName, duration: 0, error: error.message };
    }
}

async function main() {
    const baseState = {
        name: "Генри",
        health: 100, maxHealth: 100,
        stamina: 100, maxStamina: 100,
        coins: 10,
        equipment: { weapon: { name: "", condition: 0 }, armor: { name: "", condition: 0 } },
        inventory: [],
        skills: {
            combat: { level: 0, xp: 0 },
            speech: { level: 0, xp: 0 },
            stealth: { level: 0, xp: 0 },
            survival: { level: 0, xp: 0 }
        }
    };

    console.log("🚀 STARTING BENCHMARK (TEXT + STATS)\n");

    for (const scenario of SCENARIOS) {
        console.log(`\n\n🔹 SCENARIO: ${scenario.name}`);
        console.log(`   Choice: "${scenario.choice}"`);
        console.log("   ----------------------------------------------------------------");

        const scenarioResults = {};

        for (const model of MODELS) {
            // Prepare state
            const testState = JSON.parse(JSON.stringify(baseState));
            if (scenario.contextOverride.equipment) testState.equipment = { ...testState.equipment, ...scenario.contextOverride.equipment };
            if (scenario.contextOverride.skills) {
                for (const [k, v] of Object.entries(scenario.contextOverride.skills)) {
                    testState.skills[k] = { ...testState.skills[k], ...v };
                }
            }
            if (scenario.contextOverride.inventory) testState.inventory = scenario.contextOverride.inventory;
            if (scenario.contextOverride.health) testState.health = scenario.contextOverride.health;

            const prompt = buildPrompt(testState, scenario.choice);
            process.stdout.write(`   Running ${model.replace('grok-4-', '')}... `);
            const result = await runModelTest(model, prompt);
            console.log(result.success ? `✅ ${result.duration}ms` : "❌");

            scenarioResults[model] = result;
        }

        console.log("\n   📊 COMPARISON:");

        // Print Side-by-Side Stats
        for (const model of MODELS) {
            const shortName = model.replace('grok-4-', '').replace('fast-', '');
            const r = scenarioResults[model];

            console.log(`\n   🤖 ${shortName.toUpperCase()} (${r.duration}ms):`);
            if (r.success) {
                const c = r.content;
                // Print Stats
                let stats = [];
                if (c.health) stats.push(`Health: ${c.health > 0 ? '+' : ''}${c.health}`);
                if (c.stamina) stats.push(`Stamina: ${c.stamina > 0 ? '+' : ''}${c.stamina}`);
                if (c.coins) stats.push(`Coins: ${c.coins > 0 ? '+' : ''}${c.coins}`);
                if (c.skillXP && Object.keys(c.skillXP).length > 0) {
                    const xps = Object.entries(c.skillXP).map(([k, v]) => `${k}+${v}`);
                    stats.push(`XP: ${xps.join(', ')}`);
                }
                if (c.usedItems && c.usedItems.length > 0) stats.push(`Used: -${c.usedItems.join(', -')}`);
                if (c.newItems && c.newItems.length > 0) {
                    const news = c.newItems.map(i => `${i.name}x${i.quantity || 1}`);
                    stats.push(`Got: +${news.join(', +')}`);
                }

                if (stats.length > 0) console.log(`      STAT CHANGES: [ ${stats.join(' | ')} ]`);
                else console.log(`      STAT CHANGES: [ NO CHANGES ]`);

                console.log(`      OPINION: "${c.description.replace(/\n/g, ' ')}"`);
            } else {
                console.log(`      ERROR: ${r.error}`);
            }
        }
        console.log("   ----------------------------------------------------------------");
    }
}

main().catch(console.error);
