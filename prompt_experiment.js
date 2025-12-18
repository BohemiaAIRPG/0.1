import { performance } from 'perf_hooks';

const COMET_API_KEY = 'sk-jwPgtUPNYyGb7YoirTUy26AKqmdFVzHLsHye55rV6OxIYDMK';
const COMET_API_BASE = 'https://api.cometapi.com/v1';
const MODEL_NAME = 'grok-4-1-fast-non-reasoning';

// Расширенные тестовые сценарии
const TEST_SCENARIOS = [
    // ПРЕДМЕТЫ
    { name: "🔍 Осмотр (не брать)", choice: "Осмотреть комнату", ctx: "На столе лежит кинжал.", expect: { newItems: 0, coins: 0 } },
    { name: "✋ Взять предмет", choice: "Взять кинжал", ctx: "Кинжал на столе.", expect: { newItems: 1 } },

    // РАСХОД ПРЕДМЕТОВ
    { name: "🍎 Съесть еду", choice: "Съесть яблоко", ctx: "У вас в сумке яблоко.", expect: { usedItems: 1, health: "positive" }, inventory: ["Яблоко"] },
    { name: "💊 Использовать зелье", choice: "Выпить лечебное зелье", ctx: "Вы ранены. У вас есть зелье.", expect: { usedItems: 1, health: "positive" }, inventory: ["Лечебное зелье"] },

    // ДЕНЬГИ
    { name: "💰 Предложение (не брать)", choice: "Выслушать торговца", ctx: "Торговец: 'Дам 50 монет за работу'", expect: { coins: 0 } },
    { name: "🤝 Принять оплату", choice: "Принять деньги", ctx: "Торговец протягивает 50 монет.", expect: { coins: "positive" } },

    // НАВЫКИ
    { name: "⚔️ Бой (XP)", choice: "Атаковать бандита мечом", ctx: "Бандит нападает.", expect: { skillXP: "combat" } },
    { name: "🗣️ Убеждение (XP)", choice: "Убедить стражника пропустить", ctx: "Стражник требует пошлину.", expect: { skillXP: "speech" } },

    // ЗДОРОВЬЕ/ВЫНОСЛИВОСТЬ
    { name: "💔 Получить урон", choice: "Броситься на врага без оружия", ctx: "Враг вооружён.", expect: { health: "negative" } },
    { name: "😴 Отдых", choice: "Лечь спать до утра", ctx: "Вы устали.", expect: { stamina: "positive" } },

    // ЛОКАЦИЯ
    { name: "🚶 Смена локации", choice: "Идти в таверну", ctx: "Вы на рынке.", expect: { locationChange: true } },
];

// 2 лучших варианта промптов
const PROMPT_VARIANTS = {
    "EXPLICIT_RULES": (ctx, choice, inv) => `⚠️ ТОЛЬКО JSON! Без текста вне { }
 
Контекст: ${ctx}
Инвентарь: ${inv.length > 0 ? inv.join(', ') : 'пусто'}
Действие: "${choice}"

🚨 КРИТИЧЕСКИЕ ПРАВИЛА:
1. newItems: ТОЛЬКО если игрок ФИЗИЧЕСКИ ВЗЯЛ предмет.
   "осмотреть"/"увидеть" = []
   "взять"/"подобрать" = [{name,quantity,type}]

2. usedItems: ТОЛЬКО если предмет ПОТРАЧЕН/СЪЕДЕН.
   "съесть яблоко" = ["Яблоко"]
   "выпить зелье" = ["Лечебное зелье"]

3. coins: ТОЛЬКО если деньги ПОЛУЧЕНЫ.
   "предложить" = 0
   "принять оплату" = +N

4. health/stamina: дельта (+5/-10)
5. skillXP: {"combat":15} если применён навык
6. locationChange: новая локация или ""

{"description":"...","health":0,"stamina":0,"coins":0,"skillXP":{},"usedItems":[],"newItems":[],"locationChange":"","choices":["...","...","..."]}`,

    "NEGATIVE_EXAMPLES": (ctx, choice, inv) => `ТОЛЬКО JSON!

Контекст: ${ctx}
Инвентарь: ${inv.length > 0 ? inv.join(', ') : 'пусто'}
Действие: "${choice}"

❌ ОШИБКИ (НЕ ДЕЛАЙ ТАК!):
- "осмотреть" → newItems:[{...}] // НЕТ! Не брал!
- "выслушать" → coins:+50 // НЕТ! Не принял!
- "съесть яблоко" → usedItems:[], health:0 // НЕТ! Нужно ["Яблоко"], health:+10
- "убедить стражника" → skillXP:{} // НЕТ! Нужно {"speech":15}

✅ ПРАВИЛЬНО:
- "осмотреть" → newItems:[] (только описать)
- "взять X" → newItems:[{name:"X",quantity:1,type:"item"}]
- "съесть X" → usedItems:["X"], health:+10
- "выпить зелье" → usedItems:["Лечебное зелье"], health:+20
- "выслушать" → coins:0
- "принять оплату" → coins:+50
- бой/атака → skillXP:{"combat":15}, health:-10
- убедить/торг/обман/просьба → skillXP:{"speech":15}
- скрытность/кража → skillXP:{"stealth":15}
- охота/рыбалка → skillXP:{"survival":15}
- отдых/сон → stamina:+30, health:+10

{"description":"...","health":0,"stamina":0,"coins":0,"skillXP":{},"usedItems":[],"newItems":[],"locationChange":"","choices":["...","...","..."]}`
};

