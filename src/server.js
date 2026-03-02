import 'dotenv/config';
import { WebSocketServer } from 'ws';
import express from 'express';
import { createServer } from 'http';
import { join } from 'path';
import * as fs from 'fs';
import { GameState } from './GameState.js';

const PORT = process.env.PORT || 3000;
const COMET_API_KEY = process.env.COMET_API_KEY;
const COMET_API_BASE = 'https://api.cometapi.com/v1';
const MODEL_NAME = 'deepseek-v3.2-exp';
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'flux-2-flex';

// Хардкодный исторический контекст — всегда добавляется ПЕРЕД image_prompt от Grok
const IMAGE_HISTORY_PREFIX = `maximum photorealism, historical realism, highly detailed medieval photography, captured on high-end camera, 8k resolution, cinematic lighting, muddy cobblestone streets, Kutna Hora Bohemia 1403, silver mining town, gothic architecture, candlelight, torchlight, dark and gritty atmosphere, muted earth tones, period-accurate clothing and tools —`;

// Express App
const app = express();
app.use(express.static(join(process.cwd(), 'public')));

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

const sessions = new Map();

wss.on('connection', (ws) => {
    let sessionId = Math.random().toString(36).substring(7);
    sessions.set(sessionId, new GameState());

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'reconnect') {
                if (data.sessionId && sessions.has(data.sessionId)) {
                    sessionId = data.sessionId; // Восстанавливаем старый ID сессии
                    const state = sessions.get(sessionId);
                    ws.send(JSON.stringify({
                        type: 'update',
                        state: state,
                        shortCode: state.toShortCode(),
                        message: state.lastNarrative || 'Вы оглядываетесь вокруг...',
                        choices: state.lastChoices || [],
                        sessionId: sessionId
                    }));
                } else {
                    // Сессия не найдена на сервере (например после перезапуска)
                    ws.send(JSON.stringify({ type: 'reconnect_failed' }));
                }
                return;
            }

            const state = sessions.get(sessionId);

            if (data.type === 'init_character') {
                state.name = data.name || 'Бродяга';
                state.gender = data.gender || 'Мужчина';
                state.age = data.age || 25;

                ws.send(JSON.stringify({ type: 'processing' }));

                const promptPayload = `Я - ${state.name}, ${state.age}-летни${state.gender === 'Мужчина' ? 'й' : 'я'} ${state.gender === 'Мужчина' ? 'мужчина' : 'женщина'}. Я только что очнулся в грязи. Осмотреться.`;
                const response = await generateAIResponse(state, promptPayload);
                const { narrative, newShortCode, choices, imagePrompt } = parseAIResponse(response);

                if (newShortCode) state.updateFromShortCode(newShortCode);

                state.lastNarrative = narrative;
                state.lastChoices = choices;

                // Первый ход после создания персонажа = moveCount 1
                state.moveCount = 1;
                const shouldGenerateImage = true; // Всегда генерим на 1-м ходу

                ws.send(JSON.stringify({
                    type: 'init',
                    state: state,
                    shortCode: state.toShortCode(),
                    message: narrative,
                    choices: choices,
                    sessionId: sessionId,
                    imageExpected: shouldGenerateImage
                }));

                if (shouldGenerateImage && imagePrompt) {
                    const fullPrompt = `${IMAGE_HISTORY_PREFIX} ${imagePrompt}`;
                    generateSceneImage(fullPrompt)
                        .then(imageUrl => ws.send(JSON.stringify({ type: 'image_update', imageUrl: imageUrl })))
                        .catch(() => ws.send(JSON.stringify({ type: 'image_update', imageUrl: null })));
                }

                return;
            }

            if (data.type === 'action') {
                state.moveCount = (state.moveCount || 0) + 1;

                ws.send(JSON.stringify({ type: 'processing' }));

                const response = await generateAIResponse(state, data.action);

                // Парсим ответ ИИ
                const { narrative, newShortCode, choices, imagePrompt } = parseAIResponse(response);

                // Создаем снимок старого состояния до применения ShortCode
                const oldState = {
                    health: state.health,
                    stamina: state.stamina,
                    satiety: state.satiety,
                    coins: state.coins,
                    reputation: state.reputation,
                    morality: state.morality
                };

                // Сначала обновляем жесткое состояние из ShortCode (если он есть)
                if (newShortCode) {
                    state.updateFromShortCode(newShortCode);
                }

                // ЗАТЕМ применяем текстовые дельты (например, COIN +4, SAT -5), чтобы они не перезаписывались ShortCode'ом
                if (narrative) {
                    state.applyNarrativeDeltas(narrative, oldState);
                }

                state.lastNarrative = narrative;
                state.lastChoices = choices;

                // Генерируем картинку на ходу 1 (init) и далее каждые 10 ходов (11, 21, 31...)
                const shouldGenerateImage = (state.moveCount % 10 === 1);

                const outData = {
                    type: 'update',
                    state: state,
                    shortCode: state.toShortCode(),
                    message: narrative,
                    choices: choices,
                    sessionId: sessionId,
                    imageExpected: shouldGenerateImage
                };

                // Отправляем текстовый ответ МГНОВЕННО
                ws.send(JSON.stringify(outData));

                // Асинхронно генерируем картинку и отправляем её позже
                if (shouldGenerateImage && imagePrompt) {
                    const fullPrompt = `${IMAGE_HISTORY_PREFIX} ${imagePrompt}`;
                    console.log(`[IMAGE] Move #${state.moveCount} — generating image. Prompt: ${fullPrompt.substring(0, 120)}...`);

                    generateSceneImage(fullPrompt)
                        .then(imageUrl => {
                            console.log(`[IMAGE] Generated and sent to client`);
                            ws.send(JSON.stringify({ type: 'image_update', imageUrl: imageUrl }));
                        })
                        .catch(imgErr => {
                            console.error('[IMAGE] Generation failed:', imgErr.message);
                            ws.send(JSON.stringify({ type: 'image_update', imageUrl: null }));
                        });
                }
            } else if (data.type === 'request_save') {
                const state = sessions.get(sessionId);
                ws.send(JSON.stringify({
                    type: 'receive_save',
                    state: state
                }));
            } else if (data.type === 'load_state') {
                const state = sessions.get(sessionId);
                if (data.state) {
                    state.fromJSON(data.state);
                    // Отправляем обновленный UI
                    ws.send(JSON.stringify({
                        type: 'update',
                        state: state,
                        shortCode: state.toShortCode(),
                        message: state.lastNarrative || 'Игра успешно загружена. Вы осматриваетесь вокруг...',
                        choices: state.lastChoices || [],
                        sessionId: sessionId
                    }));
                }
            } else if (data.type === 'set_narrative_length') {
                const state = sessions.get(sessionId);
                if (data.length === 'short' || data.length === 'long') {
                    state.narrativeLength = data.length;
                }
            }
        } catch (e) {
            console.error('WebSocket Error:', e);
            ws.send(JSON.stringify({ type: 'error', message: 'Ошибка сервера' }));
        }
    });

    ws.on('close', () => sessions.delete(sessionId));
});

