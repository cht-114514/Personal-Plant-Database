#!/usr/bin/env python3
"""
植物资料库 - PPBC 批量导入脚本

使用方法:
  python tools/import.py                    # 导入 data/images/ 下所有图片
  python tools/import.py /path/to/photos    # 导入指定目录的图片
  python tools/import.py --copy             # 导入并复制图片到 data/images/

文件名格式 (PPBC):
  Nepeta+cataria+L. 荆芥 PPBC 22816696 崔瞳岳 新疆维吾尔自治区阿禾公路-布尔津.jpg
"""

import os
import re
import sys
import json
import shutil
import sqlite3
from pathlib import Path

# 项目根目录
ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / 'data' / 'botanical.db'
IMAGES_DIR = ROOT / 'data' / 'images'
TAXONOMY_PATH = ROOT / 'data' / 'taxonomy-lookup.json'

# 支持的图片格式
IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'}

# PPBC 文件名解析正则
PPBC_PATTERN = re.compile(
    r'^(.+?)\s+'                           # 拉丁名 (懒惰匹配)
    r'([\u4e00-\u9fff\u3400-\u4dbf]+)\s+'  # 中文名
    r'PPBC\s+(\d+)\s+'                     # PPBC ID
    r'([\u4e00-\u9fff\u3400-\u4dbf]{2,4})\s+'  # 拍摄者 (2-4个汉字)
    r'(.+)$'                               # 拍摄地点
)


def parse_filename(filename):
    """解析 PPBC 格式的文件名"""
    name = Path(filename).stem

    match = PPBC_PATTERN.match(name)
    if match:
        latin_raw = match.group(1).replace('+', ' ').strip()
        genus, species_epithet, authority = parse_latin_name(latin_raw)
        return {
            'latin_name': latin_raw,
            'chinese_name': match.group(2).strip(),
            'ppbc_id': match.group(3),
            'photographer': match.group(4).strip(),
            'location': match.group(5).strip(),
            'genus': genus,
            'species_epithet': species_epithet,
            'authority': authority,
        }

    # 退化匹配：拉丁名 + 中文名
    simple = re.match(r'^(.+?)\s+([\u4e00-\u9fff\u3400-\u4dbf]+.*)$', name)
    if simple:
        latin_raw = simple.group(1).replace('+', ' ').strip()
        genus, species_epithet, authority = parse_latin_name(latin_raw)
        return {
            'latin_name': latin_raw,
            'chinese_name': simple.group(2).strip(),
            'ppbc_id': None,
            'photographer': None,
            'location': None,
            'genus': genus,
            'species_epithet': species_epithet,
            'authority': authority,
        }

    return None


def parse_latin_name(latin):
    """解析拉丁学名为属、种加词、命名人"""
    parts = latin.split()
    if len(parts) >= 2:
        genus = parts[0]
        if parts[1] in ('var.', 'subsp.', 'f.', 'ssp.'):
            species_epithet = ' '.join(parts[1:3]) if len(parts) > 2 else parts[1]
            authority = ' '.join(parts[3:]) or None
        else:
            species_epithet = parts[1]
            authority = ' '.join(parts[2:]) or None
        return genus, species_epithet, authority
    elif len(parts) == 1:
        return parts[0], None, None
    return None, None, None


