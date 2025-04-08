const express = require('express');
const ip = require('ip');
const app = express();
const http = require('http').createServer(app);
const { Server } = require('socket.io');

const io = new Server(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Получаем IP адрес сервера
const serverIP = ip.address();


// Настройка статических файлов
app.use(express.static('public'));

// Socket.IO подключения
io.on('connection', (socket) => {
    //console.log('Клиент подключился');

    socket.on('disconnect', () => {
        //console.log('Клиент отключился');
    });
});

// Маршрут для получения информации о сервере
app.get('/api/server-info', (req, res) => {
    res.json({
        ip: serverIP,
        port: PORT
    });
});


const multer = require('multer');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

// Создаем отдельный сервер для GSI данных
const gsiApp = express();
const gsiServer = require('http').createServer(gsiApp);

// Добавляем парсеры для JSON и URL-encoded данных
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
gsiApp.use(express.json({ limit: '50mb' }));
gsiApp.use(express.urlencoded({ extended: true }));

// Настройка статических файлов
app.use(express.static(path.join(__dirname, '../public')));
app.use('/huds', express.static(path.join(__dirname, '../public/huds')));

// Настройка хранения файлов
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, 'public/uploads/');
    },
    filename: function(req, file, cb) {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// Создаем папку для загрузок, если её нет
const uploadsDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadsDir)){
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Настройка базы данных
const db = new sqlite3.Database('database.db');

// В начале файла после создания базы данных
db.serialize(() => {
    // Создание основной структуры таблицы matches
    db.run(`CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_name TEXT,
        team1_id INTEGER,
        team2_id INTEGER,
        status TEXT DEFAULT 'pending',
        map TEXT,
        format TEXT DEFAULT 'bo1',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(team1_id) REFERENCES teams(id),
        FOREIGN KEY(team2_id) REFERENCES teams(id)
    )`);

    // Добавляем колонки для счета, если их нет
    db.run(`
        SELECT score_team1 FROM matches LIMIT 1
    `, [], (err) => {
        if (err) {
            // Колонка не существует, добавляем её
            db.run(`ALTER TABLE matches ADD COLUMN score_team1 INTEGER DEFAULT 0`);
        }
    });

    db.run(`
        SELECT score_team2 FROM matches LIMIT 1
    `, [], (err) => {
        if (err) {
            // Колонка не существует, добавляем её
            db.run(`ALTER TABLE matches ADD COLUMN score_team2 INTEGER DEFAULT 0`);
        }
    });
});

// Настройка шаблонизатора
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, '../public'));


// В начале файла, где создаются таблицы

db.serialize(() => {
    // Сначала удалим существующую таблицу matches
    db.run(`DROP TABLE IF EXISTS matches`);

    // Создаем таблицу заново с правильной структурой
    db.run(`CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team1_id INTEGER,
        team2_id INTEGER,
        match_name TEXT,
        map TEXT,
        status TEXT DEFAULT 'pending',
        score_team1 INTEGER DEFAULT 0,
        score_team2 INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(team1_id) REFERENCES teams(id),
        FOREIGN KEY(team2_id) REFERENCES teams(id)
    )`);
});

// Создание нового матча
app.post('/api/matches', (req, res) => {
    const { team1_id, team2_id } = req.body;

    db.run(`
        INSERT INTO matches (team1_id, team2_id, format, status) 
        VALUES (?, ?, 'bo1', 'pending')
    `, [team1_id, team2_id], function(err) {
        if (err) {
            console.error('Ошибка при создании матча:', err);
            return res.status(500).json({ error: 'Ошибка при создании матча' });
        }
        
        // Возвращаем ID созданного матча
        res.json({ 
            success: true, 
            matchId: this.lastID,
            message: 'Матч успешно создан' 
        });
    });
});

// Получение списка матчей
app.get('/api/matches', (req, res) => {
    db.all(`
        SELECT 
            m.*,
            t1.name as team1_name,
            t2.name as team2_name
        FROM matches m
        LEFT JOIN teams t1 ON m.team1_id = t1.id
        LEFT JOIN teams t2 ON m.team2_id = t2.id
        ORDER BY m.created_at DESC
    `, [], (err, matches) => {
        if (err) {
            console.error('Ошибка при получении списка матчей:', err);
            return res.status(500).json({ error: err.message });
        }
        res.json(matches);
    });
});

// Обработчик обновления счета матча
app.post('/api/matches/:id/score', async (req, res) => {
    const matchId = req.params.id;
    const { team, change, swap } = req.body; // Добавляем параметр swap

    console.log('Получен запрос на обновление счета:', { matchId, team, change, swap });

    try {
        // Проверяем существование матча
        const match = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM matches WHERE id = ?', [matchId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!match) {
            console.log('Матч не найден:', matchId);
            return res.status(404).json({ error: 'Матч не найден' });
        }

        // Определяем поле для обновления
        let scoreField = team === 1 ? 'score_team1' : 'score_team2';
        let currentScore = match[scoreField] || 0;
        let newScore = Math.max(0, currentScore + change);

        // Если swap равен true, меняем местами счет команд
        if (swap) {
            const tempScore = match.score_team1;
            match.score_team1 = match.score_team2;
            match.score_team2 = tempScore;
            console.log('Счет команд поменян местами:', {
                score_team1: match.score_team1,
                score_team2: match.score_team2
            });
        }

        console.log('Обновление счета:', {
            matchId,
            scoreField,
            currentScore,
            newScore
        });

        // Обновляем счет в базе данных
        await new Promise((resolve, reject) => {
            const query = `UPDATE matches SET ${scoreField} = ? WHERE id = ?`;
            console.log('SQL запрос:', query, [newScore, matchId]);
            
            db.run(query, [newScore, matchId], function(err) {
                if (err) {
                    console.error('Ошибка SQL:', err);
                    reject(err);
                } else {
                    console.log('Счет обновлен успешно');
                    resolve(this.changes);
                }
            });
        });

        // Получаем обновленные данные матча
        const updatedMatch = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM matches WHERE id = ?', [matchId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        res.json({
            success: true,
            match: updatedMatch
        });

    } catch (error) {
        console.error('Ошибка при обновлении счета:', error);
        res.status(500).json({ 
            error: 'Ошибка при обновлении счета',
            details: error.message 
        });
    }
});

// Удаление матча
app.delete('/api/matches/:id', (req, res) => {
    db.run('DELETE FROM matches WHERE id = ?', [req.params.id], (err) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ message: 'Матч успешно удален' });
    });
});

// Запуск матча
app.post('/api/matches/:id/start', (req, res) => {
    db.run('UPDATE matches SET status = "active" WHERE id = ?', 
        [req.params.id], 
        (err) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ message: 'Матч запущен' });
        }
    );
});

