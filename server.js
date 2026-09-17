const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:รหัสผ่านของคุณ@localhost:5432/efootball_db',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const PORT = process.env.PORT || 5000;
  
// สร้าง API ทดสอบ
app.get('/', (req, res) => {
  res.send('ยินดีต้อนรับสู่ระบบหลังบ้าน eFootball Tournament API');
});
// ==========================================
// ส่วนของ API สำหรับจัดการตาราง teams
// ==========================================

// 1. API สำหรับดึงข้อมูลทีมทั้งหมด (GET)
app.get('/teams', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM teams ORDER BY id ASC');
    res.json(result.rows); // ส่งข้อมูลกลับไปเป็นรูปแบบ JSON
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการดึงข้อมูลทีม' });
  }
});

// 2. API สำหรับเพิ่มทีมใหม่ (POST)
app.post('/teams', async (req, res) => {
  try {
    const { name, logo_url } = req.body; // รับค่า ชื่อทีม และ ลิงก์โลโก้ จากหน้าเว็บ
    const newTeam = await pool.query(
      'INSERT INTO teams (name, logo_url) VALUES ($1, $2) RETURNING *',
      [name, logo_url]
    );
    res.json(newTeam.rows[0]); // ส่งข้อมูลทีมที่เพิ่งสร้างเสร็จกลับไป
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการเพิ่มทีม' });
  }
});
// ==========================================
// ==========================================
// ส่วนของ API สำหรับจัดการ ทัวร์นาเมนต์ และ ตารางแข่ง
// ==========================================

// 3. API สร้างทัวร์นาเมนต์และสร้างทีมใหม่เข้าไปพร้อมกัน (อัปเดตใหม่)
app.post('/tournaments', async (req, res) => {
  try {
    // เปลี่ยนมารับ team_names แทน team_ids
    const { name, type, league_format, team_names } = req.body; 
    
    // 3.1 บันทึกชื่อและรูปแบบทัวร์นาเมนต์
    const newTourney = await pool.query(
      'INSERT INTO tournaments (name, type, league_format) VALUES ($1, $2, $3) RETURNING *',
      [name, type, league_format]
    );
    const tournamentId = newTourney.rows[0].id;

    // 3.2 วนลูปสร้างทีมใหม่ และจับผูกเข้ากับทัวร์นาเมนต์
    for (let tName of team_names) {
      // เอาชื่อทีมไปสร้างในตาราง teams ก่อน
      const teamRes = await pool.query(
        'INSERT INTO teams (name, logo_url) VALUES ($1, $2) RETURNING id',
        [tName, '']
      );
      const newTeamId = teamRes.rows[0].id;

      // เอา ID ทีมที่เพิ่งสร้าง มาผูกกับทัวร์นาเมนต์
      await pool.query(
        'INSERT INTO tournament_teams (tournament_id, team_id) VALUES ($1, $2)',
        [tournamentId, newTeamId]
      );
    }

    res.json({ message: 'สร้างรายการสำเร็จ!', tournamentId: tournamentId });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการสร้างรายการ' });
  }
});


// 4. API จัดตารางแข่งขันอัตโนมัติ (สำหรับแบบลีค)
app.post('/tournaments/:id/generate-matches', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const tourneyRes = await pool.query('SELECT * FROM tournaments WHERE id = $1', [tournamentId]);
    const tourney = tourneyRes.rows[0];
    const teamsRes = await pool.query('SELECT team_id FROM tournament_teams WHERE tournament_id = $1', [tournamentId]);
    let teams = teamsRes.rows.map(t => t.team_id);

    if (teams.length < 2) return res.status(400).json({ error: 'ต้องมีอย่างน้อย 2 ทีม' });
    if (teams.length % 2 !== 0) teams.push(null);

    const numTeams = teams.length;
    const rounds = numTeams - 1;
    const half = numTeams / 2;
    let matchesToInsert = [];

    // 🧠 อัลกอริทึมจัดตารางเตะแบบพบกันหมด
    for (let round = 0; round < rounds; round++) {
      for (let i = 0; i < half; i++) {
        let home = teams[i];
        let away = teams[numTeams - 1 - i];
        if (home !== null && away !== null) {
          // ✅ เปลี่ยนคำว่า "รอบที่" เป็น "นัดที่"
          matchesToInsert.push({ home, away, match_round: `นัดที่ ${round + 1}` }); 
        }
      }
      teams.splice(1, 0, teams.pop());
    }

    // กรณีเป็นแบบ เหย้า-เยือน
    if (tourney.league_format === 'home_away') {
      const secondLegMatches = matchesToInsert.map(m => ({
        home: m.away,
        away: m.home,
        match_round: m.match_round + ' (เลก 2)' 
      }));
      matchesToInsert = matchesToInsert.concat(secondLegMatches);
    }

    for (let match of matchesToInsert) {
      await pool.query(
        'INSERT INTO matches (tournament_id, home_team_id, away_team_id, match_round) VALUES ($1, $2, $3, $4)',
        [tournamentId, match.home, match.away, match.match_round]
      );
    }

    res.json({ message: `จัดตารางแข่งลีคสำเร็จ! สร้างไปทั้งหมด ${matchesToInsert.length} แมตช์` });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการจัดตารางแข่ง' });
  }
});
// ==========================================
// 5. API ดึงข้อมูลตารางแข่งของทัวร์นาเมนต์
app.get('/tournaments/:id/matches', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    // ใช้ JOIN เพื่อดึงชื่อทีมของทั้งสองฝั่งมาแสดงด้วย
    const query = `
      SELECT m.*, 
             h.name as home_team_name, 
             a.name as away_team_name
      FROM matches m
      JOIN teams h ON m.home_team_id = h.id
      JOIN teams a ON m.away_team_id = a.id
      WHERE m.tournament_id = $1
      ORDER BY m.id ASC
    `;
    const result = await pool.query(query, [tournamentId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'ดึงข้อมูลตารางแข่งไม่ได้' });
  }
});

