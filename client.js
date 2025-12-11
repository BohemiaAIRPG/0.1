let ws;
let gameState = null;
let currentScene = '';
let currentChoices = [];
let currentSessionId = null;
let lastEffects = [];
let lastCheckResult = null;

// === GLOBAL ERROR HANDLERS ===
// Catch any unhandled errors and log them instead of crashing
window.onerror = function (message, source, lineno, colno, error) {
    console.error('🔴 Global Error:', { message, source, lineno, colno, error });
    return true; // Prevent default browser error handling
};

window.onunhandledrejection = function (event) {
    console.error('🔴 Unhandled Promise Rejection:', event.reason);
    event.preventDefault();
};

// Safe DOM query helper
function safeGetElement(id) {
    const el = document.getElementById(id);
    if (!el) console.warn(`⚠️ Element #${id} not found`);
    return el;
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Client initialized');

    // Проверка на восстановление сессии
    const savedSessionId = localStorage.getItem('gameSessionId');
    if (savedSessionId) {
        console.log('Found saved session, attempting to restore...');
        // restoreSession(savedSessionId); // Пока просто логируем, старт через кнопку
    }
});

function startGame() {
    const playerName = document.getElementById('playerName').value.trim() || 'Странник';
    const playerGender = document.getElementById('playerGender').value || 'male';

    console.log(`🎮 Начало игры: ${playerName} (${playerGender})`);

    // Очищаем старое сохранение при старте новой игры
    clearLocalStorageSave();

    // Подключение к WebSocket (автоопределение хоста)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    ws = new WebSocket(`${protocol}//${host}`);

    ws.onopen = () => {
        console.log('Connected to server');
        ws.send(JSON.stringify({
            type: 'start',
            name: playerName,
            gender: playerGender
        }));
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        // Сохраняем sessionId из ответа сервера
        if (data.sessionId) {
            currentSessionId = data.sessionId;
        }

        handleMessage(data);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        alert('Ошибка подключения к серверу!');
    };

    ws.onclose = () => {
        console.log('Disconnected from server');
    };

    // Показываем игровой экран
    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');

    setTimeout(() => {
        initModalHandlers(); // Replaces initTabHandlers
        initCustomChoiceHandlers();
        initHistoryModal();
        initMapHandlers();
        initInventoryHandlers();
        initSaveLoadHandlers();
    }, 100);
}

// Map System
let mapScale = 1.0;
let mapOffsetX = 0;
let mapOffsetY = 0;
let isDraggingMap = false;
let startDragX, startDragY;
let hoveredLocation = null; // Track what we are hovering over
let selectedMapLocation = null; // Selected location for details panel
let didDragMap = false;

function initMapHandlers() {
    const mapBtn = document.getElementById('mapBtn');
    const mapModal = document.getElementById('mapModal');
    const closeMapModal = document.getElementById('closeMapModal');
    const canvas = document.getElementById('worldMapCanvas');
    const detailsPanel = document.getElementById('mapDetailsPanel');
    const closeDetailsBtn = document.getElementById('closeMapDetailsBtn');
    const setWaypointBtn = document.getElementById('mapSetWaypointBtn');
    const goToNpcBtn = document.getElementById('mapGoToNpcBtn');

    if (!mapBtn || !mapModal || !canvas) return;

    mapBtn.addEventListener('click', () => {
        mapModal.classList.remove('hidden');
        selectedMapLocation = null;
        if (detailsPanel) detailsPanel.classList.add('hidden');
        drawMap();
    });

    closeMapModal.addEventListener('click', () => {
        mapModal.classList.add('hidden');
    });

    if (closeDetailsBtn && detailsPanel) {
        closeDetailsBtn.addEventListener('click', () => {
            selectedMapLocation = null;
            detailsPanel.classList.add('hidden');
            drawMap();
        });
    }

    if (setWaypointBtn) {
        setWaypointBtn.addEventListener('click', () => {
            if (!selectedMapLocation) return;
            setMapWaypoint(selectedMapLocation);
        });
    }

    if (goToNpcBtn) {
        goToNpcBtn.addEventListener('click', () => {
            const body = document.getElementById('mapDetailsBody');
            if (body) body.scrollTop = 0;
        });
    }

    // Zoom
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomIntensity = 0.1;
        mapScale += e.deltaY * -zoomIntensity * 0.01;
        mapScale = Math.min(Math.max(.5, mapScale), 5); // Limit zoom
        drawMap();
    });

    // Drag & Hover
    canvas.addEventListener('mousedown', (e) => {
        isDraggingMap = true;
        startDragX = e.clientX - mapOffsetX;
        startDragY = e.clientY - mapOffsetY;
        canvas.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
        if (isDraggingMap) {
            mapOffsetX = e.clientX - startDragX;
            mapOffsetY = e.clientY - startDragY;
            didDragMap = true;
            drawMap();
            return;
        }

        // Hover Check
        if (gameState && gameState.worldMap && canvas) {
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const centerX = rect.width / 2 + mapOffsetX;
            const centerY = rect.height / 2 + mapOffsetY;

            let found = null;
            // Check locations (reverse to catch top-most if overlap)
            for (let i = gameState.worldMap.length - 1; i >= 0; i--) {
                const loc = gameState.worldMap[i];
                const x = centerX + (loc.x * 30 * mapScale); // 30px spacing
                const y = centerY + (loc.y * 30 * mapScale);
                const size = 20 * mapScale; // Hitbox radius

                const dist = Math.sqrt((mouseX - x) ** 2 + (mouseY - y) ** 2);
                if (dist < size) {
                    found = loc;
                    break;
                }
            }

            if (hoveredLocation !== found) {
                hoveredLocation = found;
                canvas.style.cursor = found ? 'pointer' : 'default';
                drawMap();
            }
        }
    });

    window.addEventListener('mouseup', () => {
        isDraggingMap = false;
        canvas.style.cursor = 'default';
        // Small delay so click after drag doesn't trigger selection
        setTimeout(() => { didDragMap = false; }, 0);
    });

    // Click to select location
    canvas.addEventListener('click', (e) => {
        if (didDragMap) return;
        const loc = getLocationAtMouse(e, canvas);
        if (loc) {
            selectedMapLocation = loc;
            renderMapDetails(loc);
            if (detailsPanel) detailsPanel.classList.remove('hidden');
            drawMap();
        }
    });
}

function getLocationAtMouse(e, canvas) {
    if (!gameState || !gameState.worldMap || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const centerX = rect.width / 2 + mapOffsetX;
    const centerY = rect.height / 2 + mapOffsetY;

    for (let i = gameState.worldMap.length - 1; i >= 0; i--) {
        const loc = gameState.worldMap[i];
        const x = centerX + (loc.x * 30 * mapScale);
        const y = centerY + (loc.y * 30 * mapScale);
        const size = 20 * mapScale;
        const dist = Math.sqrt((mouseX - x) ** 2 + (mouseY - y) ** 2);
        if (dist < size) return loc;
    }
    return null;
}

function sendClientUpdate(patch) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'clientUpdate', patch }));
}

function setMapWaypoint(loc) {
    const waypoint = { locationId: loc.id || null, name: loc.name || '' };
    if (!gameState) return;
    if (!gameState.mapWaypoint) gameState.mapWaypoint = { locationId: null, name: '' };

    // optimistic update
    gameState.mapWaypoint.locationId = waypoint.locationId;
    gameState.mapWaypoint.name = waypoint.name;
    sendClientUpdate({ mapWaypoint: waypoint });
}

