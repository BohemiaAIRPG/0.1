import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3000');

let lastScene = '';
let lastChoices = [];

ws.on('open', () => {
    console.log('🔗 WebSocket opened');
    ws.send(JSON.stringify({
        type: 'start',
        name: 'Тестировщик',
        gender: 'male'
    }));
});

ws.on('message', (data) => {
    const message = JSON.parse(data);
    console.log('📨', message.type, message);

    if (message.type === 'scene') {
        lastScene = message.description;
        lastChoices = message.choices || [];

        if (lastChoices.length > 0) {
            const choice = lastChoices[0];
            console.log('➡️ Sending choice:', choice);
            ws.send(JSON.stringify({
                type: 'choice',
                choice,
                previousScene: lastScene
            }));
        } else {
            console.log('⚠️ No choices to send');
        }
    } else if (message.type === 'gameOver') {
        console.log('💀 Game over received, closing.');
        ws.close();
    } else if (message.type === 'error') {
        console.error('❌ Error from server:', message.message);
        ws.close();
    }
});

ws.on('close', () => {
    console.log('🔌 WebSocket closed');
    process.exit(0);
});

ws.on('error', (err) => {
    console.error('WebSocket error:', err);
});