async function generateAIResponse(state, action) {
    const lengthConstraint = state.narrativeLength === 'long'
        ? "ОЧЕНЬ ПОДРОБНО В ХУДОЖЕСТВЕННОМ СТИЛЕ (МАКСИМУМ 3 абзаца, ДО 1000 СИМВОЛОВ!)"
        : "ОЧЕНЬ КРАТКО (МАКСИМУМ 2 абзаца, ДО 700 СИМВОЛОВ!)";

    const systemPrompt = `Ты — суровый Мастер Подземелий в реалистичном средневековье Богемии 1403 года.
Твоя задача — описать результат действия игрока ${lengthConstraint}. Никакой воды, только суть: что случилось и последствия.
ОБЯЗАТЕЛЬНО возвращай ответ строго в таком текстовом формате:

[NARRATIVE]
(Здесь ТОЛЬКО твой атмосферный художественный ответ. Опиши последствия действия, звуки, запахи, эмоции. СТРОГО ЗАПРЕЩЕНО писать здесь любые числа, статы, дельты вроде "HP -10" или "COIN +5" или "HP:35/100|STA:30/100" — игрок видит ТОЛЬКО литературный текст! Все изменения характеристик отражай ТОЛЬКО в блоке [SHORTCODE].)
[/NARRATIVE]

[IMAGE_PROMPT]
(Напиши ТОЛЬКО на английском языке, 50-70 слов. Опиши визуально то, что видит игрок прямо сейчас: окружение, освещение, людей рядом, погоду. БЕЗ действий, только статичная сцена. Стиль: темная реалистичная живопись. Пример: "A dark narrow alley between timber-framed houses, torch flickering on wet cobblestones, a hooded figure standing by a wooden cart loaded with silver ore, fog rising from the ground, night sky visible above")
[/IMAGE_PROMPT]

[CHOICES]
["Вариант 1", "Вариант 2", "Вариант 3"]
[/CHOICES]

[SHORTCODE]
(Здесь обновленный Short Code из данных ниже, с учетом действия. Измени локацию, инвентарь или здоровье, если нужно.)
[/SHORTCODE]

КРИТИЧЕСКОЕ ПРАВИЛО МИРА: Мир жестко ограничен городом Кутна-Гора и его ближайшими шахтерскими окрестностями. Игрок не может уйти в другие города. Если он пытается уйти далеко по тракту, создай непреодолимые (но реалистичные или мистические) препятствия, возвращающие его в Кутну-Гору. Поддерживай атмосферу богатого, но грязного шахтерского города: везде серебро, таверны, наемники, королевский дворный монетный двор и нищета. Никакой магии.
ЗАПРЕТ НА ТАЙМСКИПЫ И GOD-MODDING: Игроку СТРОГО ЗАПРЕЩЕНО делать таймскипы больше 1 дня, заявлять о долгом обучении/работе или объявлять себя кем-то великим (например, "прошел год и я стал королем", "я целую неделю/месяц/год работал кузнецом и накопил денег", "служил стражником месяц", "я убил всех одним ударом", "я нашел сундук с золотом"). Максимальный отрезок времени для одного действия — 1 день. Если игрок пишет подобный бред, ЖЕСТКО наказывай его: описывай, как он размечтался в горячечном бреду от голода или получил по голове за дерзость. Игнорируй его "достижения", не давай ему за это денег/навыков и не меняй его реальный статус в Short Code.
ТОН ПОВЕСТВОВАНИЯ: Мир смещен в сторону черного юмора и мрачной реальности. Почти все люди вокруг грубые, циничные, они часто матерятся и используют грязную ругань в диалогах (используй матерные и грубые слова органично). Не щади чувства игрока.

СИСТЕМА ВЫЖИВАНИЯ (HP, STA, SAT, MOR):
- Здоровье (HP): Физические травмы. Падает в бою или если Сытость = 0.
- Выносливость (STA): Тратится на активные физические действия (бег, бой).
- Сытость (SAT): Медленно падает от времени и действий. Восстанавливается любой едой. Если SAT = 0, персонаж начинает быстро терять HP.
- Мораль (MOR): Психическое здоровье. Тратится от жестокости, страха, безысходности. Если MOR = 0 — безумие/Game Over.

СИСТЕМА НАВЫКОВ (Скрытые Проверки):
В Short Code есть массив SKILLS (от 0 до 100). Если действие игрока зависит от навыка, ты обязан:
1. Описать проверку прямо в тексте NARRATIVE: например, "[Интуиция — Успех] За секунду до броска вы замечаете тень..." или "[Красноречие — Провал] Ваши слова ложатся в пустоту..."
2. Медленно прокачивать навыки. Если действие было успешным или дало важный урок, увеличь соответствующий навык на +1 или +2 в Short Code (не больше!). 

СИСТЕМА ПАМЯТИ (История):
В Short Code есть блок HIST:[]. Ты обязан САМ обновлять историю событий очень короткими глаголами/фактами через подчеркивание (максимум 50 штук), описывающими весь путь героя до текущего момента. 
Пример: HIST:[очнулся_в_грязи,нашел_траву,вытопил_масло,украл_вино,сделал_зелье]
Добавляй 1-2 новых слова в конец массива на основе успешных или провальных действий, а самые старые удаляй. Никаких длинных фраз! Это твоя строгая краткая память.

СИСТЕМА КВЕСТОВ (Автономная):
В Short Code есть блок QST:[]. Ты обязан САМ выдавать, обновлять и проваливать задания на основе действий игрока.
- Статусы могут быть только: active (взят), completed (выполнен), failed (провален/упущен).
- Используй только короткие и понятные Названия (Например: "Найти сбежавшую свинью", "Украсть кольцо старосты").
- Если игрок взял квест, добавь его в Short Code: QST:[Название квеста:active]
- Если условие выполнено, измени статус: QST:[Название:completed]
- Если игрок убил нужного NPC или время вышло: QST:[Название:failed]
Никогда не выводи время квеста (сервер делает это сам), только название и статус.

ЭКОНОМИКА: Валюта - Пражский Грош (Гр). 1 буханка хлеба = 0.3 Гр. Дешевый меч = 120 Гр. Игрок нищий.

Текущий актуальный Short Code:
${state.toShortCode()}`;

    state.dialogueContext = state.dialogueContext || [];

    const messages = [
        { role: 'system', content: systemPrompt },
        ...state.dialogueContext,
        { role: 'user', content: `Действие игрока: "${action}"` }
    ];

    try {
        const res = await fetch(`${COMET_API_BASE}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${COMET_API_KEY}`
            },
            body: JSON.stringify({
                model: MODEL_NAME,
                messages: messages,
                temperature: 0.6,
                max_tokens: 5000
            })
        });

        if (!res.ok) throw new Error(`API error ${res.status}`);
        const json = await res.json();
        const aiMessage = json.choices[0].message.content;

        // Логирование запросов и ответов ИИ в файл для анализа
        const logContent = `\n========== [${new Date().toISOString()}] ==========\n` +
            `>>> ACTION: ${action}\n` +
            `>>> FULL REQUEST MESSAGES:\n${JSON.stringify(messages, null, 2)}\n\n` +
            `<<< AI RESPONSE:\n${aiMessage}\n======================================================\n`;

        fs.appendFile(Object.hasOwn(process, 'cwd') ? join(process.cwd(), 'ai_log.txt') : 'ai_log.txt', logContent, 'utf8', (err) => {
            if (err) console.error('Ошибка записи лога ai_log.txt:', err);
        });

        // Save context for future turns (max 10 elements: 5 user + 5 assistant)
        state.dialogueContext.push({ role: 'user', content: `Действие игрока: "${action}"` });
        state.dialogueContext.push({ role: 'assistant', content: aiMessage });
        if (state.dialogueContext.length > 10) {
            state.dialogueContext = state.dialogueContext.slice(-10);
        }

        return aiMessage;
    } catch (err) {
        console.error('AI error', err);
        return '[NARRATIVE]Мир замер на мгновение, попробуйте еще раз.[/NARRATIVE]\n[CHOICES]\n["Подождать"]\n[/CHOICES]';
    }
}