async function runTest(promptFn, scenario) {
    const inv = scenario.inventory || [];
    const prompt = promptFn(scenario.ctx, scenario.choice, inv);
    const start = performance.now();

    try {
        const response = await fetch(`${COMET_API_BASE}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${COMET_API_KEY}` },
            body: JSON.stringify({
                model: MODEL_NAME,
                messages: [{ role: 'system', content: 'RPG мастер. ТОЛЬКО JSON.' }, { role: 'user', content: prompt }],
                temperature: 0.7, max_tokens: 800
            })
        });

        const duration = (performance.now() - start).toFixed(0);
        if (!response.ok) return { success: false, parseError: true, duration };

        const data = await response.json();
        const content = data.choices[0].message.content;

        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("No JSON");
            // Fix: убираем + перед числами (модель копирует из примеров)
            const cleanedJson = jsonMatch[0]
                .replace(/,\s*}/g, '}')
                .replace(/,\s*]/g, ']')
                .replace(/:(\s*)\+(\d)/g, ':$1$2'); // :+10 → :10
            const parsed = JSON.parse(cleanedJson);

            return { success: true, parseError: false, duration, data: parsed };
        } catch (e) {
            console.log(`\n   📝 RAW RESPONSE: ${content.substring(0, 200)}...`);
            return { success: false, parseError: true, duration, error: e.message };
        }
    } catch (error) {
        return { success: false, parseError: true, duration: 0, error: error.message };
    }
}

function evaluate(result, expect) {
    if (!result.success) return { pass: false, reason: "Parse error" };
    const d = result.data;

    for (const [key, val] of Object.entries(expect)) {
        if (key === "newItems") {
            const actual = d.newItems?.length || 0;
            if (actual !== val) return { pass: false, reason: `newItems: ${actual} (want ${val})` };
        }
        if (key === "usedItems") {
            const actual = d.usedItems?.length || 0;
            if (actual < val) return { pass: false, reason: `usedItems: ${actual} (want >=${val})` };
        }
        if (key === "coins") {
            if (val === 0 && d.coins !== 0) return { pass: false, reason: `coins: ${d.coins} (want 0)` };
            if (val === "positive" && (d.coins || 0) <= 0) return { pass: false, reason: `coins: ${d.coins} (want >0)` };
        }
        if (key === "health") {
            if (val === "positive" && (d.health || 0) <= 0) return { pass: false, reason: `health: ${d.health} (want >0)` };
            if (val === "negative" && (d.health || 0) >= 0) return { pass: false, reason: `health: ${d.health} (want <0)` };
        }
        if (key === "stamina") {
            if (val === "positive" && (d.stamina || 0) <= 0) return { pass: false, reason: `stamina: ${d.stamina} (want >0)` };
        }
        if (key === "skillXP") {
            if (!d.skillXP || !d.skillXP[val]) return { pass: false, reason: `skillXP.${val} missing` };
        }
        if (key === "locationChange") {
            if (!d.locationChange || d.locationChange.trim() === "") return { pass: false, reason: `locationChange empty` };
        }
    }
    return { pass: true };
}

async function main() {
    const RUNS = 3;
    console.log(`🧪 NEGATIVE_EXAMPLES STRESS TEST (${RUNS} runs × ${TEST_SCENARIOS.length} scenarios)\n`);

    const allResults = [];

    for (let run = 1; run <= RUNS; run++) {
        console.log(`\n🔄 RUN ${run}/${RUNS}`);
        console.log("─".repeat(70));

        const runResults = { pass: 0, fail: 0, parseErrors: 0, totalTime: 0 };
        const promptFn = PROMPT_VARIANTS["NEGATIVE_EXAMPLES"];

        for (const scenario of TEST_SCENARIOS) {
            process.stdout.write(`   ${scenario.name.padEnd(25)}... `);
            const result = await runTest(promptFn, scenario);
            runResults.totalTime += parseInt(result.duration || 0);

            if (result.parseError) {
                runResults.parseErrors++;
                console.log(`❌ PARSE ERROR (${result.duration}ms)`);
            } else {
                const ev = evaluate(result, scenario.expect);
                if (ev.pass) {
                    runResults.pass++;
                    console.log(`✅ PASS (${result.duration}ms)`);
                } else {
                    runResults.fail++;
                    console.log(`❌ FAIL: ${ev.reason} (${result.duration}ms)`);
                }
            }
        }

        const score = ((runResults.pass / TEST_SCENARIOS.length) * 100).toFixed(0);
        console.log(`   📊 Run ${run}: ${runResults.pass}/${TEST_SCENARIOS.length} (${score}%) | Avg: ${(runResults.totalTime / TEST_SCENARIOS.length).toFixed(0)}ms`);
        allResults.push(runResults);
    }

    console.log("\n\n📊 FINAL SUMMARY");
    console.log("═".repeat(70));

    const totalPass = allResults.reduce((s, r) => s + r.pass, 0);
    const totalTests = TEST_SCENARIOS.length * RUNS;
    const avgScore = ((totalPass / totalTests) * 100).toFixed(1);
    const avgTime = (allResults.reduce((s, r) => s + r.totalTime, 0) / totalTests).toFixed(0);
    const totalParseErrors = allResults.reduce((s, r) => s + r.parseErrors, 0);

    console.log(`Total: ${totalPass}/${totalTests} (${avgScore}%)`);
    console.log(`Avg Time: ${avgTime}ms`);
    console.log(`Parse Errors: ${totalParseErrors}`);

    const icon = avgScore >= 90 ? "🏆" : avgScore >= 80 ? "⚠️" : "❌";
    console.log(`\n${icon} NEGATIVE_EXAMPLES: ${avgScore}% average accuracy`);
}

main().catch(console.error);