function renderMapDetails(loc) {
    const panel = document.getElementById('mapDetailsPanel');
    const title = document.getElementById('mapDetailsTitle');
    const subtitle = document.getElementById('mapDetailsSubtitle');
    const body = document.getElementById('mapDetailsBody');
    const setWaypointBtn = document.getElementById('mapSetWaypointBtn');
    const goToNpcBtn = document.getElementById('mapGoToNpcBtn');

    if (!panel || !title || !subtitle || !body) return;

    title.textContent = loc.name || 'Локация';
    subtitle.textContent = `${loc.type || 'место'} • X:${loc.x}, Y:${loc.y}`;

    const edges = (gameState.worldEdges || []).filter(e => e.fromId === loc.id || e.toId === loc.id);
    const connections = edges
        .map(e => (e.fromId === loc.id ? e.toId : e.fromId))
        .map(id => (gameState.worldMap || []).find(l => l.id === id))
        .filter(Boolean);

    const route = computeRoute(gameState, gameState.playerPos?.locationId, loc.id);
    const routeHtml = route ? renderRouteSummary(gameState, route) : `<div style="color:#666; font-style:italic;">Маршрут неизвестен (нет связей)</div>`;

    const npcsHere = [];
    if (gameState && gameState.npcs) {
        Object.values(gameState.npcs).forEach(n => {
            if (!n) return;
            if (n.lastSeen?.locationId && loc.id && n.lastSeen.locationId === loc.id) npcsHere.push(n);
            else if (n.lastSeen?.locationName && loc.name) {
                const a = String(n.lastSeen.locationName).toLowerCase();
                const b = String(loc.name).toLowerCase();
                if (a.includes(b) || b.includes(a)) npcsHere.push(n);
            }
        });
    }

    const factionLine = (n) => n.faction ? `<span style="color:#ffd700;">${n.faction}</span>` : '';
    const dispLine = (n) => (typeof n.disposition === 'number') ? ` • disp: <span style="color:${n.disposition >= 25 ? '#8BC34A' : (n.disposition <= -25 ? '#FF9800' : '#9e9e9e')}; font-weight:700;">${n.disposition}</span>` : '';

    body.innerHTML = `
        <div style="color:#ccc; line-height:1.5;">
            <div style="margin-bottom:10px; color:#888; font-size:0.9em;">${loc.description ? loc.description : 'Описание отсутствует.'}</div>
            <div style="margin-bottom:12px;">
                <strong style="color:#4a90e2;">Маршрут</strong>
                <div style="margin-top:6px;">${routeHtml}</div>
            </div>
            <div style="margin-bottom:12px;">
                <strong style="color:#4a90e2;">Связи</strong>
                <div style="margin-top:6px; display:flex; flex-direction:column; gap:6px;">
                    ${connections.length ? connections.map(c => `<div style="background: rgba(255,255,255,0.03); padding:8px; border-radius:8px; border:1px solid rgba(255,255,255,0.08);">${c.name}</div>`).join('') : `<div style="color:#666; font-style:italic;">Нет известных путей</div>`}
                </div>
            </div>
            <div>
                <strong style="color:#ffd700;">NPC здесь</strong>
                <div style="margin-top:6px; display:flex; flex-direction:column; gap:6px;">
                    ${npcsHere.length ? npcsHere.map(n => `<div style="background: rgba(255,215,0,0.06); padding:8px; border-radius:8px; border:1px solid rgba(255,215,0,0.15);">
                        <div style="display:flex; justify-content:space-between; gap:10px;">
                            <span style="color:#ffd700; font-weight:600;">${n.name}</span>
                            <span style="color:#aaa; font-size:0.85em;">${n.role || ''}</span>
                        </div>
                        <div style="color:#bbb; font-size:0.9em; margin-top:2px;">${n.status || ''}</div>
                        <div style="color:#888; font-size:0.85em; margin-top:2px;">${factionLine(n)}${dispLine(n)}</div>
                    </div>`).join('') : `<div style="color:#666; font-style:italic;">Пока никого не замечено</div>`}
                </div>
            </div>
        </div>
    `;

    if (setWaypointBtn) setWaypointBtn.disabled = !loc.id;
    if (goToNpcBtn) goToNpcBtn.disabled = npcsHere.length === 0;
}

function openMapToLocation(locationId, locationName) {
    const mapModal = document.getElementById('mapModal');
    const detailsPanel = document.getElementById('mapDetailsPanel');
    if (!mapModal) return;

    mapModal.classList.remove('hidden');

    let loc = null;
    if (gameState && Array.isArray(gameState.worldMap)) {
        if (locationId) {
            loc = gameState.worldMap.find(l => l.id === locationId) || null;
        }
        if (!loc && locationName) {
            const n = String(locationName).toLowerCase();
            loc = gameState.worldMap.find(l => l.name && (l.name.toLowerCase() === n || l.name.toLowerCase().includes(n) || n.includes(l.name.toLowerCase()))) || null;
        }
    }

    if (loc) {
        selectedMapLocation = loc;
        renderMapDetails(loc);
        if (detailsPanel) detailsPanel.classList.remove('hidden');
    }
    drawMap();
}

function edgeCost(kind) {
    const k = String(kind || 'path').toLowerCase();
    if (k.includes('road') || k.includes('дорог')) return 1.0;
    if (k.includes('path') || k.includes('троп')) return 1.2;
    if (k.includes('forest') || k.includes('лес')) return 1.6;
    if (k.includes('river') || k.includes('река')) return 2.0;
    if (k.includes('mount') || k.includes('перев')) return 2.2;
    return 1.2;
}

function computeRoute(state, fromId, toId) {
    if (!state || !Array.isArray(state.worldEdges) || !Array.isArray(state.worldMap)) return null;
    if (!fromId || !toId || fromId === toId) return null;

    const nodes = new Set(state.worldMap.map(l => l.id).filter(Boolean));
    if (!nodes.has(fromId) || !nodes.has(toId)) return null;

    const adj = new Map();
    state.worldEdges.forEach(e => {
        if (!e || !e.fromId || !e.toId) return;
        if (!adj.has(e.fromId)) adj.set(e.fromId, []);
        if (!adj.has(e.toId)) adj.set(e.toId, []);
        const cost = edgeCost(e.kind);
        adj.get(e.fromId).push({ to: e.toId, cost, kind: e.kind });
        adj.get(e.toId).push({ to: e.fromId, cost, kind: e.kind });
    });

    const dist = new Map();
    const prev = new Map();
    const visited = new Set();

    nodes.forEach(id => dist.set(id, Infinity));
    dist.set(fromId, 0);

    // Simple Dijkstra without heap (maps are small)
    while (true) {
        let u = null;
        let best = Infinity;
        for (const [id, d] of dist.entries()) {
            if (visited.has(id)) continue;
            if (d < best) { best = d; u = id; }
        }
        if (u === null) break;
        if (u === toId) break;
        visited.add(u);
        const neighbors = adj.get(u) || [];
        neighbors.forEach(n => {
            const alt = best + n.cost;
            if (alt < (dist.get(n.to) ?? Infinity)) {
                dist.set(n.to, alt);
                prev.set(n.to, { from: u, kind: n.kind, cost: n.cost });
            }
        });
    }

    if (!prev.has(toId)) return null;
    const pathIds = [toId];
    let cur = toId;
    const legs = [];
    while (cur !== fromId) {
        const p = prev.get(cur);
        if (!p) break;
        legs.push({ from: p.from, to: cur, kind: p.kind, cost: p.cost });
        cur = p.from;
        pathIds.push(cur);
    }
    pathIds.reverse();
    legs.reverse();
    return { fromId, toId, pathIds, legs, totalCost: dist.get(toId) };
}

function renderRouteSummary(state, route) {
    const names = route.pathIds.map(id => (state.worldMap.find(l => l.id === id)?.name || id));
    const hours = Math.max(1, Math.ceil((route.totalCost || 0) * 1.0));
    const staminaCost = Math.ceil((route.totalCost || 0) * 6);
    const kindHint = route.legs.map(l => l.kind || 'path').slice(0, 3).join(', ');

    return `
        <div style="background: rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:10px;">
            <div style="display:flex; justify-content:space-between; gap:10px; margin-bottom:6px;">
                <span style="color:#ccc;">Путь: ${names.join(' → ')}</span>
            </div>
            <div style="color:#888; font-size:0.9em;">
                Оценка: ~${hours} ч • Выносливость: -${staminaCost}${kindHint ? ` • Типы: ${kindHint}` : ''}
            </div>
        </div>
    `;
}

function initModalHandlers() {
    // Character Modal
    setupModal('characterBtn', 'characterModal', 'closeCharacterModal', () => updateCharacter());

    // Skills Modal
    setupModal('skillsBtn', 'skillsModal', 'closeSkillsModal', () => updateSkills());

    // Inventory Modal
    setupModal('inventoryBtn', 'inventoryModal', 'closeInventoryModal', () => updateInventory());
}

function setupModal(btnId, modalId, closeBtnId, onOpenCallback) {
    const btn = document.getElementById(btnId);
    const modal = document.getElementById(modalId);
    const closeBtn = document.getElementById(closeBtnId);

    if (btn && modal) {
        btn.addEventListener('click', () => {
            modal.classList.remove('hidden');
            if (onOpenCallback) onOpenCallback();
        });
    }

    if (closeBtn && modal) {
        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
        });
    }

    // Close on click outside
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });
    }
}

