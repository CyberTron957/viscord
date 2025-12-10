const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// change this to your .db filename
const dbPath = path.join(__dirname, "mydb.sqlite");

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) return console.error("Open error:", err.message);
    console.log("Connected to:", dbPath);
});

// get all table names
db.all(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    (err, tables) => {
        if (err) return console.error(err);

        if (tables.length === 0) {
            console.log("No tables found.");
            return;
        }

        console.log("\nTables found:");
        tables.forEach((t) => console.log(" -", t.name));

        // print each table
        tables.forEach((table) => {
            const name = table.name;
            console.log(`\n=== ${name} ===`);
            db.all(`SELECT * FROM ${name}`, (err, rows) => {
                if (err) return console.error(err);
                console.table(rows);
            });
        });
    }
);
