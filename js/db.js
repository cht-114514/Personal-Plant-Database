/**
 * 植物资料库 - 数据库层
 * 使用 sql.js (SQLite WASM) 实现离线数据存储和全文搜索
 */

const BotanicalDB = {
  db: null,
  SQL: null,
  dbPath: 'data/botanical.db',

  /** 是否使用磁盘存储（API 服务器可用时为 true） */
  _diskMode: false,
  _dataAdapterTargetVersion: 2,
  _needsPostMigrationSave: false,

  /** 初始化数据库 */
  async init() {
    const SQL = await initSqlJs({
      locateFile: file => `lib/${file}`
    });
    this.SQL = SQL;

    // 检测 API 服务器是否可用（决定磁盘模式还是 IndexedDB 模式）
    this._diskMode = await this._checkDiskMode();

    let loaded = false;

    // 从磁盘加载 data/botanical.db
    try {
      const response = await fetch(this.dbPath);
      if (response.ok) {
        const buf = await response.arrayBuffer();
        this.db = new SQL.Database(new Uint8Array(buf));
        loaded = true;
      }
    } catch (e) {}

    // 磁盘没有数据，尝试 IndexedDB（可能有旧数据需要迁移）
    if (!loaded) {
      try {
        const idbData = await this._loadFromIndexedDB();
        if (idbData) {
          this.db = new SQL.Database(new Uint8Array(idbData));
          loaded = true;
          // 标记需要迁移
          if (this._diskMode) {
            console.log('检测到 IndexedDB 中有旧数据，将迁移到磁盘...');
            this._needsMigration = true;
          }
        }
      } catch (e) {
        console.log('IndexedDB 加载失败:', e);
      }
    }

    // 都没有数据，创建空数据库
    if (!loaded) {
      this.db = new SQL.Database();
      this.createSchema();
    }

    // 确保 schema 存在，并执行需要落盘的数据兼容适配
    this._needsPostMigrationSave = false;
    this.ensureSchema();
    await this._savePostMigrationIfNeeded('data-adapter');

    // 执行迁移：IndexedDB → 磁盘
    if (this._needsMigration && this._diskMode) {
      await this._migrateFromIndexedDB();
    }

    return this;
  },

  /** 检测 API 服务器是否可用 */
  async _checkDiskMode() {
    try {
      const resp = await fetch('/api/list-images', { method: 'GET' });
      return resp.ok;
    } catch (e) {
      return false;
    }
  },

  /** 将 IndexedDB 中的所有数据迁移到磁盘 */
  async _migrateFromIndexedDB() {
    console.log('开始迁移 IndexedDB 数据到磁盘...');
    try {
      // 1. 保存数据库到磁盘
      await this.saveDB();
      console.log('  数据库已迁移');

      // 2. 迁移所有图片
      const db = await this._openIDB();
      const tx = db.transaction('images', 'readonly');
      const store = tx.objectStore('images');
      const keys = await new Promise((resolve) => {
        const req = store.getAllKeys();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });

      let migrated = 0;
      for (const key of keys) {
        const blob = await new Promise((resolve) => {
          const req2 = store.get(key);
          req2.onsuccess = () => resolve(req2.result);
          req2.onerror = () => resolve(null);
        });
        if (blob) {
          await this._uploadImageToDisk(key, blob);
          migrated++;
        }
      }
      console.log(`  ${migrated} 张图片已迁移`);
      console.log('迁移完成！数据已安全保存到 data/ 目录');
    } catch (e) {
      console.error('迁移失败:', e);
    }
  },

  /** 创建数据库表结构 */
  createSchema() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS plants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        latin_name TEXT NOT NULL,
        chinese_name TEXT,
        genus TEXT,
        species_epithet TEXT,
        authority TEXT,
        kingdom TEXT DEFAULT '植物界 Plantae',
        phylum TEXT,
        class TEXT,
        "order" TEXT,
        family TEXT,
        description TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        parent_id INTEGER,
        infraspecific_rank TEXT,
        synonyms TEXT,
        description_habitat TEXT,
        description_distribution TEXT,
        description_altitude TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        file_path TEXT NOT NULL,
        ppbc_id TEXT,
        photographer TEXT,
        location TEXT,
        shot_date TEXT,
        admin_division TEXT,
        location_detail TEXT,
        is_primary INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS taxonomy_descriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        taxon_level TEXT NOT NULL,
        taxon_name TEXT NOT NULL,
        family TEXT,
        description TEXT DEFAULT '',
        key_data TEXT DEFAULT '[]',
        key_text TEXT DEFAULT '',
        references_text TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS dictionary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        latin_term TEXT NOT NULL,
        chinese_meaning TEXT,
        english_meaning TEXT,
        pronunciation TEXT
      );

      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_photos_plant_id ON photos(plant_id);
      CREATE INDEX IF NOT EXISTS idx_plants_genus ON plants(genus);
      CREATE INDEX IF NOT EXISTS idx_plants_family ON plants(family);
      CREATE INDEX IF NOT EXISTS idx_plants_parent ON plants(parent_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_taxdesc_level_name ON taxonomy_descriptions(taxon_level, taxon_name);
      CREATE INDEX IF NOT EXISTS idx_dict_latin ON dictionary(latin_term);
    `);
  },

  ensureSchema() {
    // Check if tables exist, create if not
    const tables = this.db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = tables.length > 0 ? tables[0].values.map(r => r[0]) : [];

    if (!tableNames.includes('plants') || !tableNames.includes('photos')) {
      this.createSchema();
      this._needsPostMigrationSave = true;
    }

    // v3: 检测是否首次升级到 v3（无 taxonomy_overrides 表 + 已有 plants 数据），先备份
    const isV3Upgrade = !tableNames.includes('taxonomy_overrides')
                      && tableNames.includes('plants');
    if (isV3Upgrade) {
      this._backupBeforeV3().catch(e => console.warn('备份请求失败（可继续）:', e));
    }

    // 迁移：为已有数据库添加新列
    this._migrateSchema();

    // 数据兼容适配：按版本执行，避免客户旧数据因代码/参考分类更新失效
    this._runDataAdapters();

    // v3: 行政区划数据导入（首次启动或表为空时）
    this._seedAdminDivisions();
  },

  /** 兼容适配后立即写回，避免客户覆盖更新后仍停留在旧数据结构/旧分类数据 */
  async _savePostMigrationIfNeeded(suffix = 'data-adapter') {
    if (!this._needsPostMigrationSave) return false;
    if (this._diskMode) {
      try {
        await fetch('/api/backup-db?suffix=' + encodeURIComponent(suffix), { method: 'POST' });
      } catch (e) {
        console.warn('兼容适配前备份失败（将继续保存）:', e);
      }
    }
    await this.saveDB();
    this._needsPostMigrationSave = false;
    return true;
  },

  /** v3: 升级前自动备份（仅磁盘模式，调用 server.py 复制 botanical.db.pre-v3.bak） */
  async _backupBeforeV3() {
    if (!this._diskMode) return;
    try {
      const resp = await fetch('/api/backup-db?suffix=pre-v3', { method: 'POST' });
      if (resp.ok) {
        console.log('v3 升级前备份已创建：data/botanical.db.pre-v3.bak');
      }
    } catch (e) {
      // 静默失败：API 不存在或服务器旧版本，不阻塞升级
    }
  },

  /** v3: 首次启动时从 data/admin_divisions.json 导入行政区划 */
  async _seedAdminDivisions() {
    try {
      const countRes = this.db.exec(`SELECT COUNT(*) FROM admin_divisions`);
      const count = countRes[0]?.values?.[0]?.[0] || 0;
      if (count > 0) return;

      const resp = await fetch('data/admin_divisions.json');
      if (!resp.ok) {
        console.warn('行政区划数据文件不存在 (data/admin_divisions.json)，跳过导入');
        return;
      }
      const rows = await resp.json();
      if (!Array.isArray(rows) || rows.length === 0) return;

      this.db.run('BEGIN TRANSACTION');
      const stmt = this.db.prepare(
        `INSERT OR REPLACE INTO admin_divisions (code, parent_code, level, name_zh, name_pinyin)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const row of rows) {
        stmt.run([row.code, row.parent_code || null, row.level, row.name_zh, row.name_pinyin || null]);
      }
      stmt.free();
      this.db.run('COMMIT');
      console.log(`行政区划导入完成：${rows.length} 条`);
      await this.saveDB();
    } catch (e) {
      try { this.db.run('ROLLBACK'); } catch (_) {}
      console.warn('行政区划导入失败:', e);
    }
  },

  /** 安全添加缺失的列（兼容旧数据库） */
  _migrateSchema() {
    const addColumnIfMissing = (table, column, type) => {
      const info = this.db.exec(`PRAGMA table_info(${table})`);
      if (info.length === 0) return;
      const cols = info[0].values.map(r => r[1]);
      if (!cols.includes(column)) {
        this.db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
        this._needsPostMigrationSave = true;
      }
    };

    const existingTablesRes = this.db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const existingTables = new Set(existingTablesRes.length > 0 ? existingTablesRes[0].values.map(r => r[0]) : []);

    // photos 表新增列
    addColumnIfMissing('photos', 'shot_date', 'TEXT');
    addColumnIfMissing('photos', 'admin_division', 'TEXT');
    addColumnIfMissing('photos', 'location_detail', 'TEXT');
    // v3: 行政区划码（国标 GBT 2260）
    addColumnIfMissing('photos', 'country_code', "TEXT DEFAULT 'CN'");
    addColumnIfMissing('photos', 'province_code', 'TEXT');
    addColumnIfMissing('photos', 'city_code', 'TEXT');
    addColumnIfMissing('photos', 'county_code', 'TEXT');

    // plants 表新增列
    addColumnIfMissing('plants', 'description', "TEXT DEFAULT ''");
    addColumnIfMissing('plants', 'parent_id', 'INTEGER');
    addColumnIfMissing('plants', 'infraspecific_rank', 'TEXT');
    addColumnIfMissing('plants', 'synonyms', 'TEXT');
    addColumnIfMissing('plants', 'description_habitat', 'TEXT');
    addColumnIfMissing('plants', 'description_distribution', 'TEXT');
    addColumnIfMissing('plants', 'description_altitude', 'TEXT');
    // v3: 双语字段
    addColumnIfMissing('plants', 'description_zh', 'TEXT');
    addColumnIfMissing('plants', 'description_en', 'TEXT');
    addColumnIfMissing('plants', 'description_habitat_zh', 'TEXT');
    addColumnIfMissing('plants', 'description_habitat_en', 'TEXT');
    addColumnIfMissing('plants', 'description_distribution_zh', 'TEXT');
    addColumnIfMissing('plants', 'description_distribution_en', 'TEXT');
    addColumnIfMissing('plants', 'description_altitude_zh', 'TEXT');
    addColumnIfMissing('plants', 'description_altitude_en', 'TEXT');
    // v3: 审定 + 来源 + 分类系统
    addColumnIfMissing('plants', 'status', "TEXT DEFAULT 'approved'");
    addColumnIfMissing('plants', 'data_source', 'TEXT');
    addColumnIfMissing('plants', 'taxonomy_system', 'TEXT');

    // 新表（CREATE IF NOT EXISTS 天然幂等）
    this.db.run(`
      CREATE TABLE IF NOT EXISTS taxonomy_descriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        taxon_level TEXT NOT NULL,
        taxon_name TEXT NOT NULL,
        family TEXT,
        description TEXT DEFAULT '',
        key_data TEXT DEFAULT '[]',
        key_text TEXT DEFAULT '',
        references_text TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS dictionary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        latin_term TEXT NOT NULL,
        chinese_meaning TEXT,
        english_meaning TEXT,
        pronunciation TEXT
      );

      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS admin_divisions (
        code TEXT PRIMARY KEY,
        parent_code TEXT,
        level TEXT,
        name_zh TEXT,
        name_pinyin TEXT
      );

      CREATE TABLE IF NOT EXISTS pending_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        target_table TEXT,
        target_id INTEGER,
        payload_json TEXT,
        reason TEXT,
        status TEXT DEFAULT 'pending',
        resolution_target_id INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        resolved_at TEXT
      );

      CREATE TABLE IF NOT EXISTS taxonomy_overrides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
        system TEXT NOT NULL,
        phylum TEXT,
        class TEXT,
        "order" TEXT,
        family TEXT,
        genus TEXT,
        reason TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);

    // 索引
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_plants_parent ON plants(parent_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_taxdesc_level_name ON taxonomy_descriptions(taxon_level, taxon_name);
      CREATE INDEX IF NOT EXISTS idx_dict_latin ON dictionary(latin_term);
      CREATE INDEX IF NOT EXISTS idx_admin_parent ON admin_divisions(parent_code);
      CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_changes(status);
      CREATE INDEX IF NOT EXISTS idx_pending_kind ON pending_changes(kind, status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_override_plant_system ON taxonomy_overrides(plant_id, system);
      CREATE INDEX IF NOT EXISTS idx_plants_status ON plants(status);
      CREATE INDEX IF NOT EXISTS idx_photos_county ON photos(county_code);
      CREATE INDEX IF NOT EXISTS idx_photos_province ON photos(province_code);
    `);

    const expectedTables = [
      'taxonomy_descriptions', 'dictionary', 'app_meta', 'admin_divisions',
      'pending_changes', 'taxonomy_overrides'
    ];
    if (expectedTables.some(name => !existingTables.has(name))) {
      this._needsPostMigrationSave = true;
    }
  },

  _getMeta(key, fallback = '') {
    try {
      const res = this.db.exec(`SELECT value FROM app_meta WHERE key = ?`, [key]);
      return res[0]?.values?.[0]?.[0] ?? fallback;
    } catch (e) {
      return fallback;
    }
  },

  _setMeta(key, value) {
    this.db.run(
      `INSERT OR REPLACE INTO app_meta (key, value, updated_at)
       VALUES (?, ?, datetime('now'))`,
      [key, String(value)]
    );
  },

  _countValue(sql, params = []) {
    const res = this.db.exec(sql, params);
    return res[0]?.values?.[0]?.[0] || 0;
  },

  _runDataAdapters() {
    const adapters = [
      [1, () => this._normalizeKnownTaxonomy()],
      [2, () => this._backfillTaxonomySkeletons()]
    ];
    for (const [version, fn] of adapters) {
      const before = Number(this._getMeta('data_adapter_version', '0')) || 0;
      if (before >= version) continue;
      this._applyDataAdapter(version, fn);
      const after = Number(this._getMeta('data_adapter_version', '0')) || 0;
      if (after < version) break;
    }
  },

  _applyDataAdapter(version, fn) {
    const current = Number(this._getMeta('data_adapter_version', '0')) || 0;
    if (current >= version) return false;

    try {
      const changed = Boolean(fn());
      this._setMeta('data_adapter_version', version);
      this._setMeta('data_adapter_last_run', new Date().toISOString());
      this._needsPostMigrationSave = true;
      console.log(`数据兼容适配 v${version} 已完成${changed ? '' : '（无数据变更）'}`);
      return true;
    } catch (e) {
      console.warn(`数据兼容适配 v${version} 失败，应用将继续启动:`, e);
      return false;
    }
  },

  /** v1: 根据已知裸子植物目修正旧库里的门/纲，覆盖更新后自动跟上参考分类修订 */
  _normalizeKnownTaxonomy() {
    const gymnospermOrders = [
      '松目 Pinales',
      '柏目 Cupressales',
      '红豆杉目 Taxales',
      '银杏目 Ginkgoales',
      '苏铁目 Cycadales',
      '买麻藤目 Gnetales'
    ];
    const placeholders = gymnospermOrders.map(() => '?').join(', ');
    const where = `
      "order" IN (${placeholders})
      AND (
        phylum IS NULL OR phylum = '' OR phylum LIKE '%被子%' OR phylum LIKE '%Angiosperm%'
        OR class IS NULL OR class = '' OR class LIKE '%木兰%' OR class LIKE '%Magnoliopsida%'
      )
    `;
    const count = this._countValue(`SELECT COUNT(*) FROM plants WHERE ${where}`, gymnospermOrders);
    if (count === 0) return false;

    this.db.run(`
      UPDATE plants
      SET phylum = ?,
          class = ?,
          taxonomy_system = CASE
            WHEN taxonomy_system IS NULL OR taxonomy_system = '' THEN ?
            ELSE taxonomy_system
          END,
          updated_at = datetime('now')
      WHERE ${where}
    `, ['裸子植物门 Gymnospermae', '松纲 Pinopsida', 'Yang-2017', ...gymnospermOrders]);
    return true;
  },

  /** v2: 为旧库已有分类补齐可编辑骨架，避免分类页/FOC 导入遇到空记录 */
  _backfillTaxonomySkeletons() {
    const results = this.db.exec(`
      SELECT * FROM plants
      WHERE status IS NULL OR status = 'approved'
    `);
    const plants = this._toObjects(results);
    let created = 0;
    for (const plant of plants) {
      created += this.ensureTaxonomyDescriptionsForPlant(plant) || 0;
    }
    return created > 0;
  },

  // ==================== 植物 CRUD ====================

  /** 获取所有植物（含主图路径，v3: 排除待审定） */
  getAllPlants() {
    const results = this.db.exec(`
      SELECT p.*, ph.file_path as primary_photo
      FROM plants p
      LEFT JOIN photos ph ON ph.plant_id = p.id AND ph.is_primary = 1
      WHERE p.status IS NULL OR p.status = 'approved'
      ORDER BY p.family, p.genus, p.chinese_name
    `);
    return this._toObjects(results);
  },

  /** 获取单个植物详情 */
  getPlant(id) {
    const results = this.db.exec(`SELECT * FROM plants WHERE id = ?`, [id]);
    const plants = this._toObjects(results);
    return plants.length > 0 ? plants[0] : null;
  },

  /** 获取植物的所有照片 */
  getPlantPhotos(plantId) {
    const results = this.db.exec(
      `SELECT * FROM photos WHERE plant_id = ? ORDER BY is_primary DESC, created_at`,
      [plantId]
    );
    return this._toObjects(results);
  },

  /** 添加新植物（v3: 支持 status, data_source） */
  addPlant(data) {
    this.db.run(`
      INSERT INTO plants (latin_name, chinese_name, genus, species_epithet, authority,
                          kingdom, phylum, class, "order", family, notes,
                          status, data_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      data.latin_name, data.chinese_name, data.genus, data.species_epithet, data.authority,
      data.kingdom || '植物界 Plantae', data.phylum, data.class, data.order, data.family,
      data.notes || '',
      data.status || 'approved', data.data_source || null
    ]);
    // 返回插入的 ID
    const res = this.db.exec('SELECT last_insert_rowid()');
    return res[0].values[0][0];
  },

  /** 按拉丁名查找植物 */
  findPlantByLatinName(latinName) {
    const results = this.db.exec(
      `SELECT * FROM plants WHERE latin_name = ?`,
      [latinName]
    );
    const plants = this._toObjects(results);
    return plants.length > 0 ? plants[0] : null;
  },

  /** 添加照片 */
  addPhoto(data) {
    this.db.run(`
      INSERT INTO photos (plant_id, filename, file_path, ppbc_id, photographer, location, shot_date, admin_division, location_detail, is_primary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      data.plant_id, data.filename, data.file_path,
      data.ppbc_id, data.photographer, data.location,
      data.shot_date || null, data.admin_division || null, data.location_detail || null,
      data.is_primary ? 1 : 0
    ]);
  },

  /** 更新植物笔记 */
  updateNotes(plantId, notes) {
    this.db.run(
      `UPDATE plants SET notes = ?, updated_at = datetime('now') WHERE id = ?`,
      [notes, plantId]
    );
  },

  /** 更新植物简介 */
  updateDescription(plantId, description) {
    this.db.run(
      `UPDATE plants SET description = ?, updated_at = datetime('now') WHERE id = ?`,
      [description, plantId]
    );
  },

  /** 删除单张照片（自动提升下一张为主图） */
  deletePhoto(photoId) {
    // 先获取照片信息
    const res = this.db.exec(`SELECT plant_id, is_primary FROM photos WHERE id = ?`, [photoId]);
    if (res.length === 0) return;
    const photo = this._toObjects(res)[0];

    this.db.run(`DELETE FROM photos WHERE id = ?`, [photoId]);

    // 如果删的是主图，提升下一张
    if (photo.is_primary) {
      this.db.run(
        `UPDATE photos SET is_primary = 1 WHERE plant_id = ? AND id = (SELECT MIN(id) FROM photos WHERE plant_id = ?)`,
        [photo.plant_id, photo.plant_id]
      );
    }

    return photo.plant_id;
  },

  /** 删除整个植物记录（含所有照片） */
  deletePlant(plantId) {
    this.db.run(`DELETE FROM photos WHERE plant_id = ?`, [plantId]);
    this.db.run(`DELETE FROM plants WHERE id = ?`, [plantId]);
  },

  /** 更新照片元数据（v3: 支持行政区划码） */
  updatePhoto(photoId, data) {
    const fields = [];
    const values = [];
    const allowed = ['photographer', 'location', 'admin_division', 'location_detail', 'shot_date',
                     'country_code', 'province_code', 'city_code', 'county_code'];
    for (const key of allowed) {
      if (key in data) {
        fields.push(`${key} = ?`);
        values.push(data[key]);
      }
    }
    if (fields.length === 0) return;
    values.push(photoId);
    this.db.run(`UPDATE photos SET ${fields.join(', ')} WHERE id = ?`, values);
  },

  // ==================== 搜索 ====================

  /** 模糊搜索植物（中文名、拉丁名、地点、科属等） */
  search(query) {
    if (!query || query.trim().length === 0) return this.getAllPlants();

    const q = query.trim();
    // 使用 LIKE 进行模糊匹配（支持中文字符级匹配）
    const likeQ = `%${q}%`;

    const results = this.db.exec(`
      SELECT DISTINCT p.*, ph.file_path as primary_photo
      FROM plants p
      LEFT JOIN photos ph ON ph.plant_id = p.id AND ph.is_primary = 1
      LEFT JOIN photos ph2 ON ph2.plant_id = p.id
      WHERE (p.status IS NULL OR p.status = 'approved')
        AND (p.chinese_name LIKE ?
         OR p.latin_name LIKE ?
         OR p.family LIKE ?
         OR p.genus LIKE ?
         OR p.notes LIKE ?
         OR ph2.location LIKE ?
         OR ph2.photographer LIKE ?
         OR ph2.admin_division LIKE ?
         OR ph2.location_detail LIKE ?)
      ORDER BY
        CASE
          WHEN p.chinese_name LIKE ? THEN 1
          WHEN p.latin_name LIKE ? THEN 2
          WHEN p.family LIKE ? THEN 3
          ELSE 4
        END,
        p.family, p.genus, p.chinese_name
    `, [likeQ, likeQ, likeQ, likeQ, likeQ, likeQ, likeQ, likeQ, likeQ, likeQ, likeQ, likeQ]);

    return this._toObjects(results);
  },

  // ==================== 分类树 ====================

  /** 构建分类树数据（v3: 排除待审定） */
  getTaxonomyTree() {
    const results = this.db.exec(`
      SELECT DISTINCT kingdom, phylum, class, "order", family, genus,
             COUNT(*) as species_count
      FROM plants
      WHERE family IS NOT NULL
        AND (status IS NULL OR status = 'approved')
      GROUP BY kingdom, phylum, class, "order", family, genus
      ORDER BY kingdom, phylum, class, "order", family, genus
    `);

    const rows = this._toObjects(results);
    return this._buildTree(rows);
  },

  /** 按分类级别过滤植物（v3: 排除待审定） */
  getPlantsByTaxon(level, value) {
    const validLevels = ['kingdom', 'phylum', 'class', '"order"', 'family', 'genus'];
    const dbLevel = level === 'order' ? '"order"' : level;

    if (!validLevels.includes(dbLevel)) return [];

    const results = this.db.exec(`
      SELECT p.*, ph.file_path as primary_photo
      FROM plants p
      LEFT JOIN photos ph ON ph.plant_id = p.id AND ph.is_primary = 1
      WHERE p.${dbLevel} = ?
        AND (p.status IS NULL OR p.status = 'approved')
      ORDER BY p.genus, p.chinese_name
    `, [value]);

    return this._toObjects(results);
  },

  /** 获取统计信息（v3: 仅统计已审定） */
  getStats() {
    const res = this.db.exec(`
      SELECT
        (SELECT COUNT(*) FROM plants WHERE status IS NULL OR status = 'approved') as total_plants,
        (SELECT COUNT(*) FROM photos) as total_photos,
        (SELECT COUNT(DISTINCT family) FROM plants WHERE family IS NOT NULL AND (status IS NULL OR status = 'approved')) as total_families,
        (SELECT COUNT(DISTINCT genus) FROM plants WHERE genus IS NOT NULL AND (status IS NULL OR status = 'approved')) as total_genera
    `);
    return this._toObjects(res)[0] || { total_plants: 0, total_photos: 0, total_families: 0, total_genera: 0 };
  },

  // ==================== 数据库持久化 ====================

  /** 导出数据库为二进制数据 */
  exportDB() {
    return this.db.export();
  },

  /** 从磁盘重新加载数据库（恢复备份后使用） */
  async reloadFromDisk() {
    if (!this.SQL) throw new Error('数据库引擎尚未初始化');
    const response = await fetch(this.dbPath + '?t=' + Date.now());
    if (!response.ok) throw new Error('无法读取数据库文件');
    const buf = await response.arrayBuffer();
    this.db = new this.SQL.Database(new Uint8Array(buf));
    this._needsPostMigrationSave = false;
    this.ensureSchema();
    await this._savePostMigrationIfNeeded('reload-data-adapter');
    return true;
  },

  /** 用用户选择的数据库文件替换当前数据库 */
  async restoreDBFromArrayBuffer(buffer) {
    if (!this.SQL) throw new Error('数据库引擎尚未初始化');
    if (this._diskMode) {
      const suffix = 'pre-restore-' + new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
      try {
        await fetch('/api/backup-db?suffix=' + encodeURIComponent(suffix), { method: 'POST' });
      } catch (e) {
        console.warn('恢复前备份失败，将继续尝试恢复:', e);
      }
    }
    this.db = new this.SQL.Database(new Uint8Array(buffer));
    this._needsPostMigrationSave = false;
    this.ensureSchema();
    await this.saveDB();
    this._needsPostMigrationSave = false;
    return true;
  },

  /** 保存数据库（磁盘模式写文件，否则写 IndexedDB） */
  async saveDB() {
    const data = this.exportDB();

    if (this._diskMode) {
      // 写回磁盘
      const blob = new Blob([data], { type: 'application/octet-stream' });
      try {
        const resp = await fetch('/api/save-db', { method: 'POST', body: blob });
        if (resp.ok) return true;
      } catch (e) {
        console.error('保存到磁盘失败，回退到 IndexedDB:', e);
        if (typeof window !== 'undefined' && window.$toast) {
          window.$toast.warning('保存到磁盘失败，已尝试回退到浏览器存储');
        }
      }
    }

    // 回退到 IndexedDB
    return this._saveToIndexedDB(data);
  },

  /** IndexedDB 版本号（增加 images store） */
  _idbVersion: 2,

  _openIDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('BotanicalDB', this._idbVersion);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('db')) {
          db.createObjectStore('db');
        }
        if (!db.objectStoreNames.contains('images')) {
          db.createObjectStore('images');
        }
      };
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = () => reject(request.error);
    });
  },

  async _saveToIndexedDB(data) {
    const db = await this._openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('db', 'readwrite');
      tx.objectStore('db').put(data, 'botanical');
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  async _loadFromIndexedDB() {
    const db = await this._openIDB();
    return new Promise((resolve) => {
      const tx = db.transaction('db', 'readonly');
      const getReq = tx.objectStore('db').get('botanical');
      getReq.onsuccess = () => resolve(getReq.result || null);
      getReq.onerror = () => resolve(null);
    });
  },

  // ==================== 图片存储 ====================

  /** 图片 URL 缓存 */
  _imageURLCache: {},

  /** 上传图片到磁盘 */
  async _uploadImageToDisk(filePath, blob) {
    const resp = await fetch('/api/upload-image', {
      method: 'POST',
      headers: { 'X-Filename': encodeURIComponent(filePath) },
      body: blob
    });
    return resp.ok;
  },

  /** 保存图片（磁盘模式写文件，否则写 IndexedDB） */
  async saveImage(filePath, blob) {
    if (this._diskMode) {
      return this._uploadImageToDisk(filePath, blob);
    }
    // 回退到 IndexedDB
    const db = await this._openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readwrite');
      tx.objectStore('images').put(blob, filePath);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  /** 获取图片 URL */
  async getImageURL(filePath) {
    if (this._imageURLCache[filePath]) return this._imageURLCache[filePath];

    if (this._diskMode) {
      // 磁盘模式：直接返回文件路径
      const url = 'data/images/' + filePath;
      this._imageURLCache[filePath] = url;
      return url;
    }

    // IndexedDB 模式
    const db = await this._openIDB();
    return new Promise((resolve) => {
      const tx = db.transaction('images', 'readonly');
      const getReq = tx.objectStore('images').get(filePath);
      getReq.onsuccess = () => {
        if (getReq.result) {
          const url = URL.createObjectURL(getReq.result);
          this._imageURLCache[filePath] = url;
          resolve(url);
        } else {
          resolve('data/images/' + filePath);
        }
      };
      getReq.onerror = () => resolve('data/images/' + filePath);
    });
  },

  /** 批量获取图片 URL */
  async getImageURLsBatch(filePaths) {
    const result = {};

    if (this._diskMode) {
      // 磁盘模式：直接拼路径，不需要 IndexedDB
      for (const fp of filePaths) {
        const url = 'data/images/' + fp;
        this._imageURLCache[fp] = url;
        result[fp] = url;
      }
      return result;
    }

    // IndexedDB 模式
    const uncached = [];
    for (const fp of filePaths) {
      if (this._imageURLCache[fp]) {
        result[fp] = this._imageURLCache[fp];
      } else {
        uncached.push(fp);
      }
    }
    if (uncached.length === 0) return result;

    const db = await this._openIDB();
    return new Promise((resolve) => {
      const tx = db.transaction('images', 'readonly');
      const store = tx.objectStore('images');
      let pending = uncached.length;

      for (const fp of uncached) {
        const req = store.get(fp);
        req.onsuccess = () => {
          if (req.result) {
            const url = URL.createObjectURL(req.result);
            this._imageURLCache[fp] = url;
            result[fp] = url;
          }
          if (--pending === 0) resolve(result);
        };
        req.onerror = () => {
          if (--pending === 0) resolve(result);
        };
      }
    });
  },

  /** 删除图片 */
  async deleteImage(filePath) {
    delete this._imageURLCache[filePath];
    if (this._diskMode) {
      try {
        await fetch('/api/delete-image?file=' + encodeURIComponent(filePath), { method: 'DELETE' });
      } catch (e) {}
      return;
    }
    // IndexedDB 模式
    try {
      const db = await this._openIDB();
      const tx = db.transaction('images', 'readwrite');
      tx.objectStore('images').delete(filePath);
    } catch (e) {}
  },

  // ==================== V2: 词典搜索 ====================

  /** 前缀匹配搜索词典 */
  searchDictionary(query) {
    if (!query || query.trim().length < 2) return [];
    const q = query.trim().toLowerCase();
    const results = this.db.exec(`
      SELECT * FROM dictionary
      WHERE latin_term LIKE ?
      ORDER BY
        CASE WHEN LOWER(latin_term) = ? THEN 0
             WHEN LOWER(latin_term) LIKE ? THEN 1
             ELSE 2
        END,
        latin_term
      LIMIT 20
    `, [`${q}%`, q, `${q}%`]);
    return this._toObjects(results);
  },

  // ==================== V2: 分类描述 ====================

  /** 查询科/属介绍 */
  getTaxonomyDescription(level, name) {
    const results = this.db.exec(
      `SELECT * FROM taxonomy_descriptions WHERE taxon_level = ? AND taxon_name = ?`,
      [level, name]
    );
    const rows = this._toObjects(results);
    return rows.length > 0 ? rows[0] : null;
  },

  /** 保存科/属介绍（INSERT OR REPLACE） */
  saveTaxonomyDescription(data) {
    // 先尝试查找已有记录
    const existing = this.getTaxonomyDescription(data.taxon_level, data.taxon_name);
    if (existing) {
      this.db.run(`
        UPDATE taxonomy_descriptions SET description = ?, key_data = ?, key_text = ?,
        references_text = ?, family = ?, updated_at = datetime('now')
        WHERE id = ?
      `, [data.description || '', data.key_data || '[]', data.key_text || '',
          data.references_text || '', data.family || '', existing.id]);
    } else {
      this.db.run(`
        INSERT INTO taxonomy_descriptions (taxon_level, taxon_name, family, description, key_data, key_text, references_text)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [data.taxon_level, data.taxon_name, data.family || '',
          data.description || '', data.key_data || '[]', data.key_text || '', data.references_text || '']);
    }
  },

  /** 为新增物种/分类补齐空的分类描述骨架，保证分类页能直接编辑或导入 FOC */
  ensureTaxonomyDescriptionsForPlant(plantOrId) {
    const plant = typeof plantOrId === 'number' ? this.getPlant(plantOrId) : plantOrId;
    if (!plant) return 0;
    const familyLatin = this._extractLatinTaxonName(plant.family);
    let created = 0;
    const rows = [
      ['phylum', plant.phylum],
      ['class', plant.class],
      ['order', plant.order],
      ['family', plant.family],
      ['genus', plant.genus]
    ];
    for (const [level, rawName] of rows) {
      const taxonName = level === 'genus' ? rawName : this._extractLatinTaxonName(rawName);
      if (!taxonName) continue;
      try {
        if (!this.getTaxonomyDescription(level, taxonName)) {
          this.saveTaxonomyDescription({
            taxon_level: level,
            taxon_name: taxonName,
            family: familyLatin || '',
            description: '',
            key_data: '[]',
            key_text: '',
            references_text: ''
          });
          created++;
        }
      } catch (e) {
        console.warn('创建分类骨架失败:', level, rawName, e);
      }
    }
    return created;
  },

  /** 更新分类描述的单个字段 */
  updateTaxonomyDescription(id, field, value) {
    const allowed = ['description', 'key_data', 'key_text', 'references_text'];
    if (!allowed.includes(field)) return;
    this.db.run(
      `UPDATE taxonomy_descriptions SET ${field} = ?, updated_at = datetime('now') WHERE id = ?`,
      [value, id]
    );
  },

  // ==================== V2: 种下分类 ====================

  /** 获取种下分类群 */
  getInfraspecificTaxa(parentId) {
    const results = this.db.exec(
      `SELECT p.*, ph.file_path as primary_photo FROM plants p
       LEFT JOIN photos ph ON ph.plant_id = p.id AND ph.is_primary = 1
       WHERE p.parent_id = ? ORDER BY p.infraspecific_rank, p.latin_name`,
      [parentId]
    );
    return this._toObjects(results);
  },

  /** 统计某属下已收录的种级物种数(不含种下分类群) */
  countSpeciesInGenus(genus) {
    if (!genus) return 0;
    const results = this.db.exec(
      `SELECT COUNT(*) FROM plants WHERE genus = ? AND parent_id IS NULL`,
      [genus]
    );
    if (!results || !results.length) return 0;
    return results[0].values[0][0] || 0;
  },

  /** 按 genus + species_epithet 查找植物（去重用） */
  findPlantByBinomial(genus, epithet) {
    const results = this.db.exec(
      `SELECT * FROM plants WHERE genus = ? AND species_epithet = ? AND parent_id IS NULL`,
      [genus, epithet]
    );
    const plants = this._toObjects(results);
    return plants.length > 0 ? plants[0] : null;
  },

  /** PPBC 导入：按完整拉丁 + 种加词(含种下) + 中文名 解析目标物种（含种下分类行） */
  findPlantForPPBC(parsed) {
    if (!parsed) return null;
    const normCn = (s) =>
      (s || '')
        .normalize('NFKC')
        .replace(/[\s\u3000\u200b-\u200d\ufeff]+/g, '')
        .toLowerCase();
    const normLat = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const parsedCn = normCn(parsed.chinese_name);
    const pl = normLat(parsed.latin_name);

    if (pl && !pl.startsWith('[ppbc')) {
      let r = this.findPlantByLatinName(parsed.latin_name);
      if (r && parsedCn && normCn(r.chinese_name) !== parsedCn) {
        r = null;
      } else if (r) {
        return r;
      }
      const ci = this._toObjects(
        this.db.exec(`SELECT * FROM plants WHERE lower(trim(latin_name)) = ?`, [pl])
      );
      if (ci.length >= 1) {
        if (parsedCn) {
          const byCn = ci.filter((row) => normCn(row.chinese_name) === parsedCn);
          if (byCn.length === 1) return byCn[0];
        }
        if (ci.length === 1) {
          const one = ci[0];
          if (!parsedCn || normCn(one.chinese_name) === parsedCn) return one;
        }
      }
    }

    if (!parsed.genus || !parsed.species_epithet) return null;

    const fullEp = parsed.species_epithet.trim();
    const genusLower = String(parsed.genus).toLowerCase();
    const rowsFull = this._toObjects(
      this.db.exec(
        `SELECT * FROM plants WHERE lower(genus) = ? AND trim(species_epithet) = ?`,
        [genusLower, fullEp]
      )
    );
    if (rowsFull.length === 1) {
      const one = rowsFull[0];
      if (!parsedCn || normCn(one.chinese_name) === parsedCn) return one;
    }
    if (rowsFull.length > 1 && parsedCn) {
      const hit = rowsFull.find((row) => normCn(row.chinese_name) === parsedCn);
      if (hit) return hit;
    }

    const firstTok = fullEp.split(/\s+/)[0];
    const rowsSp = this._toObjects(
      this.db.exec(
        `SELECT * FROM plants WHERE lower(genus) = ? AND trim(species_epithet) = ?`,
        [genusLower, firstTok]
      )
    );
    if (rowsSp.length === 1) {
      const only = rowsSp[0];
      const onlyL = normLat(only.latin_name || '');
      const cnMatch = !parsedCn || normCn(only.chinese_name) === parsedCn;
      const plIsLongerInfraspecific = !!(pl && onlyL && pl.startsWith(onlyL + ' ') && pl.length > onlyL.length);
      if (parsedCn && !cnMatch && rowsFull.length > 0) {
        const byCn = rowsFull.find((row) => normCn(row.chinese_name) === parsedCn);
        if (byCn) return byCn;
      }
      if (cnMatch && !plIsLongerInfraspecific) return only;
    }

    const likeRows = this._toObjects(
      this.db.exec(
        `SELECT * FROM plants WHERE lower(genus) = ?
         AND (species_epithet LIKE ? OR species_epithet LIKE ? OR latin_name LIKE ?)`,
        [genusLower, `${firstTok} %`, `% ${firstTok} %`, `% ${firstTok} %`]
      )
    );
    if (likeRows.length === 0) return null;
    if (parsedCn) {
      const exactCn = likeRows.filter((row) => normCn(row.chinese_name) === parsedCn);
      if (exactCn.length === 1) return exactCn[0];
      if (exactCn.length > 1) {
        let best = null;
        for (const c of exactCn) {
          const cl = normLat(c.latin_name);
          if (pl && (cl === pl || pl.startsWith(cl + ' ') || cl.startsWith(pl + ' '))) {
            if (!best || (c.latin_name || '').length > (best.latin_name || '').length) best = c;
          }
        }
        if (best) return best;
        return exactCn[0];
      }
    }
    if (pl) {
      let best = null;
      for (const c of likeRows) {
        const cl = normLat(c.latin_name);
        if (cl === pl || (pl.startsWith(cl + ' ') && pl.length > cl.length)) {
          if (!best || (c.latin_name || '').length > (best.latin_name || '').length) best = c;
        }
      }
      if (best) return best;
    }
    if (parsedCn && likeRows.length > 1) {
      const se = (row) => String(row.species_epithet || '').trim();
      const rankIn = (s) => /\b(var\.|subsp\.|ssp\.|f\.)\b/i.test(s || '');
      const parentLike = likeRows.find((row) =>
        !row.parent_id
        && String(row.genus || '').toLowerCase() === genusLower
        && se(row) === firstTok
        && !rankIn(row.latin_name)
      );
      if (parentLike && normCn(parentLike.chinese_name) !== parsedCn) {
        const byCn = likeRows.find(
          (row) => row.id !== parentLike.id && normCn(row.chinese_name) === parsedCn
        );
        if (byCn) return byCn;
      }
    }
    return likeRows[0];
  },

  /** 更新植物任意文本字段 */
  updatePlantField(plantId, field, value) {
    const allowed = ['description', 'notes', 'synonyms', 'description_habitat',
                     'description_distribution', 'description_altitude', 'chinese_name'];
    if (!allowed.includes(field)) return;
    this.db.run(
      `UPDATE plants SET ${field} = ?, updated_at = datetime('now') WHERE id = ?`,
      [value, plantId]
    );
  },

  /** FOC 合并：仅填充空字段 */
  mergeFOCData(plantId, data) {
    const fields = ['description', 'description_habitat', 'description_distribution',
                    'description_altitude', 'synonyms',
                    'description_zh', 'description_en',
                    'description_habitat_zh', 'description_habitat_en',
                    'description_distribution_zh', 'description_distribution_en',
                    'description_altitude_zh', 'description_altitude_en'];
    const updates = [];
    const params = [];
    for (const f of fields) {
      if (data[f]) {
        updates.push(`${f} = CASE WHEN ${f} IS NULL OR ${f} = '' THEN ? ELSE ${f} END`);
        params.push(data[f]);
      }
    }
    if (updates.length === 0) return;
    params.push(plantId);
    this.db.run(
      `UPDATE plants SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      params
    );
  },

  // ==================== V3: 行政区划 ====================

  /** 按父级 code 获取下一级行政区划（parent_code 为 'CN' 返回省，省 code 返回市，市 code 返回县） */
  getAdminDivisions(parentCode) {
    const results = this.db.exec(
      `SELECT * FROM admin_divisions WHERE parent_code = ? ORDER BY code`,
      [parentCode || 'CN']
    );
    return this._toObjects(results);
  },

  /** 按 code 获取单个行政区划及其层级路径（面包屑） */
  getAdminDivisionByCode(code) {
    const results = this.db.exec(`SELECT * FROM admin_divisions WHERE code = ?`, [code]);
    const rows = this._toObjects(results);
    if (rows.length === 0) return null;
    const node = rows[0];
    const breadcrumb = [node];
    let current = node;
    while (current.parent_code && current.parent_code !== 'CN') {
      const parentRes = this.db.exec(`SELECT * FROM admin_divisions WHERE code = ?`, [current.parent_code]);
      const parents = this._toObjects(parentRes);
      if (parents.length === 0) break;
      breadcrumb.unshift(parents[0]);
      current = parents[0];
    }
    return { ...node, breadcrumb };
  },

  /** 反查在某行政区划（任意级别）拍摄过的所有物种 */
  getPlantsByAdminCode(code) {
    if (!code) return [];
    // 自动判断 code 长度对应的列：2位=省，4位=市，6位=县
    let column = 'county_code';
    if (code.length === 2) column = 'province_code';
    else if (code.length === 4) column = 'city_code';

    const results = this.db.exec(`
      SELECT DISTINCT p.*, ph.file_path as primary_photo
      FROM plants p
      INNER JOIN photos ph2 ON ph2.plant_id = p.id AND ph2.${column} = ?
      LEFT JOIN photos ph ON ph.plant_id = p.id AND ph.is_primary = 1
      WHERE p.status IS NULL OR p.status = 'approved'
      ORDER BY p.family, p.genus, p.chinese_name
    `, [code]);
    return this._toObjects(results);
  },

  // ==================== V3: 审定队列 ====================

  /** 添加待审定记录 */
  addPendingChange(kind, payload, options = {}) {
    this.db.run(
      `INSERT INTO pending_changes (kind, target_table, target_id, payload_json, reason, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [kind,
       options.target_table || null,
       options.target_id || null,
       JSON.stringify(payload || {}),
       options.reason || null]
    );
    const res = this.db.exec('SELECT last_insert_rowid()');
    return res[0].values[0][0];
  },

  /** 获取待审定列表（按状态过滤） */
  getPendingChanges(filter = {}) {
    const status = filter.status || 'pending';
    const results = this.db.exec(
      `SELECT * FROM pending_changes WHERE status = ? ORDER BY created_at DESC`,
      [status]
    );
    return this._toObjects(results).map(r => {
      let payload = {};
      try { payload = JSON.parse(r.payload_json || '{}'); } catch (e) {}
      return { ...r, payload };
    });
  },

  /** 统计待审定数量 */
  countPendingChanges() {
    const res = this.db.exec(`SELECT COUNT(*) FROM pending_changes WHERE status = 'pending'`);
    return res[0]?.values?.[0]?.[0] || 0;
  },

  /** 获取所有待审定的植物（直接查 plants.status='pending'，用于审定页面渲染） */
  getPendingPlants() {
    const results = this.db.exec(`
      SELECT p.*, ph.file_path as primary_photo
      FROM plants p
      LEFT JOIN photos ph ON ph.plant_id = p.id AND ph.is_primary = 1
      WHERE p.status = 'pending'
      ORDER BY p.created_at DESC
    `);
    return this._toObjects(results);
  },

  /** 审定通过：将关联的 pending plant 转为 approved */
  approvePending(id) {
    const res = this.db.exec(`SELECT * FROM pending_changes WHERE id = ?`, [id]);
    const row = this._toObjects(res)[0];
    if (!row) return;

    if (row.kind === 'new_species' && row.target_id) {
      this.db.run(
        `UPDATE plants SET status = 'approved', updated_at = datetime('now') WHERE id = ?`,
        [row.target_id]
      );
      this.ensureTaxonomyDescriptionsForPlant(row.target_id);
    } else if (row.kind === 'taxonomy_revise') {
      // 应用 payload 中的 override 到 taxonomy_overrides
      let payload = {};
      try { payload = JSON.parse(row.payload_json || '{}'); } catch (e) {}
      if (payload.plant_id && payload.system) {
        this.addTaxonomyOverride(payload.plant_id, payload.system, payload.fields || {}, row.reason);
      }
    } else if (row.kind === 'add_taxon' && row.target_id) {
      this.db.run(
        `UPDATE plants SET status = 'approved', updated_at = datetime('now') WHERE id = ?`,
        [row.target_id]
      );
      this.ensureTaxonomyDescriptionsForPlant(row.target_id);
    }

    this.db.run(
      `UPDATE pending_changes SET status = 'approved', resolved_at = datetime('now') WHERE id = ?`,
      [id]
    );
  },

  /** 审定不通过：将照片归入指定的现有物种，删除 pending plant */
  rejectPending(id, targetPlantId, reason) {
    const res = this.db.exec(`SELECT * FROM pending_changes WHERE id = ?`, [id]);
    const row = this._toObjects(res)[0];
    if (!row) return;

    if (row.kind === 'new_species' && row.target_id && targetPlantId) {
      // 将 pending plant 的照片重指到 target plant
      this.db.run(
        `UPDATE photos SET plant_id = ? WHERE plant_id = ?`,
        [targetPlantId, row.target_id]
      );
      // 删除 pending plant（注意：photos 已重指，不会被 CASCADE 删除）
      this.db.run(`DELETE FROM plants WHERE id = ? AND status = 'pending'`, [row.target_id]);
    }

    this.db.run(
      `UPDATE pending_changes SET status = 'merged', resolution_target_id = ?, reason = ?, resolved_at = datetime('now') WHERE id = ?`,
      [targetPlantId || null, reason || null, id]
    );
  },

  // ==================== V3: 分类系统覆盖 ====================

  /** 根据植物大类返回应使用的分类系统 */
  getActiveTaxonomySystemFor(plant) {
    if (!plant) return 'FOC';
    const phylum = plant.phylum || '';
    const cls = plant.class || '';
    if (phylum.includes('被子') || phylum.includes('Angiosperm')) return 'APG-IV';
    if (phylum.includes('裸子') || phylum.includes('Gymnosperm')) return 'Yang-2017';
    if (phylum.includes('蕨') || cls.includes('蕨') || phylum.includes('Pteridophyt')) return 'PPG-I';
    return 'FOC';
  },

  /** 添加分类修订（覆盖层） */
  addTaxonomyOverride(plantId, system, fields, reason) {
    const cols = ['phylum', 'class', '"order"', 'family', 'genus'];
    const colNames = ['phylum', 'class', 'order', 'family', 'genus'];
    const placeholders = cols.map(() => '?').join(', ');
    const values = colNames.map(c => fields[c] || null);
    this.db.run(
      `INSERT OR REPLACE INTO taxonomy_overrides (plant_id, system, ${cols.join(', ')}, reason)
       VALUES (?, ?, ${placeholders}, ?)`,
      [plantId, system, ...values, reason || null]
    );
  },

  /** 获取某植物在指定系统下的修订记录 */
  getOverridesForPlant(plantId, system) {
    const sql = system
      ? `SELECT * FROM taxonomy_overrides WHERE plant_id = ? AND system = ?`
      : `SELECT * FROM taxonomy_overrides WHERE plant_id = ?`;
    const params = system ? [plantId, system] : [plantId];
    const results = this.db.exec(sql, params);
    return this._toObjects(results);
  },

  /** 还原修订（删除指定 override 记录） */
  revertOverride(id) {
    this.db.run(`DELETE FROM taxonomy_overrides WHERE id = ?`, [id]);
  },

  // ==================== 工具函数 ====================

  /** sql.js 结果转为对象数组 */
  _toObjects(results) {
    if (!results || results.length === 0) return [];
    const { columns, values } = results[0];
    return values.map(row => {
      const obj = {};
      columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });
  },

  _extractLatinTaxonName(name) {
    if (!name) return '';
    const s = String(name).trim();
    const match = s.match(/[A-Z][a-z]+(?:aceae|ales|opsida|phyta|eae|inae)?/);
    return match ? match[0] : s;
  },

  /** 从扁平分类数据构建树形结构 */
  _buildTree(rows) {
    const tree = { label: '植物界 Plantae', level: 'kingdom', children: [], count: 0 };
    const levels = ['phylum', 'class', 'order', 'family', 'genus'];
    const levelLabels = {
      kingdom: '界', phylum: '门', class: '纲', order: '目', family: '科', genus: '属'
    };

    for (const row of rows) {
      let node = tree;
      tree.count += row.species_count;

      for (const level of levels) {
        const value = row[level];
        if (!value) continue;

        let child = node.children.find(c => c.value === value);
        if (!child) {
          child = {
            label: value,
            value: value,
            level: level,
            levelLabel: levelLabels[level],
            children: [],
            count: 0
          };
          node.children.push(child);
        }
        child.count += row.species_count;
        node = child;
      }
    }

    return tree;
  }
};
