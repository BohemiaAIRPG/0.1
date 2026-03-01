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

                ws.send(JSON.stringify({
                    type: 'init',
                    state: state,
                    shortCode: state.toShortCode(),
                    message: narrative,
                    choices: choices
                }));

                const ENABLE_IMAGES = false; // ВРЕМЕННО ОТКЛЮЧЕНО
                if (ENABLE_IMAGES && imagePrompt) {
                    const fullPrompt = `${IMAGE_HISTORY_PREFIX} ${imagePrompt}`;
                    generateSceneImage(fullPrompt)
                        .then(imageUrl => ws.send(JSON.stringify({ type: 'image_update', imageUrl: imageUrl })))
                        .catch(() => ws.send(JSON.stringify({ type: 'image_update', imageUrl: null })));
                }

                return;
            }

            if (data.type === 'action') {

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

                const outData = {
                    type: 'update',
                    state: state,
                    shortCode: state.toShortCode(),
                    message: narrative,
                    choices: choices
                };

                // Отправляем текстовый ответ МГНОВЕННО
                ws.send(JSON.stringify(outData));

                // Асинхронно генерируем картинку и отправляем её позже
                const ENABLE_IMAGES = false; // ВРЕМЕННО ОТКЛЮЧЕНО. Измените на true, чтобы вернуть генерацию.
                if (ENABLE_IMAGES && imagePrompt) {
                    const fullPrompt = `${IMAGE_HISTORY_PREFIX} ${imagePrompt}`;
                    console.log(`[IMAGE] Prompt: ${fullPrompt.substring(0, 120)}...`);

                    generateSceneImage(fullPrompt)
                        .then(imageUrl => {
                            console.log(`[IMAGE] Generated and sent to client`);
                            ws.send(JSON.stringify({ type: 'image_update', imageUrl: imageUrl }));
                        })
                        .catch(imgErr => {
                            console.error('[IMAGE] Generation failed:', imgErr.message);
                            ws.send(JSON.stringify({ type: 'image_update', imageUrl: null })); // сообщаем об ошибке
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
                        choices: state.lastChoices || []
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
В Short Code есть блок HIST:[]. Ты обязан САМ обновлять историю событий очень короткими глаголами/фактами через подчеркивание (максимум 7-8 штук), описывающими весь путь героя до текущего момента. 
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

        // Save context for future turns (max 8 elements: 4 user + 4 assistant)
        state.dialogueContext.push({ role: 'user', content: `Действие игрока: "${action}"` });
        state.dialogueContext.push({ role: 'assistant', content: aiMessage });
        if (state.dialogueContext.length > 8) {
            state.dialogueContext = state.dialogueContext.slice(-8);
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

let _currentForgeModel = null; // кэш: не переключаем если уже стоит нужная

async function generateSceneImage(fullPrompt) {
    if (process.env.LOCAL_IMAGE_GENERATION === 'true') {
        const TARGET_MODEL = "chroma-flash-Q4_K_S.gguf";
        const CLIP_L = "clip_l.safetensors";
        const T5_ENCODER = "t5-v1_1-xxl-encoder-Q4_K_S.gguf";
        const VAE = "ae.safetensors";

        const payload = {
            prompt: fullPrompt,
            steps: 10,
            width: 1024,
            height: 576,
            sampler_name: "Euler",
            scheduler: "Simple",
            cfg_scale: 1.0,
            distilled_cfg_scale: 3.5,
            override_settings: {
                sd_model_checkpoint: TARGET_MODEL,
                forge_additional_modules: [CLIP_L, T5_ENCODER, VAE],
                forge_preset: "flux",
                flux_GPU_MB: 5500
            }
        };

        console.log(`[IMAGE] Generating with ${TARGET_MODEL}, T5, and VAE...`);

        const res = await fetch("http://127.0.0.1:7860/sdapi/v1/txt2img", {
            method: 'POST',
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Local Forge API error ${res.status}: ${errText}`);
        }

        const json = await res.json();
        if (json.images && json.images[0]) {
            console.log(`[IMAGE] Local Forge generation SUCCESS!`);
            return `data:image/png;base64,${json.images[0]}`;
        }
        throw new Error("No image in local API response");
    }

    const url = "https://api.cometapi.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent";

    const payload = {
        contents: [
            {
                role: "user",
                parts: [{ text: fullPrompt }]
            }
        ],
        generationConfig: {
            responseModalities: ["IMAGE"],
            // aspect_ratio не документировано в REST для Gemini, но попробуем добавить как в SDK
            // если что, модель по умолчанию выдает 1:1
        }
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            "x-goog-api-key": COMET_API_KEY, // Для gemini API ключ передаётся через этот заголовок (или через ?key=)
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini Image API error ${res.status}: ${errText}`);
    }

    const json = await res.json();

    // Ответ Gemini содержит структуру: { candidates: [ { content: { parts: [ { inlineData: { mimeType, data } } ] } } ] }
    try {
        const candidate = json.candidates[0];
        const part = candidate.content.parts[0];

        if (part.inlineData && part.inlineData.data) {
            const mimeType = part.inlineData.mimeType || "image/jpeg";
            const base64Data = part.inlineData.data;
            console.log(`[IMAGE] Gemini generation SUCCESS!`);
            return `data:${mimeType};base64,${base64Data}`;
        } else if (part.text) {
            throw new Error("Gemini returned text instead of image: " + part.text);
        } else {
            throw new Error("Gemini returned unknown part format: " + JSON.stringify(part));
        }
    } catch (parseErr) {
        console.error("[IMAGE] Failed to parse Gemini response:", JSON.stringify(json));
        throw new Error("Could not extract image from Gemini response");
    }
}

httpServer.listen(PORT, () => console.log(`🚀 New RPG Server running on port ${PORT}`));
