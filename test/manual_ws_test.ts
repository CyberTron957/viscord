import { WsClient } from '../src/wsClient';

const client1 = new WsClient((users) => {
    console.log('Client 1 received user list:', JSON.stringify(users, null, 2));
});

const client2 = new WsClient((users) => {
    console.log('Client 2 received user list:', JSON.stringify(users, null, 2));
});

console.log('Connecting clients...');
client1.connect('TestUser1');
client2.connect('TestUser2');

setTimeout(() => {
    console.log('Client 1 updating status...');
    client1.updateStatus({
        status: 'Coding',
        activity: 'Debugging',
        project: 'VS Code viscord',
        language: 'TypeScript'
    });
}, 2000);

setTimeout(() => {
    console.log('Test finished.');
    process.exit(0);
}, 5000);
