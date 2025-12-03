const Database = require('better-sqlite3');
const db = new Database('database.sqlite');

console.log('--- Users ---');
const users = db.prepare('SELECT * FROM users').all();
console.log(users);

console.log('\n--- Relationships ---');
const rels = db.prepare('SELECT * FROM user_relationships').all();
console.log(rels);

console.log('\n--- Manual Connections ---');
const manual = db.prepare('SELECT * FROM manual_connections').all();
console.log(manual);
