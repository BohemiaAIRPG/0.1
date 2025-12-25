import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { networkInterfaces } from 'os';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

// Modules
import { createGameState, applyChanges, applyWorldRules, resolveSkillCheck, updateTime, ensureGameStateIntegrity } from './modules/game.js';
import { requestAIResponse } from './modules/ai.js';
import { saveGame, loadGame, listSaves } from './modules/storage.js';
import { formatDescription } from './modules/utils.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// === MIDDLEWARE ===
app.use(cors());
app.use(express.static(process.cwd())); // Serve static files from root
app.use(express.json());

// === HTTP ROUTES ===
app.get('/', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'index.html'));
});

// Basic diagnostic
app.get('/status', (req, res) => {
    res.json({ status: 'ok', players: gameSessions.size });
});

// === WEBSOCKET SERVER ===
const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer });

// In-memory session store
const gameSessions = new Map();

// === WEBSOCKET LOGIC ===
wss.on('connection', (ws) => {
    const sessionId = Math.random().toString(36).substr(2, 9);
    console.log(`✅ Client connected, SessionID: ${sessionId} `);
    ws.sessionId = sessionId;
    ws.send(JSON.stringify({ type: 'connected', sessionId }));

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            const sessionId = ws.sessionId;

            // --- START NEW GAME ---
            if (data.type === 'start') {
                const gameState = createGameState(data.name || 'Странник', data.gender || 'male');
                gameSessions.set(sessionId, gameState);
                console.log(`🎮 Новая игра: ${gameState.name} (${gameState.gender}) [${sessionId}]`);

                const genderDesc = gameState.gender === 'female' ?
                    'Резкая боль пронзает всё тело. Вы медленно открываете глаза - перед вами грязная мостовая, лужи, конский навоз. Голова раскалывается. Вы лежите прямо на улице средневекового города, полностью голая и избитая. Тело покрыто ссадинами и грязью.' :
                    'Резкая боль пронзает всё тело. Вы медленно открываете глаза - перед вами грязная мостовая, лужи, конский навоз. Голова раскалывается. Вы лежите прямо на улице средневекового города, полностью голый и избитый. Тело покрыто ссадинами и грязью.';

                const introText = `[v0.8-Arch] ${genderDesc} Пытаясь сфокусировать взгляд, вы видите деревянные дома с соломенными крышами, повозки, толпу людей в грубой средневековой одежде. Они останавливаются, показывают на вас пальцем. [SPEECH]«Смотрите, еще один бродяга!»`;

                ws.send(JSON.stringify({
                    type: 'scene',
                    sessionId,
                    gameState,
                    description: formatDescription(introText),
                    choices: [
                        'Попытаться прикрыться руками и попросить помощи у прохожих',
                        'Быстро подняться и забежать в ближайший переулок',
                        'Осмотреться - может, рядом есть тряпки или выброшенная одежда'
                    ]
                }));
            }
            // --- PLAYER CHOICE ---
            else if (data.type === 'choice') {
                const gameState = gameSessions.get(sessionId);
                if (!gameState) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Session not found/expired' }));
                    return;
                }

                ws.send(JSON.stringify({ type: 'generating' }));

                const parsed = await requestAIResponse(gameState, data.choice, data.previousScene, 0, sessionId);

                // Game Logic Pipeline
                applyWorldRules(gameState, parsed);

                // --- DEATH CHECK (Health) ---
                const projectedHealth = Math.max(0, Math.min(gameState.maxHealth, gameState.health + (parsed.health || 0)));
                if (projectedHealth <= 0) {
                    if (!parsed.gameOver) {
                        parsed.gameOver = true;
                        parsed.deathReason = parsed.deathReason || 'Смерть от ран';
                        parsed.description += '\n\n(Ваши раны оказались смертельными. Сознание угасает...)';
                    }
                }

                applyChanges(gameState, parsed);

                // --- SKILL CHECK ---
                let resolvedCheck = null;
                if (parsed.skillCheck && typeof parsed.skillCheck === 'object' && parsed.skillCheck.key) {
                    resolvedCheck = resolveSkillCheck(gameState, parsed.skillCheck, sessionId);
                    if (resolvedCheck) {
                        // Apply check outcome overrides
                        const branch = resolvedCheck.success ? parsed.skillCheck.onSuccess : parsed.skillCheck.onFail;
                        if (branch && typeof branch === 'object') {
                            if (branch.description) parsed.description = branch.description;
                            if (branch.choices) parsed.choices = branch.choices;
                            if (branch.effects) parsed.effects = branch.effects;
                        }
                        // Visual feedback handled by client usually, but we can bake it into text/effects
                        parsed.effects = parsed.effects || [];
                        parsed.effects.unshift({
                            stat: 'timeChange',
                            delta: 0,
                            reason: `${resolvedCheck.success ? 'Успех' : 'Провал'} проверки ${resolvedCheck.key} (сл.${resolvedCheck.difficulty})`
                        });
                    }
                }

                // --- GAME OVER ---
                if (parsed.gameOver || gameState.health <= 0) {
                    ws.send(JSON.stringify({
                        type: 'gameOver',
                        sessionId,
                        deathReason: parsed.deathReason || 'Гибель',
                        description: formatDescription(parsed.description),
                        finalStats: {
                            daysPlayed: gameState.date.dayOfGame,
                            actions: gameState.history.length,
                            coins: gameState.coins,
                            reputation: gameState.reputation
                        }
                    }));
                    gameSessions.delete(sessionId);
                    return;
                }

                // Record history
                gameState.history.push({
                    choice: data.choice,
                    scene: parsed.description,
                    choices: parsed.choices || [],
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
            }
            // --- SAVE GAME ---
            else if (data.type === 'save') {
                const gameState = gameSessions.get(sessionId);
                if (gameState) {
                    const success = await saveGame(sessionId, gameState);
                    ws.send(JSON.stringify({ type: success ? 'saved' : 'error', message: success ? 'Игра сохранена!' : 'Ошибка сохранения' }));
                }
            }
            // --- LOAD GAME ---
            else if (data.type === 'load') {
                // If loading by specific ID (from list) or just generically logic?
                // data.sessionId might be the *target* save ID, different from ws.sessionId
                const targetId = data.sessionId || sessionId; // careful here if client sends target ID
                // Wait, client usually sends `gameState` directly for load? No, server implementation used to load from server.
                // Re-implementing logic:
                if (data.gameState) {
                    // Direct load (client sent state? No, usually server loads file)
                    // The old code had `data.type === 'load'` block that took `data.gameState` IF provided?
                    // Actually, let's keep it robust:
                    // If client says "load", it might mean "load this object I sent" or "load from disk".
                    // Let's assume disk for safety if sessionId is provided.
                }

                // If the message contains `gameState` (e.g. from file upload or legacy), use it.
                let loadedState = data.gameState;
                if (!loadedState && targetId) {
                    loadedState = await loadGame(targetId);
                }

                if (loadedState) {
                    ensureGameStateIntegrity(loadedState);
                    gameSessions.set(sessionId, loadedState);
                    ws.send(JSON.stringify({
                        type: 'loaded',
                        sessionId,
                        gameState: loadedState,
                        description: 'Игра загружена. Вы приходите в себя...',
                        choices: ['Осмотреться', 'Проверить снаряжение', 'Идти дальше']
                    }));
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Сохранение не найдено или повреждено' }));
                }
            }
            // --- LIST SAVES ---
            else if (data.type === 'listSaves') {
                const saves = await listSaves();
                ws.send(JSON.stringify({ type: 'savesList', saves }));
            }
            // --- CLIENT CLIENT UPDATES (Waypoints, etc) ---
            else if (data.type === 'clientUpdate') {
                const gameState = gameSessions.get(sessionId);
                if (gameState) {
                    if (data.patch && data.patch.mapWaypoint) {
                        gameState.mapWaypoint = data.patch.mapWaypoint;
                    }
                    ws.send(JSON.stringify({ type: 'clientUpdateAck', gameState }));
                }
            }

        } catch (error) {
            console.error('❌ WebSocket Error:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: `Server Error: ${error.message}`
            }));
        }
    });

    ws.on('close', () => {
        console.log(`🔌 Client disconnected: ${sessionId}`);
        gameSessions.delete(sessionId);
    });
});

// === START SERVER ===
httpServer.listen(PORT, () => {
    // Get Local IP
    const nets = networkInterfaces();
    let localIp = 'localhost';
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                localIp = net.address;
            }
        }
    }

    console.log('\x1b[36m%s\x1b[0m', '──────────────────────────────────────────');
    console.log(`🏰 \x1b[1mKINGDOM COME: AI RPG Server (Architecture v2)\x1b[0m`);
    console.log(`📡 Local:   http://localhost:${PORT}`);
    console.log(`🌍 Network: http://${localIp}:${PORT}`);
    console.log('\x1b[36m%s\x1b[0m', '──────────────────────────────────────────');
});