// 6. API อัปเดตผลสกอร์ (สำหรับแอดมินกรอกผล)
app.put('/matches/:id', async (req, res) => {
  try {
    const matchId = req.params.id;
    const { home_score, away_score } = req.body;
    await pool.query(
      'UPDATE matches SET home_score = $1, away_score = $2, is_played = true WHERE id = $3',
      [home_score, away_score, matchId]
    );
    res.json({ message: 'อัปเดตสกอร์เรียบร้อย!' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'อัปเดตสกอร์ไม่ได้' });
  }
});
// 7. API เพิ่มทีมใหม่และจับเข้าทัวร์นาเมนต์ทันที (ตามโฟลว์ใหม่)
app.post('/tournaments/:id/teams', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const { name, logo_url } = req.body;
    
    // 1. สร้างทีมใหม่ลงในระบบ
    const teamRes = await pool.query(
      'INSERT INTO teams (name, logo_url) VALUES ($1, $2) RETURNING *',
      [name, logo_url]
    );
    const newTeam = teamRes.rows[0];

    // 2. จับทีมนั้นผูกเข้ากับลีคปัจจุบัน
    await pool.query(
      'INSERT INTO tournament_teams (tournament_id, team_id) VALUES ($1, $2)',
      [tournamentId, newTeam.id]
    );

    res.json(newTeam);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'เพิ่มทีมลงลีคไม่ได้' });
  }
});
// 8. API คำนวณตารางคะแนนลีค (Standings) แบบเรียลไทม์
app.get('/tournaments/:id/standings', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    // คำสั่ง SQL รวมผลงานเหย้าและเยือน (ชนะ = 3 แต้ม, เสมอ = 1 แต้ม)
    const query = `
      WITH team_stats AS (
        SELECT home_team_id AS team_id, home_score AS gf, away_score AS ga,
          CASE WHEN home_score > away_score THEN 1 ELSE 0 END AS won,
          CASE WHEN home_score = away_score THEN 1 ELSE 0 END AS drawn,
          CASE WHEN home_score < away_score THEN 1 ELSE 0 END AS lost
        FROM matches WHERE tournament_id = $1 AND is_played = true
        UNION ALL
        SELECT away_team_id AS team_id, away_score AS gf, home_score AS ga,
          CASE WHEN away_score > home_score THEN 1 ELSE 0 END AS won,
          CASE WHEN away_score = home_score THEN 1 ELSE 0 END AS drawn,
          CASE WHEN away_score < home_score THEN 1 ELSE 0 END AS lost
        FROM matches WHERE tournament_id = $1 AND is_played = true
      )
      SELECT t.name,
        COUNT(ts.team_id) AS played,
        COALESCE(SUM(ts.won), 0) AS won,
        COALESCE(SUM(ts.drawn), 0) AS drawn,
        COALESCE(SUM(ts.lost), 0) AS lost,
        COALESCE(SUM(ts.gf), 0) AS gf,
        COALESCE(SUM(ts.ga), 0) AS ga,
        COALESCE(SUM(ts.gf) - SUM(ts.ga), 0) AS gd,
        COALESCE(SUM(ts.won) * 3 + SUM(ts.drawn) * 1, 0) AS points
      FROM tournament_teams tt
      JOIN teams t ON tt.team_id = t.id
      LEFT JOIN team_stats ts ON t.id = ts.team_id
      WHERE tt.tournament_id = $1
      GROUP BY t.id, t.name
      ORDER BY points DESC, gd DESC, gf DESC, t.name ASC;
    `;
    const result = await pool.query(query, [tournamentId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'คำนวณตารางคะแนนไม่ได้' });
  }
});
// 9. API จัดตารางบอลถ้วย (จับคู่รอบแรก และดึงคนชนะเข้ารอบต่อไป)
app.post('/tournaments/:id/generate-knockout', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    // ดึงแมตช์ทั้งหมดที่มีในตอนนี้ เพื่อเช็กว่าเคยเตะไปหรือยัง
    const matchRes = await pool.query('SELECT * FROM matches WHERE tournament_id = $1 ORDER BY id ASC', [tournamentId]);
    const existingMatches = matchRes.rows;

    let teamsToPair = [];

    if (existingMatches.length === 0) {
      // 📌 กรณียังไม่มีแมตช์เลย (เพิ่งสร้าง) -> ดึงทีมทั้งหมดมาจับคู่รอบแรก
      const teamsRes = await pool.query('SELECT team_id FROM tournament_teams WHERE tournament_id = $1', [tournamentId]);
      teamsToPair = teamsRes.rows.map(t => t.team_id);
    } else {
      // 📌 กรณีมีแมตช์แล้ว -> หารอบล่าสุด และดึงเฉพาะ "ผู้ชนะ" เข้ารอบ
      const lastRound = existingMatches[existingMatches.length - 1].match_round;
      const lastRoundMatches = existingMatches.filter(m => m.match_round === lastRound);

      for (let m of lastRoundMatches) {
        if (!m.is_played) return res.status(400).json({ error: 'ต้องกรอกผลรอบนี้ให้ครบทุกคู่ก่อนครับ' });
        if (m.home_score === m.away_score) return res.status(400).json({ error: 'บอลถ้วยห้ามเสมอ! (ให้รวมผลจุดโทษเข้าไปในสกอร์ได้เลยครับ)' });
        
        // คัดคนชนะ
        if (m.home_score > m.away_score) teamsToPair.push(m.home_team_id);
        else teamsToPair.push(m.away_team_id);
      }
    }

    // ถ้าเหลือทีมเดียว แปลว่าได้แชมป์แล้ว
    if (teamsToPair.length === 1) {
      return res.json({ message: '🏆 ได้ทีมแชมป์เรียบร้อยแล้ว!' });
    }

    // ตั้งชื่อรอบให้สวยงาม
    let roundName = `รอบ ${teamsToPair.length} ทีม`;
    if (teamsToPair.length === 4) roundName = 'รอบรองชนะเลิศ';
    if (teamsToPair.length === 2) roundName = 'รอบชิงชนะเลิศ';

    // จับคู่และสร้างแมตช์ลงฐานข้อมูล
    let matchCount = 0;
    for (let i = 0; i < teamsToPair.length; i += 2) {
      let home = teamsToPair[i];
      let away = teamsToPair[i+1];
      if (home && away) {
        await pool.query(
          'INSERT INTO matches (tournament_id, home_team_id, away_team_id, match_round) VALUES ($1, $2, $3, $4)',
          [tournamentId, home, away, roundName]
        );
        matchCount++;
      }
    }
    res.json({ message: `สร้างตาราง ${roundName} สำเร็จ!` });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการสร้างบอลถ้วย' });
  }
});
// 10. API ดึงรายการทัวร์นาเมนต์ทั้งหมด (สำหรับหน้า Dashboard)
app.get('/tournaments', async (req, res) => {
  try {
    // ดึงรายการทั้งหมด เรียงจากอันที่สร้างล่าสุดขึ้นก่อน (DESC)
    const result = await pool.query('SELECT * FROM tournaments ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'ดึงข้อมูลทัวร์นาเมนต์ไม่ได้' });
  }
});
// 11. API ดึงข้อมูลทัวร์นาเมนต์เดียวแบบเจาะจง
app.get('/tournaments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM tournaments WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบรายการนี้' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'ดึงข้อมูลไม่ได้' });
  }
});
// 12. API ลบรายการแข่งขัน
app.delete('/tournaments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // ลบรายการเดียว ข้อมูลตารางเตะจะถูกลบตามไปด้วยอัตโนมัติ (เพราะเราตั้ง ON DELETE CASCADE ไว้)
    await pool.query('DELETE FROM tournaments WHERE id = $1', [id]);
    res.json({ message: 'ลบรายการสำเร็จ' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'ลบรายการไม่ได้' });
  }
});

// 13. API รีเซ็ตผลการแข่งขัน (เปลี่ยนกลับไปเป็น VS)
app.put('/matches/:id/reset', async (req, res) => {
  try {
    const matchId = req.params.id;
    // ตั้งสกอร์เป็น 0 และปรับสถานะ is_played กลับเป็น false
    await pool.query(
      'UPDATE matches SET home_score = 0, away_score = 0, is_played = false WHERE id = $1',
      [matchId]
    );
    res.json({ message: 'รีเซ็ตสกอร์กลับเป็น VS เรียบร้อย!' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการรีเซ็ต' });
  }
});

// เริ่มเปิดเซิร์ฟเวอร์
app.listen(PORT, () => {
  console.log(`Server กำลังรันอยู่ที่ http://localhost:${PORT}`);
});