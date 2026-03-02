// Глобальное состояние игры для каждого клиента
export class GameState {
    constructor() {
        this.name = "Бродяга";
        this.gender = "Мужчина";
        this.age = 25;
        this.location = "Кутна-Гора_Площадь";
        this.time = "День 1, 09:00";
        this.health = 35;
        this.maxHealth = 100;
        this.stamina = 30;
        this.maxStamina = 100;
        this.satiety = 80;
        this.maxSatiety = 100;
        this.coins = 0;
        this.reputation = 25;
        this.morality = 50;
        this.maxMorality = 100;
        this.skills = {
            "Выживание": 5, "Охота": 0, "Бой": 0, "Атлетика": 5,
            "Скрытность": 0, "Красноречие": 5, "Интуиция": 5,
            "Эмпатия": 10, "Интеллект": 5, "Ремесло": 0
        };
        this.inventory = [];
        this.equipment = { weapon: "нет", armor: "лохмотья" };
        this.profession = "нет"; // Added profession tracking
        this.relationships = {};
        this.history = ["очнулся_в_грязи", "амнезия"];
        this.quests = {}; // Format: { "Quest Name": { status: "active"|"completed"|"failed", startTime: "День 1, 09:00", endTime: null } }
        this.narrativeLength = "long"; // default "long", can be "short"
        this.lastNarrative = "";
        this.lastChoices = [];
    }

    // Восстановление состояния из JSON объекта
    fromJSON(data) {
        if (!data) return;
        Object.assign(this, data);

        // Backwards compatibility for old save files that didn't explicitly store lastNarrative/lastChoices
        if (!this.lastNarrative && this.dialogueContext && this.dialogueContext.length > 0) {
            // Find the last assistant message
            for (let i = this.dialogueContext.length - 1; i >= 0; i--) {
                if (this.dialogueContext[i].role === 'assistant') {
                    const content = this.dialogueContext[i].content;

                    const narrativeMatch = content.match(/\[NARRATIVE\]([\s\S]*?)\[\/NARRATIVE\]/);
                    const choicesMatch = content.match(/\[CHOICES\]([\s\S]*?)\[\/CHOICES\]/);

                    if (narrativeMatch) {
                        this.lastNarrative = narrativeMatch[1].trim();
                    }

                    if (choicesMatch) {
                        try {
                            this.lastChoices = JSON.parse(choicesMatch[1].trim());
                        } catch (e) {
                            console.warn("Could not parse choices JSON from old save", e);
                        }
                    }
                    break;
                }
            }
        }
    }

    // Генерация сжатого Short Code
    toShortCode() {
        const charInfo = `CHAR:[${this.name}|${this.gender}|${this.age}]`;
        const stats = `HP:${this.health}/${this.maxHealth}|STA:${this.stamina}/${this.maxStamina}|SAT:${this.satiety}/${this.maxSatiety}|COIN:${this.coins}|REP:${this.reputation}|MOR:${this.morality}/${this.maxMorality}|JOB:${this.profession.replace(/ /g, '_')}`;
        const eq = `EQ:[W:${this.equipment.weapon},A:${this.equipment.armor}]`;
        const inv = `INV:[${this.inventory.join(',')}]`;
        const rel = `REL:[${Object.entries(this.relationships).map(([k, v]) => `${k}:${v}`).join(',')}]`;
        const skillsObj = `SKILLS:[${Object.entries(this.skills).map(([k, v]) => `${k}:${v}`).join(',')}]`;
        const questsObj = `QST:[${Object.entries(this.quests).map(([k, v]) => `${k}:${v.status}`).join(',')}]`;
        const hist = `HIST:[${this.history.join(',')}]`;

        return `${charInfo}\nLOC:${this.location}|T:${this.time.replace(/ /g, '_')}|${stats}\n${skillsObj}\n${inv}|${eq}\n${rel}|${questsObj}\n${hist}`;
    }

    // Парсинг Short Code из ответа ИИ (ИИ должен прислать измененный блок внутри ответа)
    // Ожидает формат: 
    // START_STATE
    // LOC:...
    // ...
    // END_STATE
    // Но мы можем просить ИИ возвращать JSON дельты для простоты, или парсить прямо текст. 
    // В данном проекте просим ИИ обновлять ShortCode напрямую или присылать JSON. Давай остановимся на JSON-дельтах, а историю генерируем на сервере.
    // Если мы хотим жесткий Short Code, ИИ должен вернуть новый Short Code целиком!