function getMarkerIcon(name) {
    const lower = name.toLowerCase();
    // Entertainment / Social
    if (lower.includes('корчма') || lower.includes('таверна') || lower.includes('трактир')) return '🍺';
    if (lower.includes('бордель') || lower.includes('купальн')) return '🛁';

    // Trade / Craft
    if (lower.includes('конюшня') || lower.includes('лошад')) return '🐎';
    if (lower.includes('рынок') || lower.includes('лавк') || lower.includes('торг')) return '💰';
    if (lower.includes('кузн')) return '⚒️';
    if (lower.includes('оружей') || lower.includes('брон')) return '⚔️';
    if (lower.includes('портн') || lower.includes('одежд')) return '🧵';
    if (lower.includes('алхим') || lower.includes('зель')) return '⚗️';
    if (lower.includes('мельниц')) return '🥖';

    // Knowledge / Religion
    if (lower.includes('церковь') || lower.includes('храм') || lower.includes('монастыр')) return '⛪';
    if (lower.includes('библиотек') || lower.includes('книг') || lower.includes('писар')) return '📜';
    if (lower.includes('ратуша') || lower.includes('суд')) return '⚖️';

    // Nature / World
    if (lower.includes('лес') || lower.includes('чаща') || lower.includes('роща')) return '🌲';
    if (lower.includes('река') || lower.includes('озеро') || lower.includes('пруд')) return '💧';
    if (lower.includes('пещер') || lower.includes('грот')) return '🦇';
    if (lower.includes('лагерь') || lower.includes('костер')) return '⛺';
    if (lower.includes('руин') || lower.includes('развалин')) return '🏛️';

    // Buildings
    if (lower.includes('замок') || lower.includes('крепость')) return '🏰';
    if (lower.includes('башня')) return '🗼';
    if (lower.includes('дом') || lower.includes('хижина')) return '🏠';
    if (lower.includes('тюрьм') || lower.includes('темниц')) return '⛓️';

    // Special
    if (lower.includes('начало')) return '🔵';
    if (lower.includes('кладбищ') || lower.includes('могил')) return '🪦';

    return '📍'; // Default
}

