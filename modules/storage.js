import { promises as fs } from 'fs';
import { join } from 'path';

// Путь к папке сохранений
const SAVES_DIR = join(process.cwd(), 'saves');
const AI_ERROR_LOG = join(process.cwd(), 'ai_errors.log');

// Создаем папку для сохранений, если её нет
(async () => {
    try {
        await fs.mkdir(SAVES_DIR, { recursive: true });
    } catch (error) {
        console.error('Error creating saves directory:', error);
    }
})();

export async function saveGame(sessionId, gameState) {
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

export async function loadGame(sessionId) {
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

export async function listSaves() {
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

export async function logAIParseFailure(sessionId, choice, attempt, rawResponse, errorMessage) {
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
