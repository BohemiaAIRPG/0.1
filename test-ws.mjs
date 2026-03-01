import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3000');

ws.on('open', () => {
    console.log('Connected!');
    ws.send(JSON.stringify({ type: 'action', action: 'Я осматриваюсь' }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('--- Message Type:', msg.type);
    if (msg.type === 'update' || msg.type === 'init') {
        console.log('Narrative:', msg.message?.substring(0, 50) + '...');
        console.log('ImageUrl:', msg.imageUrl);
        if (msg.type === 'update') {
            process.exit(0);
        }
    }
});

ws.on('error', console.error);