function drawMap() {
    const canvas = document.getElementById('worldMapCanvas');
    if (!canvas || !gameState || !gameState.worldMap) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.parentElement.clientWidth;
    const cssH = canvas.parentElement.clientHeight;
    canvas.width = Math.max(1, Math.floor(cssW * dpr));
    canvas.height = Math.max(1, Math.floor(cssH * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels

    const centerX = cssW / 2 + mapOffsetX;
    const centerY = cssH / 2 + mapOffsetY;

    // Clear
    ctx.clearRect(0, 0, cssW, cssH);

    // Draw connections first (routes)
    if (Array.isArray(gameState.worldEdges) && gameState.worldEdges.length > 0) {
        ctx.lineWidth = Math.max(1, 2 * mapScale);
        ctx.strokeStyle = 'rgba(200, 200, 200, 0.18)';
        gameState.worldEdges.forEach(edge => {
            const from = gameState.worldMap.find(l => l.id === edge.fromId);
            const to = gameState.worldMap.find(l => l.id === edge.toId);
            if (!from || !to) return;
            const x1 = centerX + (from.x * 30 * mapScale);
            const y1 = centerY + (from.y * 30 * mapScale);
            const x2 = centerX + (to.x * 30 * mapScale);
            const y2 = centerY + (to.y * 30 * mapScale);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        });
    }

    // Draw locations
    gameState.worldMap.forEach(loc => {
        const x = centerX + (loc.x * 30 * mapScale);
        const y = centerY + (loc.y * 30 * mapScale);

        // Selected ring
        if (selectedMapLocation && selectedMapLocation.id && loc.id && selectedMapLocation.id === loc.id) {
            ctx.strokeStyle = 'rgba(74, 144, 226, 0.9)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(x, y, 16 * mapScale, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Draw Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        ctx.arc(x, y + 5 * mapScale, 10 * mapScale, 0, Math.PI * 2);
        ctx.fill();

        // Draw Icon
        const icon = getMarkerIcon(loc.name);
        ctx.fillStyle = '#ffffff';
        ctx.font = `${24 * mapScale}px "Segoe UI Emoji", "Arial"`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(icon, x, y);
    });

    // Draw Player Arrow
    let playerX = centerX;
    let playerY = centerY;

    // Prefer explicit player position from server
    if (gameState.playerPos && typeof gameState.playerPos.x === 'number' && typeof gameState.playerPos.y === 'number') {
        playerX = centerX + (gameState.playerPos.x * 30 * mapScale);
        playerY = centerY + (gameState.playerPos.y * 30 * mapScale);
    }

    ctx.fillStyle = '#ff4444';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playerX, playerY - 8 * mapScale); // Tip (up)
    ctx.lineTo(playerX - 6 * mapScale, playerY + 6 * mapScale); // Left
    ctx.lineTo(playerX, playerY + 3 * mapScale); // Notch
    ctx.lineTo(playerX + 6 * mapScale, playerY + 6 * mapScale); // Right
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Player Label "ВЫ"
    ctx.fillStyle = '#ff4444';
    ctx.font = `bold ${12 * mapScale}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 4;
    ctx.fillText("ВЫ", playerX, playerY - 15 * mapScale);
    ctx.shadowBlur = 0; // Reset shadow

    // Waypoint marker
    if (gameState.mapWaypoint && gameState.mapWaypoint.locationId) {
        const wLoc = gameState.worldMap.find(l => l.id === gameState.mapWaypoint.locationId);
        if (wLoc) {
            const wx = centerX + (wLoc.x * 30 * mapScale);
            const wy = centerY + (wLoc.y * 30 * mapScale);
            ctx.fillStyle = '#ffd700';
            ctx.font = `${22 * mapScale}px "Segoe UI Emoji", "Arial"`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('📌', wx + 18 * mapScale, wy - 18 * mapScale);
        }
    }

    // Draw Tooltip if hovering
    if (hoveredLocation) {
        const loc = hoveredLocation;
        const x = centerX + (loc.x * 30 * mapScale);
        const y = centerY + (loc.y * 30 * mapScale);

        const padding = 10;
        const fontSize = 14;
        ctx.font = `bold ${fontSize}px "Segoe UI", sans-serif`;
        const textWidth = ctx.measureText(loc.name).width;

        // Tooltip description? (Optional, just name for now to keep it clean)
        // const desc = loc.description || ""; 

        let tooltipLines = [loc.name];

        // Найдем NPC в этой локации
        if (gameState.character && gameState.character.npcLocations) {
            const locNameLower = loc.name.toLowerCase();
            const npcsHere = Object.entries(gameState.character.npcLocations)
                .filter(([name, npcLoc]) => npcLoc.toLowerCase().includes(locNameLower) || locNameLower.includes(npcLoc.toLowerCase()))
                .map(([name]) => name);

            if (npcsHere.length > 0) {
                npcsHere.forEach(npcName => {
                    tooltipLines.push(`👤 ${npcName}`);
                    // Если есть отношения, покажем их
                    if (gameState.character.relationships && gameState.character.relationships[npcName]) {
                        const rel = gameState.character.relationships[npcName];
                        const relStr = typeof rel === 'string'
                            ? rel
                            : (rel && typeof rel === 'object'
                                ? [rel.role, rel.status, (typeof rel.disposition === 'number' ? `disp:${rel.disposition}` : '')].filter(Boolean).join(', ')
                                : '');
                        const shortRel = relStr.length > 40 ? relStr.substring(0, 40) + '...' : relStr;
                        tooltipLines.push(`   "${shortRel}"`);
                    }
                });
            }
        }

        ctx.font = `bold ${fontSize}px "Segoe UI", sans-serif`;

        // Calculate dimensions
        let maxWidth = 0;
        tooltipLines.forEach(line => {
            const w = ctx.measureText(line).width;
            if (w > maxWidth) maxWidth = w;
        });

        const boxWidth = maxWidth + padding * 3;
        const lineHeight = fontSize + 6;
        const boxHeight = (tooltipLines.length * lineHeight) + padding * 2;

        const boxX = x - boxWidth / 2;
        const boxY = y - 40 * mapScale - boxHeight; // Above marker

        // Box Background
        ctx.fillStyle = 'rgba(20, 20, 20, 0.95)';
        ctx.strokeStyle = '#4a90e2';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 5);
        ctx.fill();
        ctx.stroke();

        // Draw Lines
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        let currentY = boxY + padding;
        tooltipLines.forEach((line, index) => {
            if (index === 0) {
                // Title
                ctx.fillStyle = '#ffffff';
                ctx.font = `bold ${fontSize}px "Segoe UI", sans-serif`;
            } else if (line.startsWith('👤')) {
                // NPC Name
                ctx.fillStyle = '#ffd700'; // Gold
                ctx.font = `${fontSize}px "Segoe UI", sans-serif`;
            } else {
                // Relationship text
                ctx.fillStyle = '#cccccc'; // Grey
                ctx.font = `italic ${fontSize - 2}px "Segoe UI", sans-serif`;
            }
            ctx.fillText(line, boxX + padding, currentY);
            currentY += lineHeight;
        });

        // Triangle pointer
        ctx.beginPath();
        ctx.moveTo(x, boxY + boxHeight);
        ctx.lineTo(x - 5, boxY + boxHeight + 5);
        ctx.lineTo(x + 5, boxY + boxHeight + 5);
        ctx.fillStyle = '#4a90e2';
        ctx.fill();
    }

    // Update Coords UI
    const pos = gameState.playerPos ? `${gameState.playerPos.x}, ${gameState.playerPos.y}` : '?, ?';
    document.getElementById('mapCoordinates').textContent = `Scale: ${mapScale.toFixed(1)}x • Вы: ${pos}`;
}

function handleMessage(data) {
    console.log('📨 Получено сообщение:', data.type);

    if (data.type === 'connected') {
        currentSessionId = data.sessionId;
        console.log(`🔗 Подключено к серверу, SessionID: ${currentSessionId}`);
    } else if (data.type === 'scene') {
        console.log('🎬 Received scene data:', {
            hasGameState: !!data.gameState,
            hasDescription: !!data.description,
            descLength: data.description?.length,
            choicesCount: data.choices?.length
        });

        gameState = data.gameState;
        currentScene = data.description;
        currentChoices = data.choices;
        lastEffects = Array.isArray(data.effects) ? data.effects : [];
        lastCheckResult = data.checkResult || null;

        console.log('📊 About to call updateUI and displayScene...');
        saveGameToLocalStorage();
        updateUI();
        console.log('✅ updateUI completed');

        displayScene(currentScene, currentChoices, data.isDialogue, data.speakerName, lastEffects, lastCheckResult);
        console.log('✅ displayScene completed');

        hideLoading();
    } else if (data.type === 'generating') {
        showLoading();
    } else if (data.type === 'loaded') {
        // Обработка загруженного сохранения
        currentSessionId = data.sessionId; // КРИТИЧЕСКИ ВАЖНО!
        gameState = data.gameState;
        currentScene = data.description;
        currentChoices = data.choices;
        lastEffects = [];
        lastCheckResult = null;

        console.log('✅ Сохранение успешно загружено и восстановлено!');
        console.log(`🔗 SessionID обновлен: ${currentSessionId}`);

        saveGameToLocalStorage();
        updateUI();
        displayScene(currentScene, currentChoices, false, '', lastEffects, lastCheckResult);
        hideLoading();
    } else if (data.type === 'clientUpdateAck') {
        // Server accepted client-side state patch (e.g., waypoint)
        if (data.gameState) {
            gameState = data.gameState;
            saveGameToLocalStorage();
            updateUI();
            // If map is open, refresh
            if (!document.getElementById('mapModal')?.classList.contains('hidden')) {
                drawMap();
            }
        }
    } else if (data.type === 'gameOver') {
        hideLoading();
        showGameOver(data);
    } else if (data.type === 'error') {
        hideLoading();
        console.error('❌ Ошибка от сервера:', data.message);
        alert('❌ Ошибка от сервера:\n\n' + data.message);
    }
}

function showGameOver(data) {
    console.log('💀 GAME OVER:', data.deathReason);

    // Очищаем сохранение
    clearLocalStorageSave();

    // Преобразуем описание смерти с абзацами
    const paragraphs = data.description.split('\n\n').filter(p => p.trim());
    const formattedDescription = paragraphs.map(p => `<p style="color: #e0e0e0; line-height: 1.8; margin-bottom: 20px; font-size: 1.1em;">${p.trim()}</p>`).join('');

    // Создаем экран смерти с использованием классов из CSS
    const gameScreen = document.getElementById('gameScreen');
    gameScreen.innerHTML = `
                    margin-bottom: 40px;
                    text-shadow: 0 0 30px rgba(255, 255, 255, 0.5);
                    animation: fadeIn 1s ease-in;
                ">
                    ЭТО КОНЕЦ
                </h1>
                
                <!-- ПРИЧИНА СМЕРТИ -->
                <h2 style="
                    color: #c0c0c0;
                    font-size: 24px;
                    font-weight: 300;
                    margin-bottom: 40px;
                    font-style: italic;
                ">
                    ${data.deathReason}
                </h2>
                
                <!-- ОПИСАНИЕ СМЕРТИ НА ВЕСЬ ЭКРАН -->
                <div style="
                    background: rgba(255, 255, 255, 0.05);
                    padding: 40px;
                    border-radius: 10px;
                    border: 1px solid rgba(255, 255, 255, 0.15);
                    margin-bottom: 40px;
                    text-align: left;
                    max-width: 800px;
                    margin-left: auto;
                    margin-right: auto;
                ">
                    ${formattedDescription}
                </div>
                
                <!-- СТАТИСТИКА -->
                <div style="
                    background: rgba(255, 255, 255, 0.03);
                    padding: 30px;
                    border-radius: 10px;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    margin-bottom: 40px;
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 20px;
                    max-width: 600px;
                    margin-left: auto;
                    margin-right: auto;
                ">
                    <div style="text-align: center;">
                        <p style="color: #808080; font-size: 14px; margin-bottom: 5px;">Дней прожито</p>
                        <p style="color: #ffffff; font-size: 32px; font-weight: 300;">${data.finalStats.daysPlayed}</p>
                    </div>
                    <div style="text-align: center;">
                        <p style="color: #808080; font-size: 14px; margin-bottom: 5px;">Действий совершено</p>
                        <p style="color: #ffffff; font-size: 32px; font-weight: 300;">${data.finalStats.actions}</p>
                    </div>
                    <div style="text-align: center;">
                        <p style="color: #808080; font-size: 14px; margin-bottom: 5px;">Монет</p>
                        <p style="color: #ffffff; font-size: 32px; font-weight: 300;">${data.finalStats.coins}</p>
                    </div>
                    <div style="text-align: center;">
                        <p style="color: #808080; font-size: 14px; margin-bottom: 5px;">Репутация</p>
                        <p style="color: #ffffff; font-size: 32px; font-weight: 300;">${data.finalStats.reputation}</p>
                    </div>
                </div>
                
                <!-- КНОПКА НАЧАТЬ ЗАНОВО -->
                <button onclick="location.reload()" style="
                    padding: 20px 60px;
                    font-size: 20px;
                    font-weight: 300;
                    background: linear-gradient(135deg, #ffffff 0%, #e0e0e0 100%);
                    color: #000000;
                    border: 1px solid #ffffff;
                    border-radius: 10px;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    box-shadow: 0 5px 20px rgba(255, 255, 255, 0.2);
                ">
                    ⟲ Начать заново
                </button>
            </div>
            
            <style>
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(-20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            </style>
        </div>
    `;
}

function makeChoice(choice) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('Нет подключения к серверу!');
        return;
    }

    console.log(`🎯 Выбор игрока: ${choice}`);

    // Сразу показываем "Мир реагирует..." с миганием
    showWorldReacting();

    // Отключаем все кнопки выбора
    const choicesList = document.getElementById('choicesList');
    if (choicesList) {
        choicesList.querySelectorAll('.choice-btn').forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
        });
    }

    ws.send(JSON.stringify({
        type: 'choice',
        choice: choice,
        previousScene: currentScene
    }));
}

function showWorldReacting() {
    const sceneDescriptionDiv = document.getElementById('sceneDescription');
    if (!sceneDescriptionDiv) return;

    sceneDescriptionDiv.innerHTML = `
        <p class="world-reacting" style="text-align: center; font-size: 1.3em; color: #ffd700; margin: 50px 0; font-weight: 500; letter-spacing: 1px;">
            🌍 Мир реагирует на ваши действия...
        </p>
    `;
}

function displayScene(description, choices, isDialogue = false, speakerName = '', effects = [], checkResult = null) {
    try {
        console.log('🎬 Rendering scene:', { descriptionLength: description?.length, choicesCount: choices?.length });

        const sceneDescriptionDiv = document.getElementById('sceneDescription');
        if (!sceneDescriptionDiv) {
            console.error('❌ Element #sceneDescription not found!');
            return;
        }

        // 1. Форматирование текста
        // Очищаем от случайных HTML-тегов из AI (например "dialogue-speech">...")
        let cleanDescription = (description || '')
            .replace(/<[^>]*>/g, '') // Remove any HTML tags
            .replace(/"dialogue-speech">/g, '') // Remove broken class references
            .replace(/class="[^"]*">/g, ''); // Remove any class="..."> leftovers

        // Разбиваем на абзацы
        let paragraphs = cleanDescription.split('\n\n').filter(p => p.trim());

        // 2. Подсветка прямой речи (если это диалог или просто текст с речью)
        // Регулярка для кириллических «...» и обычных "..."
        if (isDialogue || (description && (description.includes('«') || description.includes('"')))) {
            paragraphs = paragraphs.map(p => {
                // Подсветка: заменяем кавычки на span с классом
                return p.replace(/«([^»]+)»/g, '<span class="dialogue-speech">«$1»</span>')
                    .replace(/"([^"]+)"/g, '<span class="dialogue-speech">"$1"</span>');
            });
        }

        const formattedDescription = paragraphs.map(p => `<p class="scene-paragraph">${p.trim()}</p>`).join('');

        // 3. Сборка HTML
        let htmlContent = '';

        // Если это диалог, добавляем красивый бейдж собеседника
        if (isDialogue && speakerName) {
            htmlContent += `
                <div class="dialogue-header">
                    <div class="dialogue-badge">
                        <span class="dialogue-icon">💬</span>
                        <span class="dialogue-name">${speakerName}</span>
                    </div>
                    <div class="dialogue-line"></div>
                </div>
            `;
        }

        // Deterministic check (if any)
        if (checkResult && typeof checkResult === 'object' && checkResult.key) {
            const status = checkResult.success ? 'УСПЕХ' : 'ПРОВАЛ';
            htmlContent += `
                <div style="margin-bottom: 10px; padding: 10px 12px; background: rgba(74,144,226,0.08); border: 1px solid rgba(74,144,226,0.25); border-radius: 12px;">
                    <div style="display:flex; justify-content:space-between; gap:10px;">
                        <span style="color:#4a90e2; font-weight:700;">🎲 Проверка: ${checkResult.key}</span>
                        <span style="color:${checkResult.success ? '#8BC34A' : '#FF9800'}; font-weight:800;">${status}</span>
                    </div>
                    <div style="margin-top:4px; color:#888; font-size:0.9em;">
                        Сложность: ${checkResult.difficulty} • Шанс: ${checkResult.chance}% • Бросок: ${checkResult.roll}
                    </div>
                </div>
            `;
        }

        // Effects log (compact)
        const eff = Array.isArray(effects) ? effects : [];
        const nonZero = eff.filter(e => e && typeof e === 'object' && typeof e.delta === 'number' && e.delta !== 0 && e.stat);
        if (nonZero.length) {
            const rows = nonZero.slice(0, 8).map(e => {
                const sign = e.delta > 0 ? '+' : '';
                const statLabel = ({
                    health: 'Здоровье',
                    stamina: 'Выносливость',
                    coins: 'Гроши',
                    reputation: 'Репутация',
                    morality: 'Мораль',
                    satiety: 'Сытость',
                    energy: 'Бодрость',
                    timeChange: 'Время'
                })[e.stat] || e.stat;
                const reason = e.reason ? ` — ${e.reason}` : '';
                return `<div style="display:flex; justify-content:space-between; gap:10px; padding:6px 10px; background: rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:10px;">
                    <span style="color:#cfcfcf;">${statLabel}${reason}</span>
                    <span style="color:${e.delta >= 0 ? '#8BC34A' : '#FF9800'}; font-weight:700;">${sign}${e.delta}</span>
                </div>`;
            }).join('');

            htmlContent += `
                <div style="margin-bottom: 14px;">
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
                        <div style="color:#888; font-size:0.9em;">Последствия хода</div>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:8px;">${rows}</div>
                </div>
            `;
        }

        htmlContent += `<div class="scene-text">${formattedDescription}</div>`;
        sceneDescriptionDiv.innerHTML = htmlContent;


        // 4. Обновление стилей кнопок выбора
        const choicesList = document.getElementById('choicesList');
        const choicesHeader = document.querySelector('.choices-container h4');

        if (isDialogue) {
            choicesHeader.innerHTML = `💬 Ответ для <span style="color: #4a90e2">${speakerName}</span>:`;
        } else {
            choicesHeader.textContent = '🎮 Выберите действие:';
        }

        choicesList.innerHTML = '';

        choices.forEach((choice, index) => {
            const choiceBtn = document.createElement('button');
            choiceBtn.className = 'choice-btn';

            if (isDialogue) {
                choiceBtn.classList.add('dialogue-choice');
                const cleanChoice = choice.replace(/^\d+[\.|)]\s*/, '').trim();
                choiceBtn.innerHTML = `<span class="choice-icon">➤</span> ${cleanChoice}`;
            } else {
                // Удаляем нумерацию от AI, если она есть (например "1. Пойти..." -> "Пойти...")
                const cleanChoice = choice.replace(/^\d+[\.|)]\s*/, '').trim();
                choiceBtn.textContent = `${index + 1}. ${cleanChoice}`;
            }

            choiceBtn.addEventListener('click', () => makeChoice(choice));

            choicesList.appendChild(choiceBtn);
        });

        // Auto-scroll to top
        document.querySelector('.game-main').scrollTop = 0;
    } catch (e) {
        console.error('❌ Error in displayScene:', e);
        // Show error in UI as fallback
        const sceneDescriptionDiv = document.getElementById('sceneDescription');
        if (sceneDescriptionDiv) {
            sceneDescriptionDiv.innerHTML = `<p style="color:red">Ошибка отображения: ${e.message}</p>`;
        }
    }
}

function updateUI() {
    if (!gameState) return;

    saveGameToLocalStorage();

    document.getElementById('charName').textContent = gameState.name;

    let dateText = '';
    if (gameState.date) {
        const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
        dateText = `${gameState.date.day} ${months[gameState.date.month - 1]} ${gameState.date.year} • ${gameState.date.timeOfDay}`;
    } else {
        dateText = `${gameState.time} • День ${gameState.day || 1}`;
    }

    document.getElementById('location').textContent = `📍 ${gameState.location} • ${dateText}`;

    const healthPercent = (gameState.health / gameState.maxHealth) * 100;
    document.getElementById('healthBar').style.width = healthPercent + '%';
    document.getElementById('healthText').textContent = `${gameState.health}/${gameState.maxHealth}`;

    const staminaPercent = (gameState.stamina / gameState.maxStamina) * 100;
    document.getElementById('staminaBar').style.width = staminaPercent + '%';
    document.getElementById('staminaText').textContent = `${gameState.stamina}/${gameState.maxStamina}`;

    // Satiety
    const satiety = gameState.satiety !== undefined ? gameState.satiety : 100;
    const satietyBar = safeGetElement('satietyBar');
    const satietyText = safeGetElement('satietyText');
    if (satietyBar && satietyText) {
        satietyBar.style.width = satiety + '%';
        satietyText.textContent = `${satiety}/100`;

        // Change color based on satiety level
        if (satiety < 20) {
            satietyBar.style.background = 'linear-gradient(90deg, #f44336 0%, #ff5722 100%)'; // Red warning
        } else {
            satietyBar.style.background = ''; // Default CSS
        }
    }

    // Energy
    const energy = gameState.energy !== undefined ? gameState.energy : 100;
    const energyBar = safeGetElement('energyBar');
    const energyText = safeGetElement('energyText');
    if (energyBar && energyText) {
        energyBar.style.width = energy + '%';
        energyText.textContent = `${energy}/100`;

        // Change color based on energy level
        if (energy < 35) {
            energyBar.style.background = 'linear-gradient(90deg, #ff9800 0%, #ffc107 100%)'; // Orange warning
        } else {
            energyBar.style.background = ''; // Default CSS
        }
    }

    document.getElementById('coins').textContent = gameState.coins;
    document.getElementById('reputation').textContent = `${gameState.reputation}/100`;

    document.getElementById('weaponName').textContent = gameState.equipment.weapon.name;
    document.getElementById('weaponCondition').style.width = gameState.equipment.weapon.condition + '%';
    document.getElementById('armorName').textContent = gameState.equipment.armor.name;
    document.getElementById('armorCondition').style.width = gameState.equipment.armor.condition + '%';

    // Обновляем все вкладки чтобы данные были актуальными
    updateInventory();
    updateSkills();
    updateCharacter();
}

function updateCharacter() {
    if (!gameState) return;

    const characterInfo = document.getElementById('characterInfo');
    if (!characterInfo) return;

    // Build NPC list (new system), fallback to legacy relationships
    let npcList = Array.isArray(gameState.npcs) ? gameState.npcs : Object.values(gameState.npcs || {});
    if (!npcList.length) {
        const relationships = gameState.character?.relationships || {};
        npcList = Object.keys(relationships).map(name => {
            let rel = relationships[name];
            if (typeof rel === 'string' && rel.startsWith('{')) {
                try { rel = JSON.parse(rel); } catch { }
            }
            const obj = (rel && typeof rel === 'object') ? rel : {};
            const disposition = typeof obj.disposition === 'number' ? obj.disposition : 0;
            const locName = gameState.character?.npcLocations?.[name] || '';
            return {
                name,
                role: obj.role || '',
                status: obj.status || (typeof rel === 'string' ? rel : ''),
                disposition,
                notes: obj.notes || '',
                lastSeen: locName ? { locationName: locName, locationId: null, dayOfGame: gameState.date?.dayOfGame ?? null } : null
            };
        });
    }

    // Формируем список недавних событий (опционально)
    let recentEventsHTML = '';
    const recentEvents = gameState.character.recentEvents || [];
    if (recentEvents.length > 0) {
        const lastEvents = recentEvents.slice(-5); // Последние 5 событий
        recentEventsHTML = `
            <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
                <h5 style="color: #ffd700; margin-bottom: 10px; font-size: 1.1em;">📜 Недавние события:</h5>
                <ul style="list-style: none; padding: 0; margin: 0;">
        `;

        lastEvents.forEach(event => {
            recentEventsHTML += `
                <li style="margin-bottom: 8px; padding-left: 20px; position: relative; color: #ccc; font-size: 0.9em; line-height: 1.4;">
                    <span style="position: absolute; left: 0; color: #ffd700;">•</span>
                    ${event}
                </li>
            `;
        });

        recentEventsHTML += `
                </ul>
            </div>
        `;
    }

    characterInfo.innerHTML = `
        <div style="padding: 10px;">
            <h4 style="color: #ffd700; margin-bottom: 10px;">${gameState.name}</h4>
            <p style="color: #ccc; line-height: 1.6; margin-bottom: 15px; font-size: 0.95em;">${gameState.character.background}</p>
            <div style="margin-bottom: 15px;">
                <strong style="color: #4a90e2;">Черты характера:</strong>
                <p style="color: #ccc; margin-top: 5px; font-size: 0.9em;">${gameState.character.traits.join(', ')}</p>
            </div>
            <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px;">
                    <h5 style="color: #4a90e2; margin: 0; font-size: 1.1em;">👥 Знакомства и отношения</h5>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <input id="npcSearchInput" placeholder="Поиск..." style="width: 180px; padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.05); color:#fff;">
                        <select id="npcSortSelect" style="padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.05); color:#fff;">
                            <option value="dispositionDesc">По отношению</option>
                            <option value="nameAsc">По имени</option>
                            <option value="lastSeenDesc">По последней встрече</option>
                        </select>
                    </div>
                </div>
                <div id="npcCardsWrap" style="display:flex; flex-direction:column; gap:10px;"></div>
            </div>
            <div style="margin-top: 16px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
                <h5 style="color: #ffd700; margin-bottom: 10px; font-size: 1.05em;">💰 Долги и обещания</h5>
                <div id="debtsWrap" style="display:flex; flex-direction:column; gap:10px;"></div>
            </div>
            <div style="margin-top: 16px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
                <h5 style="color: #ffd700; margin-bottom: 10px; font-size: 1.05em;">🏳️ Фракции</h5>
                <div id="factionsWrap" style="display:flex; flex-direction:column; gap:10px;"></div>
            </div>
            ${recentEventsHTML}
                </div>
        `;

    const wrap = characterInfo.querySelector('#npcCardsWrap');
    const search = characterInfo.querySelector('#npcSearchInput');
    const sortSel = characterInfo.querySelector('#npcSortSelect');

    function renderNpcCards() {
        if (!wrap) return;
        const q = (search?.value || '').trim().toLowerCase();
        const sortMode = sortSel?.value || 'dispositionDesc';

        let rows = npcList.slice();
        if (q) {
            rows = rows.filter(n => (n.name || '').toLowerCase().includes(q) || (n.role || '').toLowerCase().includes(q) || (n.status || '').toLowerCase().includes(q));
        }

        rows.sort((a, b) => {
            if (sortMode === 'nameAsc') return String(a.name).localeCompare(String(b.name), 'ru');
            if (sortMode === 'lastSeenDesc') {
                const ad = a.lastSeen?.dayOfGame ?? -1;
                const bd = b.lastSeen?.dayOfGame ?? -1;
                return bd - ad;
            }
            // dispositionDesc
            return (b.disposition ?? 0) - (a.disposition ?? 0);
        });

        if (!rows.length) {
            wrap.innerHTML = `<div style="color:#888; font-style:italic;">Пока никого не знаете</div>`;
            return;
        }

        wrap.innerHTML = rows.map(n => {
            const disp = typeof n.disposition === 'number' ? n.disposition : 0;
            const pct = Math.max(0, Math.min(100, Math.round(((disp + 100) / 200) * 100)));
            const barColor = disp >= 25 ? '#4CAF50' : (disp <= -25 ? '#f44336' : '#9e9e9e');
            const last = n.lastSeen?.locationName ? `${n.lastSeen.locationName}${n.lastSeen.dayOfGame ? ` • день ${n.lastSeen.dayOfGame}` : ''}` : 'неизвестно';
            const role = n.role ? `— ${n.role}` : '';
            const faction = n.faction ? String(n.faction) : '';
            const status = n.status ? n.status : '';
            const notes = n.notes ? n.notes : '';
            const memory = Array.isArray(n.memory) ? n.memory.slice(-3) : [];
            const showMap = (n.lastSeen?.locationName || n.lastSeen?.locationId) ? '' : 'disabled';
            const mapPayload = encodeURIComponent(JSON.stringify({ locationId: n.lastSeen?.locationId || null, locationName: n.lastSeen?.locationName || '' }));
            return `
                <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08);">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
                        <div>
                            <div style="color:#4a90e2; font-weight:700;">${n.name}</div>
                            <div style="color:#888; font-size:0.9em;">${role}${faction ? ` • <span style="color:#ffd700;">${faction}</span>` : ''}</div>
                        </div>
                        <button class="npc-map-btn" data-map="${mapPayload}" ${showMap} style="padding:6px 10px; border-radius: 8px; border: 1px solid rgba(74,144,226,0.35); background: rgba(74,144,226,0.12); color:#4a90e2; cursor:pointer; opacity:${showMap ? 0.45 : 1};">
                            🗺️ На карте
                        </button>
                    </div>
                    <div style="margin-top:8px; color:#ccc; font-size:0.95em;">${status}</div>
                    ${notes ? `<div style="margin-top:6px; color:#aaa; font-size:0.9em; font-style:italic;">${notes}</div>` : ''}
                    ${memory.length ? `<div style="margin-top:8px; color:#bbb; font-size:0.88em;"><span style="color:#888;">Память:</span> ${memory.map(m => `<span style="display:inline-block; margin:4px 6px 0 0; padding:2px 8px; border-radius:999px; background: rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08);">${m}</span>`).join('')}</div>` : ''}
                    <div style="margin-top:10px;">
                        <div style="display:flex; justify-content:space-between; color:#888; font-size:0.85em;">
                            <span>Отношение: <strong style="color:${barColor};">${disp}</strong></span>
                            <span>Видели: ${last}</span>
                        </div>
                        <div style="margin-top:6px; height:8px; background: rgba(0,0,0,0.5); border-radius: 999px; overflow:hidden; border: 1px solid rgba(255,255,255,0.08);">
                            <div style="height:100%; width:${pct}%; background:${barColor};"></div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        wrap.querySelectorAll('.npc-map-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                try {
                    const payload = JSON.parse(decodeURIComponent(btn.dataset.map));
                    openMapToLocation(payload.locationId, payload.locationName);
                } catch (e) {
                    console.warn('Failed to open map for NPC', e);
                }
            });
        });
    }

    if (search) search.addEventListener('input', renderNpcCards);
    if (sortSel) sortSel.addEventListener('change', renderNpcCards);
    renderNpcCards();

    // Debts / Factions rendering
    const debtsWrap = characterInfo.querySelector('#debtsWrap');
    const factionsWrap = characterInfo.querySelector('#factionsWrap');
    const playerName = gameState.name;

    if (debtsWrap) {
        const debts = Array.isArray(gameState.debts) ? gameState.debts : [];
        const active = debts.filter(d => d && d.status !== 'closed');
        if (!active.length) {
            debtsWrap.innerHTML = `<div style="color:#888; font-style:italic;">Нет активных долгов</div>`;
        } else {
            debtsWrap.innerHTML = active.slice(-10).map(d => {
                const dir = d.from === playerName ? 'Вы должны' : (d.to === playerName ? 'Вам должны' : `${d.from} должен`);
                const who = d.from === playerName ? d.to : (d.to === playerName ? d.from : d.to);
                const due = d.dueDay ? ` • срок: день ${d.dueDay}` : '';
                const reason = d.reason ? ` — ${d.reason}` : '';
                return `<div style="background: rgba(255,255,255,0.03); padding: 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08);">
                    <div style="display:flex; justify-content:space-between; gap:10px;">
                        <span style="color:#ccc;">${dir}: <strong style="color:#ffd700;">${who}</strong>${reason}</span>
                        <span style="color:#ffd700; font-weight:800;">${d.amount}</span>
                    </div>
                    <div style="margin-top:4px; color:#888; font-size:0.85em;">${(d.status || 'active')}${due}</div>
                </div>`;
            }).join('');
        }
    }

    if (factionsWrap) {
        const factions = Object.values(gameState.factions || {});
        if (!factions.length) {
            factionsWrap.innerHTML = `<div style="color:#888; font-style:italic;">Нет известных фракций</div>`;
        } else {
            factionsWrap.innerHTML = factions.slice(0, 12).map(f => {
                const disp = typeof f.disposition === 'number' ? f.disposition : 0;
                const pct = Math.max(0, Math.min(100, Math.round(((disp + 100) / 200) * 100)));
                const barColor = disp >= 25 ? '#4CAF50' : (disp <= -25 ? '#f44336' : '#9e9e9e');
                return `<div style="background: rgba(255,255,255,0.03); padding: 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08);">
                    <div style="display:flex; justify-content:space-between; gap:10px; align-items:center;">
                        <span style="color:#ccc;"><strong style="color:#ffd700;">${f.name}</strong>${f.notes ? ` — <span style="color:#aaa;">${f.notes}</span>` : ''}</span>
                        <span style="color:${barColor}; font-weight:800;">${disp}</span>
                    </div>
                    <div style="margin-top:8px; height:8px; background: rgba(0,0,0,0.5); border-radius: 999px; overflow:hidden; border: 1px solid rgba(255,255,255,0.08);">
                        <div style="height:100%; width:${pct}%; background:${barColor};"></div>
                    </div>
                </div>`;
            }).join('');
        }
    }
}

