const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// Setup database
const dbFile = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbFile);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER DEFAULT 1,
        filename TEXT NOT NULL,
        file_url TEXT NOT NULL,
        print_type TEXT NOT NULL,
        copies INTEGER DEFAULT 1,
        sides TEXT DEFAULT 'single',
        pages INTEGER DEFAULT 1,
        total_price DECIMAL(10,2) NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// File upload setup
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });
app.use('/uploads', express.static(uploadsDir));

// API: Create Order
app.post('/api/orders', upload.single('document'), (req, res) => {
    const { printType, copies, sides, amount, fileName } = req.body;
    const filename = fileName || (req.file ? req.file.originalname : 'dummy.pdf');
    const file_url = req.file 
        ? `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}` 
        : 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';
    const total_price = amount || 10.0;

    const stmt = db.prepare(`INSERT INTO orders (filename, file_url, print_type, copies, sides, total_price) VALUES (?, ?, ?, ?, ?, ?)`);
    stmt.run([filename, file_url, printType || 'bw', copies || 1, sides || 'single', total_price], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, order_id: this.lastID, message: "Order placed successfully!", id: this.lastID });
    });
});

// API: Get All Orders (for Admin Dashboard)
app.get('/api/orders', (req, res) => {
    db.all(`SELECT * FROM orders ORDER BY created_at DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// API: Print Queue for C# Print Agent
app.get(['/api/queue', '/api/queue.php'], (req, res) => {
    db.all(`SELECT * FROM orders WHERE status = 'pending'`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Mark them as printing immediately to avoid duplicate prints
        if (rows.length > 0) {
            const ids = rows.map(r => r.id).join(',');
            db.run(`UPDATE orders SET status = 'printing' WHERE id IN (${ids})`);
        }
        
        // Map to what Print Agent expects
        const jobs = rows.map(r => ({
            Id: r.id,
            FileName: r.filename,
            FileUrl: r.file_url,
            PrintType: r.print_type,
            Copies: r.copies,
            Sides: r.sides
        }));
        res.json(jobs);
    });
});

// API: Test Print (Insert dummy job)
app.get('/api/test_print', (req, res) => {
    const file_url = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';
    const stmt = db.prepare(`INSERT INTO orders (filename, file_url, print_type, copies, sides, total_price) VALUES (?, ?, ?, ?, ?, ?)`);
    stmt.run(['dummy.pdf', file_url, 'bw', 1, 'single', 5.0], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.send("Test print job added! Check your C# Print Agent terminal.");
    });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Local Backend running at http://localhost:${PORT}`);
});