    updateFromShortCode(newCodeText) {
        // Парсинг нового Short Code
        try {
            const lines = newCodeText.split('\n').map(l => l.trim()).filter(l => l);
            for (const line of lines) {
                if (line.startsWith('CHAR:[')) {
                    const charData = line.substring(6, line.length - 1).split('|');
                    if (charData.length === 3) {
                        this.name = charData[0];
                        this.gender = charData[1];
                        this.age = parseInt(charData[2]) || this.age;
                    }
                    continue; // Переходим к следующей строке, так как тут нет частей разделенных `|` без скобок
                }
                const parts = line.split('|');
                for (const p of parts) {
                    if (p.startsWith('LOC:')) this.location = p.substring(4).replace(/_/g, ' ');
                    else if (p.startsWith('T:')) this.time = p.substring(2).replace(/_/g, ' ');
                    else if (p.startsWith('HP:')) {
                        const h = p.substring(3).split('/');
                        const val = parseInt(h[0]);
                        const max = parseInt(h[1]);
                        if (!isNaN(val)) this.health = val;
                        if (!isNaN(max)) this.maxHealth = max;
                        this._clampStats();
                    }
                    else if (p.startsWith('STA:')) {
                        const s = p.substring(4).split('/');
                        const val = parseInt(s[0]);
                        const max = parseInt(s[1]);
                        if (!isNaN(val)) this.stamina = val;
                        if (!isNaN(max)) this.maxStamina = max;
                        this._clampStats();
                    }
                    else if (p.startsWith('SAT:')) {
                        const sat = p.substring(4).split('/');
                        const val = parseInt(sat[0]);
                        const max = parseInt(sat[1]);
                        if (!isNaN(val)) this.satiety = val;
                        if (!isNaN(max)) this.maxSatiety = max;
                        this._clampStats();
                    }
                    else if (p.startsWith('COIN:')) {
                        const val = parseFloat(p.substring(5));
                        if (!isNaN(val)) this.coins = val;
                    }
                    else if (p.startsWith('REP:')) {
                        const val = parseInt(p.substring(4));
                        if (!isNaN(val)) this.reputation = val;
                    }
                    else if (p.startsWith('MOR:')) {
                        const m = p.substring(4).split('/');
                        const val = parseInt(m[0]);
                        const max = parseInt(m[1]);
                        if (!isNaN(val)) this.morality = val;
                        if (!isNaN(max)) this.maxMorality = max;
                        this._clampStats();
                    }
                    else if (p.startsWith('JOB:')) {
                        this.profession = p.substring(4).replace(/_/g, ' ');
                    }
                    else if (p.startsWith('INV:[')) {
                        const items = p.substring(5, p.length - 1);
                        this.inventory = items ? items.split(',') : [];
                    }
                    else if (p.startsWith('EQ:[')) {
                        const eqData = p.substring(4, p.length - 1).split(',');
                        // Всегда сначала сбрасываем экипировку, чтобы при пустом EQ:[] она снялась
                        this.equipment.weapon = 'нет';
                        this.equipment.armor = 'нет';
                        if (eqData.length > 0 && eqData[0] !== '') {
                            for (const eqItem of eqData) {
                                if (eqItem.startsWith('W:')) this.equipment.weapon = eqItem.substring(2);
                                if (eqItem.startsWith('A:')) this.equipment.armor = eqItem.substring(2);
                            }
                        }
                    }
                    else if (p.startsWith('REL:[')) {
                        const rels = p.substring(5, p.length - 1);
                        this.relationships = {};
                        if (rels) {
                            rels.split(',').forEach(r => {
                                const [k, v] = r.split(':');
                                if (k && v !== undefined) {
                                    // Проверяем, число ли это. Если нет (как 'враждебен'), парсим как строку
                                    const parsedNum = parseInt(v);
                                    this.relationships[k] = isNaN(parsedNum) ? v : parsedNum;
                                }
                            });
                        }
                    }
                    else if (p.startsWith('SKILLS:[')) {
                        const skls = p.substring(8, p.length - 1);
                        if (skls) {
                            skls.split(',').forEach(r => {
                                const [k, v] = r.split(':');
                                if (k && v && Object.hasOwn(this.skills, k)) {
                                    this.skills[k] = parseInt(v) || this.skills[k];
                                }
                            });
                        }
                    }
                    else if (p.startsWith('QST:[')) {
                        const qstm = p.substring(5, p.length - 1);
                        if (qstm) {
                            qstm.split(',').forEach(q => {
                                const splitParams = q.split(':');
                                if (splitParams.length >= 2) {
                                    const rawKey = splitParams[0].trim().replace(/_/g, ' ');
                                    const val = splitParams[1].trim().toLowerCase();

                                    if (!this.quests[rawKey]) {
                                        this.quests[rawKey] = { status: val, startTime: this.time, endTime: null };
                                        if (val === 'completed' || val === 'failed') {
                                            this.quests[rawKey].endTime = this.time;
                                        }
                                    } else {
                                        if (this.quests[rawKey].status !== val) {
                                            this.quests[rawKey].status = val;
                                            if (val === 'completed' || val === 'failed') {
                                                this.quests[rawKey].endTime = this.quests[rawKey].endTime || this.time;
                                            }
                                        }
                                    }
                                }
                            });
                        }
                    }
                    else if (p.startsWith('HIST:[')) {
                        const histm = p.substring(6, p.length - 1);
                        if (histm) {
                            this.history = histm.split(',').map(s => s.trim().replace(/ /g, '_')).filter(s => s.length > 0).slice(-50);
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Ошибка парсинга Short Code', e);
        }
    }

    // Служебный метод для удержания статов в рамках [0, Max]
    _clampStats() {
        this.health = Math.min(this.maxHealth, Math.max(0, this.health));
        this.stamina = Math.min(this.maxStamina, Math.max(0, this.stamina));
        this.satiety = Math.min(this.maxSatiety || 100, Math.max(0, this.satiety));
        this.morality = Math.min(this.maxMorality || 100, Math.max(0, this.morality));
    }

    // Парсинг дельт прямо из текста (Например: "COIN +4, STA -20")
    // Используем oldState, чтобы точно применить дельту к предыдущему состоянию 
    // и перезаписать возможно старые/обновленные значения из ShortCode, избегая двойного начисления.
    applyNarrativeDeltas(text, oldState) {
        if (!text) return;
        const patterns = {
            HP: /HP\s*([+-]\d+)/gi,
            STA: /STA\s*([+-]\d+)/gi,
            SAT: /SAT\s*([+-]\d+)/gi,
            COIN: /COIN\s*([+-]\d+)/gi,
            REP: /REP\s*([+-]\d+)/gi,
            MOR: /MOR\s*([+-]\d+)/gi
        };

        const deltas = { HP: 0, STA: 0, SAT: 0, COIN: 0, REP: 0, MOR: 0 };
        const hasDelta = { HP: false, STA: false, SAT: false, COIN: false, REP: false, MOR: false };

        for (const [key, regex] of Object.entries(patterns)) {
            let match;
            while ((match = regex.exec(text)) !== null) {
                deltas[key] += parseInt(match[1]);
                hasDelta[key] = true;
            }
        }

        if (oldState) {
            if (hasDelta['HP']) this.health = oldState.health + deltas['HP'];
            if (hasDelta['STA']) this.stamina = oldState.stamina + deltas['STA'];
            if (hasDelta['SAT']) this.satiety = oldState.satiety + deltas['SAT'];
            if (hasDelta['COIN']) this.coins = oldState.coins + deltas['COIN'];
            if (hasDelta['REP']) this.reputation = oldState.reputation + deltas['REP'];
            if (hasDelta['MOR']) this.morality = oldState.morality + deltas['MOR'];
        } else {
            // Фолбэк, если oldState не передан
            if (hasDelta['HP']) this.health += deltas['HP'];
            if (hasDelta['STA']) this.stamina += deltas['STA'];
            if (hasDelta['SAT']) this.satiety += deltas['SAT'];
            if (hasDelta['COIN']) this.coins += deltas['COIN'];
            if (hasDelta['REP']) this.reputation += deltas['REP'];
            if (hasDelta['MOR']) this.morality += deltas['MOR'];
        }

        this._clampStats();
    }
}