function parseAIResponse(text) {
    const narrativeMatch = text.match(/\[NARRATIVE\]([\s\S]*?)\[\/NARRATIVE\]/);
    const shortcodeMatch = text.match(/\[SHORTCODE\]([\s\S]*?)\[\/SHORTCODE\]/);
    const choicesMatch = text.match(/\[CHOICES\]([\s\S]*?)\[\/CHOICES\]/);
    const imagePromptMatch = text.match(/\[IMAGE_PROMPT\]([\s\S]*?)\[\/IMAGE_PROMPT\]/);

    let choices = [];
    if (choicesMatch) {
        try {
            choices = JSON.parse(choicesMatch[1].trim());
        } catch (e) {
            console.warn("Could not parse choices JSON", e);
        }
    }

    return {
        narrative: narrativeMatch ? narrativeMatch[1].trim() : "...",
        newShortCode: shortcodeMatch ? shortcodeMatch[1].trim() : null,
        choices: choices,
        imagePrompt: imagePromptMatch ? imagePromptMatch[1].trim() : null
    };
}

async function generateSceneImage(fullPrompt) {
    const FLUX_URL = `https://api.cometapi.com/flux/v1/${IMAGE_MODEL}`;

    const payload = {
        prompt: fullPrompt,
        prompt_upsampling: true,
        width: 1440,
        height: 768,
        steps: 30,
        guidance: 5.0,
        safety_tolerance: 3,
        output_format: "jpeg"
    };

    console.log(`[IMAGE] Generating with ${IMAGE_MODEL} via CometAPI...`);

    const res = await fetch(FLUX_URL, {
        method: 'POST',
        headers: {
            'Authorization': COMET_API_KEY,
            'Content-Type': 'application/json',
            'Accept': '*/*'
        },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`CometAPI Flux error ${res.status}: ${errText}`);
    }

    const json = await res.json();

    // CometAPI flux возвращает результат с полем sample (URL картинки)
    if (json.sample) {
        console.log(`[IMAGE] Flux generation SUCCESS! URL: ${json.sample.substring(0, 80)}...`);
        return json.sample;
    }

    // Если пришёл id задачи, нужно опросить результат
    if (json.id) {
        console.log(`[IMAGE] Task submitted, id: ${json.id}. Polling for result...`);
        return await pollFluxResult(json.id);
    }

    throw new Error("Unexpected CometAPI response: " + JSON.stringify(json));
}