// Смена сторон в матче
app.post('/api/matches/:id/swap', (req, res) => {
    const matchId = req.params.id;
    
    db.run(`
        UPDATE matches 
        SET team1_id = (
            CASE 
                WHEN team1_id = (SELECT team1_id FROM matches WHERE id = ?) 
                THEN (SELECT team2_id FROM matches WHERE id = ?)
                ELSE (SELECT team1_id FROM matches WHERE id = ?)
            END
        ),
        team2_id = (
            CASE 
                WHEN team2_id = (SELECT team2_id FROM matches WHERE id = ?) 
                THEN (SELECT team1_id FROM matches WHERE id = ?)
                ELSE (SELECT team2_id FROM matches WHERE id = ?)
            END
        ),
        score_team1 = (
            CASE 
                WHEN team1_id = (SELECT team1_id FROM matches WHERE id = ?) 
                THEN (SELECT score_team2 FROM matches WHERE id = ?)
                ELSE (SELECT score_team1 FROM matches WHERE id = ?)
            END
        ),
        score_team2 = (
            CASE 
                WHEN team2_id = (SELECT team2_id FROM matches WHERE id = ?) 
                THEN (SELECT score_team1 FROM matches WHERE id = ?)
                ELSE (SELECT score_team2 FROM matches WHERE id = ?)
            END
        )
        WHERE id = ?
    `, [matchId, matchId, matchId, matchId, matchId, matchId, matchId, matchId, matchId, matchId, matchId, matchId, matchId], function(err) {
        if (err) {
            console.error('Ошибка при смене сторон:', err);
            return res.status(500).json({ error: 'Ошибка при смене сторон' });
        }

        // Обновляем названия команд и логотипы в gameState.map
        if (gameState.map) {
            /*const tempName = gameState.map.team_ct.name;
            const tempLogo = gameState.map.team_ct.logo;
            
            gameState.map.team_ct.name = gameState.map.team_t.name;
            gameState.map.team_ct.logo = gameState.map.team_t.logo;
            
            gameState.map.team_t.name = tempName;
            gameState.map.team_t.logo = tempLogo;

            console.log('Смена названий команд и логотипов после смены сторон:', {
                new_ct: {
                    name: gameState.map.team_ct.name,
                    logo: gameState.map.team_ct.logo
                },
                new_t: {
                    name: gameState.map.team_t.name,
                    logo: gameState.map.team_t.logo
                }
            });*/
        }

        // Получаем обновленные данные матча
        db.get(`
            SELECT 
                m.*,
                t1.name as team1_name,
                t1.logo as team1_logo,
                t2.name as team2_name,
                t2.logo as team2_logo
            FROM matches m
            LEFT JOIN teams t1 ON m.team1_id = t1.id
            LEFT JOIN teams t2 ON m.team2_id = t2.id
            WHERE m.id = ?
        `, [matchId], (err, match) => {
            if (err) {
                console.error('Ошибка при получении данных матча:', err);
                return res.status(500).json({ error: 'Ошибка при получении данных матча' });
            }

            // Отправляем обновленные данные клиенту
            res.json({ 
                success: true,
                match: match,
                gameState: gameState.map // Отправляем обновленные данные о командах
            });
        });
    });
});


// Получение данных матча для редактирования
app.get('/api/matches/:id', (req, res) => {
    const matchId = req.params.id;
    
    db.get(`
        SELECT 
            m.*,
            t1.name as team1_name,
            t2.name as team2_name
        FROM matches m
        LEFT JOIN teams t1 ON m.team1_id = t1.id
        LEFT JOIN teams t2 ON m.team2_id = t2.id
        WHERE m.id = ?
    `, [matchId], (err, match) => {
        if (err) {
            console.error('Ошибка при получении данных матча:', err);
            return res.status(500).json({ error: err.message });
        }
        if (!match) {
            return res.status(404).json({ error: 'Матч не найден' });
        }
        res.json(match);
    });
});

