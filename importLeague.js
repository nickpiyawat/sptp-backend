const { Pool } = require('pg');

// ⚠️ อย่าลืมแก้รหัสผ่านให้ตรงกับของคอมพิวเตอร์คุณนะครับ
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'efootball_db',
  password: '1111', 
  port: 5432,
});

async function importSPTP() {
  try {
    console.log('⏳ กำลังสร้างรายการ ลีค SPTP ซีซั่น 5...');

    // 1. สร้างทัวร์นาเมนต์
    const tourneyRes = await pool.query(
      "INSERT INTO tournaments (name, type, league_format) VALUES ('ลีค SPTP ซีซั่น 5', 'league', 'single') RETURNING id"
    );
    const tourneyId = tourneyRes.rows[0].id;

    // 2. รายชื่อทีมตามที่คุณระบุเป๊ะๆ (เรียงลำดับ 1-14)
    const teamNames = [
      'นาย', 'บอย', 'กันต์', 'ชิด', 'ยิว', 'ก้อง', 'ธัน', 
      'หนึ่ง', 'เกี๊ยว', 'ปอง', 'วิน', 'เบิร์ด', 'บอส', 'นายเทพ'
    ];
    const teamIds = [];

    console.log('⏳ กำลังเพิ่มทีมและจัดตารางแข่ง...');
    for (let name of teamNames) {
      const res = await pool.query("INSERT INTO teams (name, logo_url) VALUES ($1, '') RETURNING id", [name]);
      const newId = res.rows[0].id;
      teamIds.push(newId);
      await pool.query("INSERT INTO tournament_teams (tournament_id, team_id) VALUES ($1, $2)", [tourneyId, newId]);
    }

    // 3. อัลกอริทึมจัดตารางที่สานต่อจาก 3 นัดแรกของคุณ!
    // ลำดับเวียน (Rotation Pattern) ที่แกะมาจากตาราง 3 นัดแรกของคุณ
    const k_seq = [12, 6, 0, 7, 1, 8, 2, 9, 3, 10, 4, 11, 5]; 

    for (let round = 1; round <= 13; round++) {
      const k = k_seq[round - 1];
      const matchesToInsert = [];

      // จับคู่ทีมแรก (นาย)
      matchesToInsert.push({ home: teamIds[0], away: teamIds[k + 1] });

      // จับคู่ทีมอื่นๆ
      for (let a = 0; a < 13; a++) {
        if (a === k) continue;
        let b = (2 * k - a + 13) % 13;
        if (a < b) {
          matchesToInsert.push({ home: teamIds[a + 1], away: teamIds[b + 1] });
        }
      }

      // บันทึกลงฐานข้อมูล
      for (let match of matchesToInsert) {
        await pool.query(
          "INSERT INTO matches (tournament_id, home_team_id, away_team_id, match_round) VALUES ($1, $2, $3, $4)",
          [tourneyId, match.home, match.away, `นัดที่ ${round}`]
        );
      }
    }

    console.log('🎉 นำเข้าข้อมูล ลีค SPTP ซีซั่น 5 สำเร็จ 100%!');
    console.log('✅ คุณสามารถปิดสคริปต์นี้และเข้าไปดูในหน้าเว็บได้เลยครับ');
    process.exit(0);

  } catch (err) {
    console.error('❌ เกิดข้อผิดพลาด:', err);
    process.exit(1);
  }
}

importSPTP();