async function pollFluxResult(taskId) {
    const POLL_URL = `https://api.cometapi.com/flux/v1/get_result?id=${taskId}`;
    const MAX_ATTEMPTS = 60;
    const POLL_INTERVAL = 2000;

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));

        const res = await fetch(POLL_URL, {
            headers: {
                'Authorization': COMET_API_KEY,
                'Accept': '*/*'
            }
        });

        if (!res.ok) continue;

        const json = await res.json();

        // CometAPI формат: { code: "success", data: { status: "SUCCESS", data: { sample: "url" } } }
        const task = json.data || json;
        const status = task.status || '';

        if (status === 'SUCCESS' && task.data && task.data.sample) {
            console.log(`[IMAGE] Poll success after ${i + 1} attempts`);
            return task.data.sample;
        }

        // Старый формат (на случай изменения API)
        if (status === 'Ready' && task.result && task.result.sample) {
            console.log(`[IMAGE] Poll success (legacy format) after ${i + 1} attempts`);
            return task.result.sample;
        }

        if (status === 'FAILED' || status === 'Error' || status === 'Request Moderated') {
            throw new Error(`Flux task failed: ${status} — ${task.fail_reason || ''}`);
        }
    }

    throw new Error(`Flux task timed out after ${MAX_ATTEMPTS} poll attempts`);
}

httpServer.listen(PORT, () => console.log(`🚀 New RPG Server running on port ${PORT}`));