// Обновление данных матча
app.post('/api/matches/:id/update', async (req, res) => {
    const matchId = req.params.id;
    const { format, maps } = req.body;

    try {
        // Начинаем транзакцию
        await new Promise((resolve, reject) => {
            db.run('BEGIN TRANSACTION', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Обновляем основные данные матча
        await new Promise((resolve, reject) => {
            db.run(`
                UPDATE matches 
                SET format = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [format, matchId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Удаляем существующие карты матча
        await new Promise((resolve, reject) => {
            db.run('DELETE FROM match_maps WHERE match_id = ?', [matchId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Добавляем новые карты
        if (maps && maps.length > 0) {
            const stmt = db.prepare(`
                INSERT INTO match_maps (
                    match_id, 
                    map_name, 
                    pick_team, 
                    side_pick_team, 
                    order_number,
                    score_team1,
                    score_team2
                    
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            for (const [index, map] of maps.entries()) {
                await new Promise((resolve, reject) => {
                    stmt.run([
                        matchId,
                        map.mapId,
                        map.pickTeam || null,
                        map.startingSide?.team || null,
                        index + 1,
                        map.score?.team1 || 0,
                        map.score?.team2 || 0
                    ], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            }

            stmt.finalize();
        }

        // Завершаем транзакцию
        await new Promise((resolve, reject) => {
            db.run('COMMIT', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        res.json({ 
            success: true, 
            message: 'Матч успешно обновлен' 
        });

    } catch (error) {
        // В случае ошибки откатываем транзакцию
        await new Promise((resolve) => {
            db.run('ROLLBACK', () => resolve());
        });

        console.error('Ошибка при обновлении матча:', error);
        res.status(500).json({ 
            error: 'Ошибка при обновлении матча',
            details: error.message 
        });
    }
});

// В начале файла, где происходит инициализация базы данных //база матча
// ... existing code ...
db.serialize(() => {
    // Удаляем старую таблицу matches, если она существует
    db.run(`DROP TABLE IF EXISTS match_maps`);
    db.run(`DROP TABLE IF EXISTS matches`);

    // Создаем таблицу matches заново с правильной структурой
    db.run(`
        CREATE TABLE IF NOT EXISTS matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team1_id INTEGER,
            team2_id INTEGER,
            format TEXT DEFAULT 'bo1',
            status TEXT DEFAULT 'pending',
            score_team1 INTEGER DEFAULT 0,
            score_team2 INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(team1_id) REFERENCES teams(id),
            FOREIGN KEY(team2_id) REFERENCES teams(id)
        )
    `, (err) => {
        if (err) {
            console.error('Ошибка при создании таблицы matches:', err);
        } else {
            console.log('Таблица matches успешно создана');
        }
    });

    // Создаем таблицу match_maps
    db.run(`
        CREATE TABLE IF NOT EXISTS match_maps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id INTEGER,
            map_name TEXT,
            pick_team INTEGER,
            side_pick_team INTEGER,
            order_number INTEGER,
            score_team1 INTEGER DEFAULT 0,
            score_team2 INTEGER DEFAULT 0,
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            winner_team TEXT,
            winner_logo TEXT,
            winner_team1 TEXT,
            winner_logo1 TEXT,
            winner_team2 TEXT,
            winner_logo2 TEXT,
            winner_team3 TEXT,
            winner_logo3 TEXT,
            winner_team4 TEXT,
            winner_logo4 TEXT,
            winner_team5 TEXT,
            winner_logo5 TEXT,
            FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
        )
    `, (err) => {
        if (err) {
            console.error('Ошибка при создании таблицы match_maps:', err);
        } else {
            console.log('Таблица match_maps успешно создана');
        }
    });
    
    // Создаем таблицу teams
    db.run(`
        CREATE TABLE IF NOT EXISTS teams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            region TEXT,
            logo TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error('Ошибка при создании таблицы teams:', err);
        } else {
            console.log('Таблица teams успешно создана');
        }
    });
    
    // Создаем таблицу players
    db.run(`
        CREATE TABLE IF NOT EXISTS players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nickname TEXT NOT NULL,
            realName TEXT,
            steam64 TEXT,
            teamId INTEGER,
            avatar TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (teamId) REFERENCES teams(id)
        )
    `, (err) => {
        if (err) {
            console.error('Ошибка при создании таблицы players:', err);
        } else {
            console.log('Таблица players успешно создана');
        }
    });
});
// ... existing code ...

// Обновляем endpoint для обновления матча
app.post('/api/matches/:id/update', (req, res) => {
    const matchId = req.params.id;
    const { format, maps } = req.body;

    console.log('Получены данные для обновления:', { matchId, format, maps });

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // Проверяем существование матча
        db.get('SELECT id FROM matches WHERE id = ?', [matchId], (err, match) => {
            if (err) {
                console.error('Ошибка при проверке матча:', err);
                db.run('ROLLBACK');
                return res.status(500).json({ error: 'Ошибка при проверке матча' });
            }

            if (!match) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: 'Матч не найден' });
            }

            // Обновляем формат матча
            db.run('UPDATE matches SET format = ? WHERE id = ?', 
                [format, matchId], 
                (err) => {
                    if (err) {
                        console.error('Ошибка при обновлении формата:', err);
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: 'Ошибка при обновлении формата' });
                    }

                    // Удаляем существующие карты
                    db.run('DELETE FROM match_maps WHERE match_id = ?', [matchId], (err) => {
                        if (err) {
                            console.error('Ошибка при удалении карт:', err);
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: 'Ошибка при удалении карт' });
                        }

                        // Если есть новые карты, добавляем их
                        if (maps && maps.length > 0) {
                            const stmt = db.prepare(`
                                INSERT INTO match_maps (
                                    match_id, 
                                    map_name, 
                                    pick_team, 
                                    side_pick_team, 
                                    order_number,
                                    score_team1,
                                    score_team2
                                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                            `);

                            let hasError = false;
                            maps.forEach((map, index) => {
                                console.log('Добавление карты:', map);
                                stmt.run(
                                    matchId,
                                    map.mapId,
                                    map.pickTeam || null,
                                    map.startingSide?.team || null,
                                    index + 1,
                                    map.score?.team1 || 0,
                                    map.score?.team2 || 0,
                                    (err) => {
                                        if (err) {
                                            console.error('Ошибка при добавлении карты:', err);
                                            hasError = true;
                                        }
                                    }
                                );
                            });

                            stmt.finalize((err) => {
                                if (err || hasError) {
                                    console.error('Ошибка при финализации:', err);
                                    db.run('ROLLBACK');
                                    return res.status(500).json({ error: 'Ошибка при добавлении карт' });
                                }

                                db.run('COMMIT', (err) => {
                                    if (err) {
                                        console.error('Ошибка при коммите:', err);
                                        db.run('ROLLBACK');
                                        return res.status(500).json({ error: 'Ошибка при сохранении изменений' });
                                    }

                                    res.json({ success: true });
                                });
                            });
                        } else {
                            // Если нет новых карт, просто завершаем транзакцию
                            db.run('COMMIT', (err) => {
                                if (err) {
                                    console.error('Ошибка при коммите:', err);
                                    db.run('ROLLBACK');
                                    return res.status(500).json({ error: 'Ошибка при сохранении изменений' });
                                }

                                res.json({ success: true });
                            });
                        }
                    });
                }
            );
        });
    });
});

// Получение списка доступных карт
app.get('/api/maps', (req, res) => {
    const maps = [
        { id: 'de_dust2', name: 'Dust II' },
        { id: 'de_mirage', name: 'Mirage' },
        { id: 'de_inferno', name: 'Inferno' },
        { id: 'de_nuke', name: 'Nuke' },
        { id: 'de_overpass', name: 'Overpass' },
        { id: 'de_ancient', name: 'Ancient' },
        { id: 'de_anubis', name: 'Anubis' },
        { id: 'de_vertigo', name: 'Vertigo' },
        { id: 'de_cache', name: 'Cache' },
        { id: 'de_train', name: 'Train' }

    ];
    res.json(maps);
});

// Запуск матча
app.post('/api/matches/:id/start', (req, res) => {
    const matchId = req.params.id;
    db.run('UPDATE matches SET status = "active" WHERE id = ?', 
        [matchId], 
        function(err) {
            if (err) {
                console.error('Ошибка при запуске матча:', err);
                return res.status(500).json({ error: err.message });
            }
            res.json({ 
                success: true,
                message: 'Матч запущен'
            });
        }
    );
});

// Остановка матча
app.post('/api/matches/:id/stop', (req, res) => {
    const matchId = req.params.id;
    db.run('UPDATE matches SET status = "pending" WHERE id = ?', 
        [matchId], 
        function(err) {
            if (err) {
                console.error('Ошибка при остановке матча:', err);
                return res.status(500).json({ error: err.message });
            }
            res.json({ 
                success: true,
                message: 'Матч остановлен'
            });
        }
    );
});

// Обновляем маршрут получения списка матчей, чтобы включить только активные матчи
app.get('/api/matches', (req, res) => {
    db.all(`
        SELECT 
            m.*,
            t1.name as team1_name,
            t2.name as team2_name
        FROM matches m
        LEFT JOIN teams t1 ON m.team1_id = t1.id
        LEFT JOIN teams t2 ON m.team2_id = t2.id
        WHERE m.status IN ('pending', 'active')
        ORDER BY m.created_at DESC
    `, [], (err, matches) => {
        if (err) {
            console.error('Ошибка при получении списка матчей:', err);
            return res.status(500).json({ error: err.message });
        }
        res.json(matches);
    });
});

// Обновление счета и статуса карты
app.put('/api/matches/:matchId/maps/:mapId', (req, res) => {
    const { matchId, mapId } = req.params;
    const { team1_score, team2_score, status, team1_side } = req.body;

    db.run(
        `UPDATE match_maps 
        SET team1_score = ?, team2_score = ?, status = ?, team1_side = ?
        WHERE id = ? AND match_id = ?`,
        [team1_score, team2_score, status, team1_side, mapId, matchId],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ message: 'Обновлено успешно' });
        }
    );
});

app.post('/api/matches/:matchId/score', async (req, res) => {
    try {
        const matchId = req.params.matchId;
        const { team, change } = req.body;
        
        console.log('Получен запрос на обновление счета:', { matchId, team, change });

        // Проверяем структуру таблицы
        const tableInfo = await db.all("PRAGMA table_info(matches)");
        console.log('Структура таблицы matches:', tableInfo.map(col => col.name));

        // Получаем текущий матч из базы данных
        const match = await db.get('SELECT * FROM matches WHERE id = ?', [matchId]);
        
        if (!match) {
            return res.status(404).json({ error: 'Матч не найден' });
        }

        console.log('Текущие данные матча:', match);

        // Определяем имена столбцов на основе структуры таблицы
        let team1ScoreField, team2ScoreField;
        
        // Проверяем возможные варианты имен столбцов
        if (match.hasOwnProperty('team1Score')) {
            team1ScoreField = 'team1Score';
            team2ScoreField = 'team2Score';
        } else if (match.hasOwnProperty('score_team1')) {
            team1ScoreField = 'score_team1';
            team2ScoreField = 'score_team2';
        } else if (match.hasOwnProperty('team1_score')) {
            team1ScoreField = 'team1_score';
            team2ScoreField = 'team2_score';
        } else {
            // Если не нашли подходящих столбцов, выводим все доступные поля
            console.log('Доступные поля матча:', Object.keys(match));
            return res.status(500).json({ error: 'Не удалось определить столбцы для счета' });
        }

        // Выбираем нужное поле в зависимости от команды
        const scoreField = team === 1 ? team1ScoreField : team2ScoreField;
        const currentScore = match[scoreField] || 0;
        const newScore = Math.max(0, currentScore + change);
        
        console.log('Обновление счета:', {
            matchId,
            scoreField,
            currentScore,
            newScore
        });

        // Формируем SQL запрос с правильными именами столбцов
        const sql = `UPDATE matches SET ${scoreField} = ? WHERE id = ?`;
        console.log('SQL запрос:', sql, [newScore, matchId]);
        
        // Выполняем запрос
        await db.run(sql, [newScore, matchId]);
        
        // Получаем обновленные данные
        const updatedMatch = await db.get('SELECT * FROM matches WHERE id = ?', [matchId]);
        
        console.log('Счет обновлен успешно');
        
        // Обновляем GSI данные
        if (global.gsiState) {
            // Если GSI данные еще не инициализированы, создаем структуру
            if (!global.gsiState.matches) {
                global.gsiState.matches = [];
            }
            
            // Ищем матч в GSI данных
            let gsiMatch = global.gsiState.matches.find(m => m.id === parseInt(matchId));
            
            // Если матч не найден, добавляем его
            if (!gsiMatch) {
                gsiMatch = {
                    id: parseInt(matchId),
                    team1Score: 0,
                    team2Score: 0
                };
                global.gsiState.matches.push(gsiMatch);
            }
            
            // Обновляем счет в GSI данных
            gsiMatch.team1Score = updatedMatch[team1ScoreField] || 0;
            gsiMatch.team2Score = updatedMatch[team2ScoreField] || 0;
            
            console.log('GSI данные обновлены:', gsiMatch);
            
            // Отправляем обновление всем подключенным клиентам через WebSocket
            if (io) {
                io.emit('gsi_update', {
                    type: 'score_update',
                    data: {
                        matchId: parseInt(matchId),
                        team1Score: gsiMatch.team1Score,
                        team2Score: gsiMatch.team2Score
                    }
                });
                console.log('Отправлено обновление через WebSocket');
            }
        }

        res.json({ 
            success: true, 
            team1Score: updatedMatch[team1ScoreField] || 0,
            team2Score: updatedMatch[team2ScoreField] || 0
        });

    } catch (error) {
        console.error('Ошибка при обновлении счета:', error);
        res.status(500).json({ error: 'Ошибка при обновлении счета', details: error.message });
    }
});

// Поиск команд
app.get('/api/teams/search', (req, res) => {
    const { query } = req.query;
    
    db.all(
        'SELECT * FROM teams WHERE name LIKE ? LIMIT 10',
        [`%${query}%`],
        (err, teams) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json(teams);
        }
    );
});

// Получение списка всех команд
// Добавьте этот роут для получения списка команд
app.get('/api/teams', (req, res) => {
    const query = `
        SELECT id, name, logo 
        FROM teams 
        ORDER BY name ASC
    `;
    
    db.all(query, [], (err, teams) => {
        if (err) {
            console.error('Ошибка при получении списка команд:', err);
            return res.status(500).json({ 
                error: 'Ошибка при получении списка команд',
                details: err.message 
            });
        }
        
        res.json(teams);
    });
});

app.post('/api/teams', upload.single('logo'), (req, res) => {
    const { name, region } = req.body;
    // Сохраняем только имя файла, без /uploads/
    const logo = req.file ? req.file.filename : null;

    db.run('INSERT INTO teams (name, region, logo) VALUES (?, ?, ?)',
        [name, region, logo],
        function(err) {
            if (err) {
                console.error('Ошибка при создании команды:', err);
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ id: this.lastID });
        }
    );
});

// Добавьте этот код временно для исправления путей в базе данных
app.get('/api/fix-logo-paths', (req, res) => {
    db.all('SELECT id, logo FROM teams', [], (err, teams) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        teams.forEach(team => {
            if (team.logo && team.logo.startsWith('/uploads/')) {
                const fixedLogo = team.logo.replace('/uploads/', '');
                db.run('UPDATE teams SET logo = ? WHERE id = ?', [fixedLogo, team.id]);
            }
        });

        res.json({ message: 'Пути к логотипам исправлены' });
    });
});

app.delete('/api/teams/:id', async (req, res) => {
    try {
        const teamId = req.params.id;
        
        db.run('DELETE FROM teams WHERE id = ?', [teamId], function(err) {
            if (err) {
                console.error('Ошибка при удалении:', err);
                return res.status(500).json({ message: 'Ошибка при удалении команды' });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({ message: `Команда с ID ${teamId} не найдена` });
            }
            
            res.json({ message: 'Команда успешно удалена' });
        });
    } catch (error) {
        console.error('Ошибка при удалении команды:', error);
        res.status(500).json({ message: 'Внутренняя ошибка сервера' });
    }
});

app.get('/api/teams/:id', (req, res) => {
    const teamId = req.params.id;
    
    const query = `
        SELECT * FROM teams WHERE id = ?
    `;
    
    db.get(query, [teamId], (err, team) => {
        if (err) {
            console.error('Ошибка при получении данных команды:', err);
            return res.status(500).json({ 
                message: 'Ошибка при получении данных команды',
                error: err.message 
            });
        }
        
        if (!team) {
            return res.status(404).json({ 
                message: `Команда с ID ${teamId} не найдена` 
            });
        }
        
        res.json(team);
    });
});

app.put('/api/teams/:id', upload.single('logo'), (req, res) => {
    const teamId = req.params.id;
    const { name, region } = req.body;
    
    db.get('SELECT id FROM teams WHERE id = ?', [teamId], (err, team) => {
        if (err) {
            console.error('Ошибка при проверке команды:', err);
            return res.status(500).json({ message: 'Ошибка сервера' });
        }
        
        if (!team) {
            return res.status(404).json({ message: `Команда с ID ${teamId} не найдена` });
        }
        
        const logo = req.file ? `/uploads/${req.file.filename}` : null;
        let updateQuery = 'UPDATE teams SET name = ?, region = ?';
        let params = [name, region];

        if (logo) {
            updateQuery += ', logo = ?';
            params.push(logo);
        }

        updateQuery += ' WHERE id = ?';
        params.push(teamId);

        db.run(updateQuery, params, function(err) {
            if (err) {
                console.error('Ошибка при обновлении:', err);
                return res.status(500).json({ message: 'Ошибка при обновлении команды' });
            }

            res.json({ 
                message: 'Команда успешно обновлена',
                teamId: teamId
            });
        });
    });
});

// ... existing code ...

app.get('/api/players', (req, res) => {
    db.all('SELECT * FROM players', (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

app.post('/api/players', upload.single('avatar'), (req, res) => {
    const { nickname, realName, steam64, teamId } = req.body;
    const avatar = req.file ? `/uploads/${req.file.filename}` : null;

    db.run('INSERT INTO players (nickname, realName, steam64, teamId, avatar) VALUES (?, ?, ?, ?, ?)',
        [nickname, realName, steam64, teamId, avatar],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ id: this.lastID });
        }
    );
});

app.delete('/api/players/:id', async (req, res) => {
    try {
        const playerId = req.params.id;
        
        // Используем правильный метод для sqlite3
        db.run('DELETE FROM players WHERE id = ?', [playerId], function(err) {
            if (err) {
                console.error('Ошибка при удалении:', err);
                return res.status(500).json({ message: 'Ошибка при удалении игрока' });
            }
            
            // this.changes показывает количество затронутых строк
            if (this.changes === 0) {
                return res.status(404).json({ message: `Игрок с ID ${playerId} не найден` });
            }
            
            res.json({ message: 'Игрок успешно удален' });
        });
    } catch (error) {
        console.error('Ошибка при удалении игрока:', error);
        res.status(500).json({ message: 'Внутренняя ошибка сервера' });
    }
});

// Маршрут для получения данных одного игрока
app.get('/api/players/:id', (req, res) => {
    const playerId = req.params.id;
    
    // Используем более подробный запрос, включая информацию о команде
    const query = `
        SELECT 
            players.*,
            teams.name as teamName
        FROM players 
        LEFT JOIN teams ON players.teamId = teams.id
        WHERE players.id = ?
    `;
    
    db.get(query, [playerId], (err, player) => {
        if (err) {
            console.error('Ошибка при получении данных игрока:', err);
            return res.status(500).json({ 
                message: 'Ошибка при получении данных игрока',
                error: err.message 
            });
        }
        
        if (!player) {
            return res.status(404).json({ 
                message: `Игрок с ID ${playerId} не найден` 
            });
        }
        
        // Отправляем данные игрока
        res.json(player);
    });
});

// Обновляем маршрут PUT для редактирования игрока
app.put('/api/players/:id', upload.single('avatar'), (req, res) => {
    const playerId = req.params.id;
    const { nickname, realName, steam64, teamId } = req.body;
    
    // Проверяем существование игрока перед обновлением
    db.get('SELECT id FROM players WHERE id = ?', [playerId], (err, player) => {
        if (err) {
            console.error('Ошибка при проверке игрока:', err);
            return res.status(500).json({ message: 'Ошибка сервера' });
        }
        
        if (!player) {
            return res.status(404).json({ message: `Игрок с ID ${playerId} не найден` });
        }
        
        // Если игрок найден, обновляем данные
        const avatar = req.file ? `/uploads/${req.file.filename}` : null;
        let updateQuery = 'UPDATE players SET nickname = ?, realName = ?, steam64 = ?, teamId = ?';
        let params = [nickname, realName, steam64, teamId];

        if (avatar) {
            updateQuery += ', avatar = ?';
            params.push(avatar);
        }

        updateQuery += ' WHERE id = ?';
        params.push(playerId);

        db.run(updateQuery, params, function(err) {
            if (err) {
                console.error('Ошибка при обновлении:', err);
                return res.status(500).json({ message: 'Ошибка при обновлении игрока' });
            }

            res.json({ 
                message: 'Игрок успешно обновлен',
                playerId: playerId
            });
        });
    });
});

// ... existing code ...

// Добавляем новый эндпоинт для получения игроков команды
app.get('/api/teams/:teamId/players', (req, res) => {
    const teamId = req.params.teamId;
    
    db.all(`
        SELECT * FROM players 
        WHERE teamId = ?
        ORDER BY nickname
    `, [teamId], (err, players) => {
        if (err) {
            console.error('Ошибка при получении игроков команды:', err);
            return res.status(500).json({ error: 'Ошибка при получении игроков' });
        }
        res.json(players || []); // Возвращаем пустой массив, если игроков нет
    });
});

// ... existing code ...

// Endpoint для запуска оверлея
app.post('/api/start-overlay', (req, res) => {
    const { hudId } = req.body;
    
    // Путь к файлу start.bat в папке overlay
    const overlayPath = path.join(__dirname, '../overlay/start.bat');
    
    // Запускаем оверлей с параметром hudId
    exec(`"${overlayPath}" ${hudId}`, (error) => {
        if (error) {
            console.error('Error starting overlay:', error);
            res.status(500).json({ error: 'Failed to start overlay' });
            return;
        }
        res.json({ success: true });
    });
});

// Функция для сканирования HUD'ов
function scanHUDs() {
    const hudsPath = path.join(__dirname, '../public/huds');
    const huds = [];
    
    fs.readdirSync(hudsPath).forEach(hudDir => {
        if (!fs.statSync(path.join(hudsPath, hudDir)).isDirectory() || hudDir.startsWith('.')) {
            return;
        }

        const hudPath = path.join(hudsPath, hudDir);
        if (fs.existsSync(path.join(hudPath, 'template.pug')) || 
            fs.existsSync(path.join(hudPath, 'index.html'))) {
            
            let config = {
                id: hudDir,
                name: hudDir.charAt(0).toUpperCase() + hudDir.slice(1) + ' HUD',
                description: 'Custom HUD'
            };

            const configPath = path.join(hudPath, 'config.json');
            if (fs.existsSync(configPath)) {
                try {
                    const hudConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                    config = { ...config, ...hudConfig };
                } catch (e) {
                    console.error(`Ошибка чтения конфига для ${hudDir}:`, e);
                }
            }

            huds.push(config);
        }
    });

    return huds;
}

// Маршруты для HUD
app.get('/api/huds', (req, res) => {
    res.json(scanHUDs());
});

app.get('/hud/:hudId', (req, res) => {
    const { hudId } = req.params;
    res.render(`huds/${hudId}/template`, { hudId });
});

app.get('/hud/:hudId/:file', (req, res) => {
    const { hudId, file } = req.params;
    res.sendFile(path.join(__dirname, `../public/huds/${hudId}/${file}`));
});

// Инициализация начального состояния игры
// ... existing code ...

// Инициализация начального состояния игры
const gameState = {
    map: {},
    phase_countdowns: {},
    buildings: {},
    player: {},
    previously: {},
    provider: {},
    hero: {},
    abilities: {},
    items: {},
    draft: {},
    wearables: {},
    league: {},
    couriers: {},
    neutralitems: {},
    roshan: {},
    events: [],
    minimap: {},
    buyback: {},
    auth: {},
    local_player: {},
    radiant_team: {},
    dire_team: {},
    is_spectating: false,
    // Добавляем поля для Dota 2
    dota: {
        radiant_team: {
            name: '',
            logo: '',
            score: 0
        },
        dire_team: {
            name: '',
            logo: '',
            score: 0
        },
        game_state: '',
        game_time: 0,
        clock_time: 0,
        roshan_state: '',
        match_id: ''
    }
};

// GSI endpoints

gsiApp.post('/gsi', async (req, res) => {
    try {
        const data = req.body;
        if (!data) {
            console.log('Ошибка: Нет данных в GSI запросе');
            return res.sendStatus(400);
        }

        // Сначала сбрасываем данные команд, чтобы избежать сохранения старых логотипов
        if (data.league && data.league.radiant) {
            gameState.dota.radiant_team.name = data.league.radiant.name || 'Radiant';
        }
        if (data.league && data.league.dire) {
            gameState.dota.dire_team.name = data.league.dire.name || 'Dire';
        }
        gameState.dota.radiant_team.logo = '';
        gameState.dota.dire_team.logo = '';


        // Обновляем данные Dota 2
        if (data.map) {
            // Обновляем основные данные карты
            gameState.map = data.map;
            
            // Копируем данные в структуру dota для удобства
            gameState.dota.game_state = data.map.game_state || '';
            gameState.dota.game_time = data.map.game_time || 0;
            gameState.dota.clock_time = data.map.clock_time || 0;
            gameState.dota.roshan_state = data.map.roshan_state || '';
            gameState.dota.match_id = data.map.matchid || '';
            
            // Обновляем счет команд
            gameState.dota.radiant_team.score = data.map.radiant_score || 0;
            gameState.dota.dire_team.score = data.map.dire_score || 0;
        }

        // Получаем активный матч с дополнительной информацией
        const match = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    m.*,
                    t1.name as team1_name, t1.logo as team1_logo,
                    t2.name as team2_name, t2.logo as team2_logo
                FROM matches m
                LEFT JOIN teams t1 ON m.team1_id = t1.id
                LEFT JOIN teams t2 ON m.team2_id = t2.id
                WHERE m.status = 'active'
                LIMIT 1
            `, [], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        // Добавляем флаг matchup в gameState
        gameState.matchupis = !!match;
        
        // Если нет активного матча, очищаем данные матча
        if (!match) {
            gameState.match = null;
        } else {
            // Добавляем формат матча в gameState
            gameState.match = {
                format: match.format || 'bo1',
                status: match.status,
                score_team1_map: match.score_team1 || 0,
                score_team2_map: match.score_team2 || 0,
                matchupis: gameState.matchupis
            };
            
            // Устанавливаем названия команд и логотипы только если есть активный матч
            gameState.dota.radiant_team.name = match.team1_name || 'Radiant';
            gameState.dota.radiant_team.logo = match.team1_logo || '';
            gameState.dota.dire_team.name = match.team2_name || 'Dire';
            gameState.dota.dire_team.logo = match.team2_logo || '';
        }


        // Обрабатываем другие данные Dota 2
        if (data.radiant_team) {
            gameState.radiant_team = data.radiant_team;
            // Если нет активного матча, используем имена из игры
            if (!match) {
                gameState.dota.radiant_team.name = data.radiant_team.name || 'Radiant';
                gameState.dota.radiant_team.logo = data.radiant_team.logo || '';
            }
        }

        if (data.dire_team) {
            gameState.dire_team = data.dire_team;
            // Если нет активного матча, используем имена из игры
            if (!match) {
                gameState.dota.dire_team.name = data.dire_team.name || 'Dire';
                gameState.dota.dire_team.logo = data.dire_team.logo || '';
            }
        }

        // Обрабатываем остальные данные
        if (data.abilities) gameState.abilities = data.abilities;
        if (data.buildings) gameState.buildings = data.buildings;
        // Обработка данных игроков с добавлением курьеров и героев
        if (data.player) {
            // Сначала копируем оригинальные данные
            gameState.player = data.player;
            
            // Обрабатываем игроков команды Radiant (team2)
            if (data.player.team2) {
                for (let i = 0; i < 5; i++) {
                    const slot = `player${i}`;
                    const player = data.player.team2[slot];
                    
                    if (player) {
                        // Добавляем данные о герое
                        if (data.hero && data.hero.team2 && data.hero.team2[slot]) {
                            player.hero = data.hero.team2[slot];
                        }
                        
                        // Добавляем данные о предметах
                        if (data.items && data.items.team2 && data.items.team2[slot]) {
                            const items = data.items.team2[slot];
                            player.items = {
                                slot0: items.slot0 || { name: "empty" },
                                slot1: items.slot1 || { name: "empty" },
                                slot2: items.slot2 || { name: "empty" },
                                slot3: items.slot3 || { name: "empty" },
                                slot4: items.slot4 || { name: "empty" },
                                slot5: items.slot5 || { name: "empty" },
                                slot6: items.slot6 || { name: "empty" },
                                slot7: items.slot7 || { name: "empty" },
                                slot8: items.slot8 || { name: "empty" },
                                stash0: items.stash0 || { name: "empty" },
                                stash1: items.stash1 || { name: "empty" },
                                stash2: items.stash2 || { name: "empty" },
                                stash3: items.stash3 || { name: "empty" },
                                stash4: items.stash4 || { name: "empty" },
                                stash5: items.stash5 || { name: "empty" },
                                teleport0: items.teleport0 || { name: "empty" },
                                neutral0: items.neutral0 || { name: "empty" },
                            };
                        }
                        
                        // Назначаем курьеров для Radiant
                        if (data.couriers) {
                            switch (i) {
                                case 0:
                                    player.courier2 = data.couriers.courier2; // player0
                                    break;
                                case 1:
                                    player.courier3 = data.couriers.courier3; // player1
                                    break;
                                case 2:
                                    player.courier4 = data.couriers.courier4; // player2
                                    break;
                                case 3:
                                    player.courier5 = data.couriers.courier5; // player3
                                    break;
                                case 4:
                                    player.courier6 = data.couriers.courier6; // player4
                                    break;
                            }
                        }
                    }
                }
            }
            
            // Обрабатываем игроков команды Dire (team3)
            if (data.player.team3) {
                for (let i = 5; i < 10; i++) {
                    const slot = `player${i}`;
                    const player = data.player.team3[slot];
                    
                    if (player) {
                        // Добавляем данные о герое
                        if (data.hero && data.hero.team3 && data.hero.team3[slot]) {
                            player.hero = data.hero.team3[slot];
                        }
                        
                        // Добавляем данные о предметах
                        if (data.items && data.items.team3 && data.items.team3[slot]) {
                            const items = data.items.team3[slot];
                            player.items = {
                                slot0: items.slot0 || { name: "empty" },
                                slot1: items.slot1 || { name: "empty" },
                                slot2: items.slot2 || { name: "empty" },
                                slot3: items.slot3 || { name: "empty" },
                                slot4: items.slot4 || { name: "empty" },
                                slot5: items.slot5 || { name: "empty" },
                                slot6: items.slot6 || { name: "empty" },
                                slot7: items.slot7 || { name: "empty" },
                                slot8: items.slot8 || { name: "empty" },
                                stash0: items.stash0 || { name: "empty" },
                                stash1: items.stash1 || { name: "empty" },
                                stash2: items.stash2 || { name: "empty" },
                                stash3: items.stash3 || { name: "empty" },
                                stash4: items.stash4 || { name: "empty" },
                                stash5: items.stash5 || { name: "empty" },
                                teleport0: items.teleport0 || { name: "empty" },
                                neutral0: items.neutral0 || { name: "empty" },
                            };
                        }
                        
                        // Назначаем курьеров для Dire
                        if (data.couriers) {
                            switch (i) {
                                case 5:
                                    player.courier7 = data.couriers.courier7; // player5
                                    break;
                                case 6:
                                    player.courier8 = data.couriers.courier8; // player6
                                    break;
                                case 7:
                                    player.courier9 = data.couriers.courier9; // player7
                                    break;
                                case 8:
                                    player.courier0 = data.couriers.courier0; // player8
                                    break;
                                case 9:
                                    player.courier1 = data.couriers.courier1; // player9
                                    break;
                            }
                        }
                    }
                }
            }
        }
        if (data.hero) gameState.hero = data.hero;
        if (data.provider) gameState.provider = data.provider;
        if (data.items) gameState.items = data.items;
        if (data.draft) gameState.draft = data.draft;
        if (data.wearables) gameState.wearables = data.wearables;
        if (data.league) gameState.league = data.league;
        if (data.couriers) gameState.couriers = data.couriers;
        if (data.neutralitems) gameState.neutralitems = data.neutralitems;
        if (data.roshan) gameState.roshan = data.roshan;
        if (data.events) gameState.events = data.events;
        if (data.minimap) gameState.minimap = data.minimap;
        if (data.phase_countdowns) gameState.phase_countdowns = data.phase_countdowns;
        if (data.buyback) gameState.buyback = data.buyback;
        
        // Сначала сохраняем данные observer из GSI, если они есть
        if (data.observer) {
            gameState.observer = data.observer;
        }

        // Затем проверяем выбранного игрока и обновляем observer
        gameState.observer = null; // Сбрасываем observer перед проверкой
        

// Проверяем данные героев для определения выбранного юнита
if (data.hero) {
    // Проверяем команду Radiant (team2)
    if (data.hero.team2) {
        for (let i = 0; i < 5; i++) {
            const playerKey = `player${i}`;
            if (data.hero.team2[playerKey] && 
                data.hero.team2[playerKey].selected_unit === true) {
                
                // Нашли выбранного игрока в команде Radiant
                const steamId = data.player?.team2?.[playerKey]?.steamid;
                const playerName = data.player?.team2?.[playerKey]?.name;
                
                gameState.observer = {
                    team: 'team2',
                    player_index: i,
                    steamid: steamId,
                    name: playerName
                };
                
                // Если есть steamId, ищем аватарку в базе данных
                if (steamId) {
                    try {
                        const playerData = await new Promise((resolve, reject) => {
                            db.get('SELECT avatar, nickname FROM players WHERE steam64 = ?', [steamId], (err, row) => {
                                if (err) reject(err);
                                else resolve(row);
                            });
                        });
                        
                        if (playerData) {
                            if (playerData.avatar) {
                                // Убираем префикс /uploads/ из пути к аватару
                                let avatar = playerData.avatar;
                                if (avatar.startsWith('/uploads/')) {
                                    avatar = avatar.substring(9); 
                                }
                                gameState.observer.avatar = avatar;
                            }
                            
                            // Используем nickname из базы данных, если он существует
                            if (playerData.nickname) {
                                gameState.observer.name = playerData.nickname;
                            }
                        }
                    } catch (error) {
                        console.error('Ошибка при получении данных игрока:', error);
                    }
                }
                
                //console.log('Найден выбранный игрок в team2:', gameState.observer);
                break; // Прерываем цикл, так как нашли выбранного игрока
            }
        }
    }
    
    // Если не нашли в команде Radiant, проверяем команду Dire (team3)
    if (!gameState.observer && data.hero.team3) {
        // Для команды Dire индексы игроков начинаются с 5
        for (let i = 5; i < 10; i++) {
            const playerKey = `player${i}`;
            if (data.hero.team3[playerKey] && 
                data.hero.team3[playerKey].selected_unit === true) {
                
                // Нашли выбранного игрока в команде Dire
                const steamId = data.player?.team3?.[playerKey]?.steamid;
                const playerName = data.player?.team3?.[playerKey]?.name;
                
                gameState.observer = {
                    team: 'team3',
                    player_index: i,
                    steamid: steamId,
                    name: playerName
                };
                
                // Если есть steamId, ищем аватарку в базе данных
                if (steamId) {
                    try {
                        const playerData = await new Promise((resolve, reject) => {
                            db.get('SELECT avatar, nickname FROM players WHERE steam64 = ?', [steamId], (err, row) => {
                                if (err) reject(err);
                                else resolve(row);
                            });
                        });
                        
                        if (playerData) {
                            if (playerData.avatar) {
                                // Убираем префикс /uploads/ из пути к аватару
                                let avatar = playerData.avatar;
                                if (avatar.startsWith('/uploads/')) {
                                    avatar = avatar.substring(9); 
                                }
                                gameState.observer.avatar = avatar;
                            }
                            
                            // Используем nickname из базы данных, если он существует
                            if (playerData.nickname) {
                                gameState.observer.name = playerData.nickname;
                            }
                        }
                    } catch (error) {
                        console.error('Ошибка при получении данных игрока:', error);
                    }
                }
                
                //console.log('Найден выбранный игрок в team3:', gameState.observer);
                break; // Прерываем цикл, так как нашли выбранного игрока
            }
        }
    }
}

        // Отправка обновленных данных клиентам
        io.emit('gsi', gameState);
        res.sendStatus(200);

    } catch (error) {
        console.error('Ошибка при обработке GSI данных:', error);
        res.sendStatus(500);
    }
});




// Socket.IO подключения
io.on('connection', (socket) => {
    //console.log('Клиент подключился');

    socket.on('ready', () => {
        // Отправляем текущее состояние игры
        socket.emit('gsi', gameState);
        
        // Получаем активный матч и данные команд
        db.get(`
            SELECT 
                m.*,
                t1.name as team1_name, t1.logo as team1_logo,
                t2.name as team2_name, t2.logo as team2_logo
            FROM matches m
            LEFT JOIN teams t1 ON m.team1_id = t1.id
            LEFT JOIN teams t2 ON m.team2_id = t2.id
            WHERE m.status = 'active'
            ORDER BY m.created_at DESC
            LIMIT 1
        `, [], (err, match) => {
            if (err) {
                //console.error('Ошибка при получении данных матча:', err);
                return;
            }
            
            if (match) {
                // Отправляем информацию о командах
                socket.emit('match_data', {
                    teams: {
                        team_1: {
                            team: {
                                name: match.team1_name,
                                logo: match.team1_logo
                            },
                            score: match.score_team1 || 0
                        },
                        team_2: {
                            team: {
                                name: match.team2_name,
                                logo: match.team2_logo
                            },
                            score: match.score_team2 || 0
                        }
                    },
                    match_status: 'active',
                    format: match.format || 'bo1'
                });
            } else {
                // Если нет активного матча, проверяем наличие ожидающих матчей
                db.get(`
                    SELECT 
                        m.*,
                        t1.name as team1_name, t1.logo as team1_logo,
                        t2.name as team2_name, t2.logo as team2_logo
                    FROM matches m
                    LEFT JOIN teams t1 ON m.team1_id = t1.id
                    LEFT JOIN teams t2 ON m.team2_id = t2.id
                    WHERE m.status = 'pending'
                    ORDER BY m.created_at DESC
                    LIMIT 1
                `, [], (err, pendingMatch) => {
                    if (err || !pendingMatch) return;
                    
                    // Отправляем информацию о командах из ожидающего матча
                    socket.emit('match_data', {
                        teams: {
                            team_1: {
                                team: {
                                    name: pendingMatch.team1_name,
                                    logo: pendingMatch.team1_logo
                                },
                                score: pendingMatch.score_team1 || 0
                            },
                            team_2: {
                                team: {
                                    name: pendingMatch.team2_name,
                                    logo: pendingMatch.team2_logo
                                },
                                score: pendingMatch.score_team2 || 0
                            }
                        },
                        match_status: 'pending',
                        format: 'bo1' // Всегда bo1 для pending матчей
                    });
                });
            }
        });
    });

    socket.on('disconnect', () => {
        //console.log('Клиент отключился');
    });
});



// Проверяем, что GSI сервер запущен на правильном порту
// Запускаем основной сервер



// Порты для серверов
const PORT = 2626;
const GSI_PORT = 1350;
const open = require('../node_modules/open'); // Указываем полный путь к модулю

// Функция запуска серверов
const startServers = async () => {
    try {
        // Запускаем основной сервер
        await new Promise((resolve) => {
            http.listen(PORT, () => {
                console.log('=================================');
                console.log(`Сервер запущен на http://${serverIP}:${PORT}`);
                console.log(`Socket.IO готов к подключениям`);
                console.log('=================================');
                
                // Используем альтернативный метод для Windows
                const { exec } = require('child_process');
                const platform = process.platform;
                const url = `http://${serverIP}:${PORT}`;

                let command;
                switch (platform) {
                    case 'win32':
                        command = `start ${url}`;
                        break;
                    case 'darwin':
                        command = `open ${url}`;
                        break;
                    case 'linux':
                        command = `xdg-open ${url}`;
                        break;
                    default:
                        console.log(`Платформа ${platform} не поддерживается для автоматического открытия браузера`);
                        return;
                }

                exec(command, (err) => {
                    if (err) {
                        console.error('Ошибка при открытии браузера:', err);
                    }
                });
                
                resolve();
            });
        });

        // Запускаем GSI сервер
        await new Promise((resolve) => {
            gsiServer.listen(GSI_PORT, () => {
                console.log(`GSI сервер запущен на порту ${GSI_PORT}`);
                resolve();
            });
        });

    } catch (error) {
        console.error('Ошибка при запуске серверов:', error);
        process.exit(1);
    }
};

// Запускаем серверы
startServers();

// Обработка ошибок процесса
process.on('uncaughtException', (error) => {
    console.error('Необработанное исключение:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Необработанное отклонение промиса:', error);
});