def load_taxonomy():
    """加载分类学查找表"""
    if TAXONOMY_PATH.exists():
        with open(TAXONOMY_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


def init_db(conn):
    """初始化数据库表结构"""
    conn.executescript('''
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
            notes TEXT DEFAULT '',
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
            is_primary INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_photos_plant_id ON photos(plant_id);
        CREATE INDEX IF NOT EXISTS idx_plants_genus ON plants(genus);
        CREATE INDEX IF NOT EXISTS idx_plants_family ON plants(family);
        CREATE INDEX IF NOT EXISTS idx_plants_latin ON plants(latin_name);
    ''')


def import_images(source_dir, copy_files=False):
    """批量导入图片"""
    source_dir = Path(source_dir)
    if not source_dir.exists():
        print(f"错误: 目录不存在 - {source_dir}")
        sys.exit(1)

    # 确保目标目录存在
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    # 加载分类学数据
    taxonomy = load_taxonomy()

    # 连接数据库
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute('PRAGMA foreign_keys = ON')
    init_db(conn)

    # 扫描图片文件
    image_files = sorted([
        f for f in source_dir.iterdir()
        if f.is_file() and f.suffix.lower() in IMAGE_EXTS
    ])

    if not image_files:
        print(f"在 {source_dir} 中没有找到图片文件")
        return

    print(f"找到 {len(image_files)} 个图片文件")
    print()

    stats = {'new_plants': 0, 'new_photos': 0, 'skipped': 0, 'errors': 0}

    for img_file in image_files:
        try:
            parsed = parse_filename(img_file.name)
            if not parsed:
                print(f"  ✗ 无法解析: {img_file.name}")
                stats['errors'] += 1
                continue

            # 查找或创建植物记录
            row = conn.execute(
                'SELECT id FROM plants WHERE latin_name = ?',
                (parsed['latin_name'],)
            ).fetchone()

            if row:
                plant_id = row[0]
            else:
                # 查找分类信息
                taxon = taxonomy.get(parsed['genus'], {})
                conn.execute('''
                    INSERT INTO plants (latin_name, chinese_name, genus, species_epithet, authority,
                                       kingdom, phylum, class, "order", family)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    parsed['latin_name'], parsed['chinese_name'],
                    parsed['genus'], parsed['species_epithet'], parsed['authority'],
                    taxon.get('kingdom', '植物界 Plantae'),
                    taxon.get('phylum'), taxon.get('class'),
                    taxon.get('order'), taxon.get('family'),
                ))
                plant_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
                stats['new_plants'] += 1
                print(f"  ✓ 新增植物: {parsed['chinese_name'] or ''} {parsed['latin_name']}")

            # 检查照片是否已导入
            existing = conn.execute(
                'SELECT id FROM photos WHERE filename = ? AND plant_id = ?',
                (img_file.name, plant_id)
            ).fetchone()

            if existing:
                stats['skipped'] += 1
                continue

            # 确定文件路径
            if copy_files and source_dir != IMAGES_DIR:
                dest = IMAGES_DIR / img_file.name
                if not dest.exists():
                    shutil.copy2(str(img_file), str(dest))
                file_path = img_file.name
            else:
                # 使用相对于 data/images/ 的路径
                try:
                    file_path = str(img_file.relative_to(IMAGES_DIR))
                except ValueError:
                    file_path = img_file.name

            # 判断是否为主图
            photo_count = conn.execute(
                'SELECT COUNT(*) FROM photos WHERE plant_id = ?', (plant_id,)
            ).fetchone()[0]

            conn.execute('''
                INSERT INTO photos (plant_id, filename, file_path, ppbc_id, photographer, location, is_primary)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (
                plant_id, img_file.name, file_path,
                parsed['ppbc_id'], parsed['photographer'], parsed['location'],
                1 if photo_count == 0 else 0,
            ))
            stats['new_photos'] += 1

        except Exception as e:
            print(f"  ✗ 错误 [{img_file.name}]: {e}")
            stats['errors'] += 1

    conn.commit()
    conn.close()

    print()
    print("=" * 40)
    print(f"导入完成!")
    print(f"  新增植物: {stats['new_plants']}")
    print(f"  新增照片: {stats['new_photos']}")
    print(f"  已跳过:   {stats['skipped']}")
    print(f"  错误:     {stats['errors']}")
    print(f"\n数据库已保存到: {DB_PATH}")


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='植物资料库 - PPBC 批量导入')
    parser.add_argument('source', nargs='?', default=str(IMAGES_DIR),
                        help='图片所在目录 (默认: data/images/)')
    parser.add_argument('--copy', action='store_true',
                        help='将图片复制到 data/images/ 目录')
    args = parser.parse_args()

    import_images(args.source, copy_files=args.copy)