function updateSkills() {    // Навыки
    const skillsList = document.getElementById('skillsList');
    if (!skillsList || !gameState) return;
    skillsList.innerHTML = '';

    // 1. Атрибуты (Attributes)
    if (gameState.attributes) {
        const attrHeader = document.createElement('h3');
        attrHeader.textContent = 'Характеристики';
        attrHeader.style.color = '#ffd700';
        attrHeader.style.marginTop = '0';
        skillsList.appendChild(attrHeader);

        const attrGrid = document.createElement('div');
        attrGrid.style.display = 'grid';
        attrGrid.style.gridTemplateColumns = '1fr 1fr';
        attrGrid.style.gap = '10px';
        attrGrid.style.marginBottom = '20px';

        const attrs = [
            { key: 'strength', label: '💪 Сила', desc: 'Физическая мощь' },
            { key: 'agility', label: '🦵 Ловкость', desc: 'Координация' },
            { key: 'intelligence', label: '🧠 Интеллект', desc: 'Знания' },
            { key: 'charisma', label: '🗣️ Харизма', desc: 'Влияние' }
        ];

        attrs.forEach(attr => {
            const val = gameState.attributes[attr.key] || 3;
            const div = document.createElement('div');
            div.className = 'skill-item';
            div.innerHTML = `
                <div class="skill-name" style="color: #fff;">${attr.label}</div>
                <div class="skill-value" style="font-size: 1.2em; color: #4a90e2;">${val}</div>
                <div style="font-size: 0.8em; color: #888;">${attr.desc}</div>
            `;
            attrGrid.appendChild(div);
        });
        skillsList.appendChild(attrGrid);
    }

    // 2. Навыки (Skills)
    const skillHeader = document.createElement('h3');
    skillHeader.textContent = 'Навыки';
    skillHeader.style.color = '#ffd700';
    skillsList.appendChild(skillHeader);

    Object.entries(gameState.skills).forEach(([skillName, skillData]) => {
        const skillDiv = document.createElement('div');
        skillDiv.className = 'skill-item';

        const skillNameMap = {
            combat: '⚔️ Бой',
            stealth: '🥷 Скрытность',
            speech: '💬 Красноречие',
            survival: '🏕️ Выживание'
        };
        const displayName = skillNameMap[skillName] || skillName;

        const currentXP = skillData.xp || 0;
        const nextLevelXP = skillData.nextLevel || 100;
        const progressPercent = Math.min(100, Math.round((currentXP / nextLevelXP) * 100));

        // Calculate progress bar blocks
        const filledBlocks = Math.floor(progressPercent / 10);
        const emptyBlocks = 10 - filledBlocks;
        const progressBar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);

        skillDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                <span style="font-weight: 500;">${displayName}</span>
                <span style="color: #b0b0b0; font-size: 0.9em;">Уровень ${skillData.level}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; font-size: 0.85em;">
                <span style="color: #808080; font-family: monospace; letter-spacing: 2px;">${progressBar}</span>
                <span style="color: #4a90e2; font-weight: 500;">${currentXP}/${nextLevelXP} XP</span>
            </div>
            <div style="background: #1a1a1a; height: 4px; border-radius: 2px; border: 1px solid #333;">
                <div style="background: linear-gradient(90deg, #ffffff, #d0d0d0); height: 100%; width: ${progressPercent}%; border-radius: 2px; transition: width 0.3s ease;"></div>
            </div>
        `;
        skillsList.appendChild(skillDiv);
    });
}

// --- Inventory System ---
let selectedSlotIndex = -1;
let currentFilter = 'all';

function initInventoryHandlers() {
    // Filter Buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentFilter = e.target.dataset.filter;
            selectedSlotIndex = -1; // Deselect
            updateInventory();
            document.getElementById('itemDetailsPanel').classList.add('hidden');
        });
    });

    // Action Buttons
    const useBtn = document.getElementById('useItemBtn');
    const dropBtn = document.getElementById('dropItemBtn');

    if (useBtn) useBtn.addEventListener('click', () => {
        if (selectedSlotIndex === -1) return;
        const item = getFilteredInventory()[selectedSlotIndex];
        if (item) makeChoice(`Использовать ${item.name}`);
    });

    if (dropBtn) dropBtn.addEventListener('click', () => {
        if (selectedSlotIndex === -1) return;
        const item = getFilteredInventory()[selectedSlotIndex];
        if (item) makeChoice(`Выбросить ${item.name}`);
    });
}

function getItemIcon(name) {
    const lower = name.toLowerCase();
    // Weapons
    if (lower.includes('меч')) return '⚔️';
    if (lower.includes('лук')) return '🏹';
    if (lower.includes('топор')) return '🪓';
    if (lower.includes('дубин')) return '🪵';
    if (lower.includes('нож') || lower.includes('кинжал')) return '🗡️';

    // Armor
    if (lower.includes('доспех') || lower.includes('кольчуг')) return '🛡️';
    if (lower.includes('шлем')) return '🪖';
    if (lower.includes('сапог')) return '👢';
    if (lower.includes('перчат')) return '🧤';
    if (lower.includes('плащ') || lower.includes('обмотки') || lower.includes('тряпк')) return '🧥';

    // Food
    if (lower.includes('хлеб')) return '🍞';
    if (lower.includes('яблок')) return '🍎';
    if (lower.includes('мясо')) return '🥩';
    if (lower.includes('сыр')) return '🧀';
    if (lower.includes('пиво') || lower.includes('эль')) return '🍺';
    if (lower.includes('вино')) return '🍷';
    if (lower.includes('вода')) return '💧';

    // Misc
    if (lower.includes('зелье') || lower.includes('отвар')) return '🧪';
    if (lower.includes('ключ')) return '🔑';
    if (lower.includes('монет') || lower.includes('деньги')) return '💰';
    if (lower.includes('книг') || lower.includes('письм')) return '📜';
    if (lower.includes('факел')) return '🔥';
    if (lower.includes('трава') || lower.includes('цветок')) return '🌿';

    return '📦';
}

function getItemType(name) {
    const icon = getItemIcon(name);
    if (['⚔️', '🏹', '🪓', '🪵', '🗡️'].includes(icon)) return 'weapon';
    if (['🛡️', '🪖', '👢', '🧤', '🧥'].includes(icon)) return 'armor';
    if (['🍞', '🍎', '🥩', '🧀', '🍺', '🍷', '💧'].includes(icon)) return 'food';
    return 'misc';
}

function getFilteredInventory() {
    if (!gameState || !gameState.inventory) return [];
    return gameState.inventory.filter(item => {
        if (currentFilter === 'all') return true;
        const type = getItemType(item.name);
        return type === currentFilter;
    });
}

function updateInventory() {
    const grid = document.getElementById('inventoryGrid');
    if (!grid || !gameState) return;

    grid.innerHTML = '';
    const filteredItems = getFilteredInventory();

    // Render Items
    filteredItems.forEach((item, index) => {
        const slot = document.createElement('div');
        slot.className = 'inventory-slot';
        if (index === selectedSlotIndex) slot.classList.add('selected');

        slot.innerHTML = `
            <div class="item-icon">${getItemIcon(item.name)}</div>
            ${item.quantity > 1 ? `<div class="item-count">${item.quantity}</div>` : ''}
        `;

        // Native tooltip
        slot.title = item.name;

        slot.addEventListener('click', () => {
            // Select logic
            document.querySelectorAll('.inventory-slot').forEach(s => s.classList.remove('selected'));
            slot.classList.add('selected');
            selectedSlotIndex = index;
            showItemDetails(item);
        });

        grid.appendChild(slot);
    });

    // Fill remaining slots with empty ones (min 20 slots total look)
    const totalSlots = Math.max(20, filteredItems.length + 5);
    for (let i = filteredItems.length; i < totalSlots; i++) {
        const emptySlot = document.createElement('div');
        emptySlot.className = 'inventory-slot empty';
        grid.appendChild(emptySlot);
    }
}

function showItemDetails(item) {
    const panel = document.getElementById('itemDetailsPanel');
    const icon = document.getElementById('detailIcon');
    const name = document.getElementById('detailName');
    const type = document.getElementById('detailType');
    const desc = document.getElementById('detailDesc');

    if (!panel) return;

    panel.classList.remove('hidden');
    icon.textContent = getItemIcon(item.name);
    name.textContent = item.name;

    const typeMap = { 'weapon': 'Оружие', 'armor': 'Одежда/Броня', 'food': 'Еда/Напитки', 'misc': 'Предмет' };
    type.textContent = typeMap[getItemType(item.name)];

    // Description can be generic if we don't have one stored
    desc.textContent = item.description || "Обычный предмет, который можно найти в этом мире.";
}
function updateHistory() {
    const historyList = document.getElementById('historyList');
    if (!historyList || !gameState) return;

    historyList.innerHTML = '';

    if (!gameState.history || gameState.history.length === 0) {
        historyList.innerHTML = '<p class="empty-text">Начало приключения</p>';
        return;
    }

    const recentHistory = gameState.history.slice(-20).reverse();

    recentHistory.forEach(entry => {
        const historyDiv = document.createElement('div');
        historyDiv.className = 'history-item';
        historyDiv.innerHTML = `
            <p><strong>Выбор:</strong> ${entry.choice}</p>
            <p style="margin-top: 5px; font-size: 0.85em; color: #a0a0a0;">${entry.scene.substring(0, 150)}${entry.scene.length > 150 ? '...' : ''}</p>
        `;
        historyList.appendChild(historyDiv);
    });
}


function initCustomChoiceHandlers() {
    const customChoiceBtn = document.getElementById('customChoiceBtn');
    const customChoiceInput = document.getElementById('customChoice');

    if (!customChoiceBtn || !customChoiceInput) return;

    const newBtn = customChoiceBtn.cloneNode(true);
    customChoiceBtn.parentNode.replaceChild(newBtn, customChoiceBtn);

    const newInput = customChoiceInput.cloneNode(true);
    customChoiceInput.parentNode.replaceChild(newInput, customChoiceInput);

    newBtn.addEventListener('click', () => {
        const custom = newInput.value.trim();
        if (custom) {
            makeChoice(custom);
            newInput.value = '';
        }
    });

    newInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            newBtn.click();
        }
    });
}

function initHistoryModal() {
    const historyBtn = document.getElementById('historyBtn');
    const historyModal = document.getElementById('historyModal');
    const closeHistoryModal = document.getElementById('closeHistoryModal');

    if (!historyBtn || !historyModal) return;

    const newHistoryBtn = historyBtn.cloneNode(true);
    historyBtn.parentNode.replaceChild(newHistoryBtn, historyBtn);

    newHistoryBtn.addEventListener('click', () => {
        historyModal.classList.remove('hidden');
        updateHistory();
    });

    if (closeHistoryModal) {
        const newCloseBtn = closeHistoryModal.cloneNode(true);
        closeHistoryModal.parentNode.replaceChild(newCloseBtn, closeHistoryModal);

        newCloseBtn.addEventListener('click', () => {
            historyModal.classList.add('hidden');
        });
    }

    historyModal.addEventListener('click', (e) => {
        if (e.target === historyModal) {
            historyModal.classList.add('hidden');
        }
    });
}

function restoreGame(savedData) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    ws = new WebSocket(`${protocol}//${host}`);

    ws.onopen = () => {
        console.log('✅ WebSocket подключен при восстановлении');
        window.pendingRestore = {
            gameState: savedData.gameState,
            currentScene: savedData.currentScene || '',
            currentChoices: savedData.currentChoices || []
        };
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'connected') {
            currentSessionId = data.sessionId;
            console.log(`🔗 Подключено, SessionID: ${currentSessionId}`);

            if (window.pendingRestore) {
                gameState = window.pendingRestore.gameState;
                currentScene = window.pendingRestore.currentScene;
                currentChoices = window.pendingRestore.currentChoices;
                lastEffects = [];
                lastCheckResult = null;

                updateUI();
                displayScene(currentScene, currentChoices, false, '', lastEffects, lastCheckResult);

                document.getElementById('startScreen').classList.add('hidden');
                document.getElementById('gameScreen').classList.remove('hidden');

                setTimeout(() => {
                    initTabHandlers();
                    initCustomChoiceHandlers();
                    initHistoryModal();
                    initSaveLoadHandlers();
                }, 100);

                // Отправляем загруженное состояние на сервер
                ws.send(JSON.stringify({
                    type: 'load',
                    gameState: gameState,
                    currentScene: currentScene,
                    currentChoices: currentChoices
                }));
                delete window.pendingRestore;

                console.log('✅ Сохранение загружено успешно!');
            }
        } else {
            handleMessage(data);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        alert('Ошибка подключения к серверу!');
    };

    ws.onclose = () => {
        console.log('Disconnected from server');
    };
}

function saveGameToLocalStorage() {
    if (!gameState) return;

    const saveData = {
        gameState,
        currentScene,
        currentChoices,
        timestamp: Date.now()
    };

    localStorage.setItem('kingdomSave', JSON.stringify(saveData));
}

function loadGameFromLocalStorage() {
    const saved = localStorage.getItem('kingdomSave');
    return saved ? JSON.parse(saved) : null;
}

function clearLocalStorageSave() {
    localStorage.removeItem('kingdomSave');
}

function showLoading() {
    const loading = document.getElementById('loadingIndicator');
    if (loading) loading.style.display = 'block';
}

function hideLoading() {
    const loading = document.getElementById('loadingIndicator');
    if (loading) loading.style.display = 'none';
}

// Функция для скачивания сохранения
function downloadSave() {
    if (!gameState) {
        alert('Нет данных для сохранения!');
        return;
    }

    const saveData = {
        gameState,
        currentScene,
        currentChoices,
        timestamp: Date.now(),
        version: '1.0'
    };

    const json = JSON.stringify(saveData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    // Создаём имя файла с датой и именем персонажа
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = date.toTimeString().slice(0, 5).replace(/:/g, '');
    const fileName = `kingdom_save_${gameState.name}_${dateStr}_${timeStr}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log(`💾 Сохранение скачано: ${fileName}`);
    alert(`💾 Сохранение скачано: ${fileName}`);
}

// Функция для загрузки сохранения из файла
function loadSaveFromFile(file) {
    const reader = new FileReader();

    reader.onload = (e) => {
        try {
            const saveData = JSON.parse(e.target.result);

            if (!saveData.gameState) {
                alert('❌ Файл сохранения повреждён или неверного формата!');
                return;
            }

            console.log('📂 Загружено сохранение из файла:', file.name);

            // Подтверждение загрузки
            const confirmLoad = confirm(
                `📂 Загрузить сохранение?\n\n` +
                `Персонаж: ${saveData.gameState.name}\n` +
                `Дата сохранения: ${saveData.timestamp ? new Date(saveData.timestamp).toLocaleString('ru-RU') : 'неизвестно'}\n\n` +
                `Текущий прогресс будет потерян!`
            );

            if (confirmLoad) {
                // Очищаем текущее сохранение
                clearLocalStorageSave();

                // Восстанавливаем игру
                restoreGame(saveData);
            }
        } catch (error) {
            console.error('Ошибка при загрузке файла:', error);
            alert('❌ Ошибка при чтении файла сохранения! Проверьте формат файла.');
        }
    };

    reader.onerror = () => {
        alert('❌ Ошибка при чтении файла!');
    };

    reader.readAsText(file);
}

// Инициализация обработчиков сохранения и загрузки
function initSaveLoadHandlers() {
    const saveBtn = document.getElementById('saveBtn');
    const loadBtn = document.getElementById('loadBtn');
    const fileInput = document.getElementById('fileInput');

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            if (!gameState) {
                alert('Нет данных для сохранения! Начните игру.');
                return;
            }
            downloadSave();
        });
    }

    if (loadBtn && fileInput) {
        loadBtn.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
                    alert('❌ Пожалуйста, выберите JSON файл!');
                    return;
                }
                loadSaveFromFile(file);
                // Сбрасываем input, чтобы можно было загрузить тот же файл снова
                fileInput.value = '';
            }
        });
    }
}


































