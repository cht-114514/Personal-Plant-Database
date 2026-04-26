#!/usr/bin/env python3
"""Trim botanical.db to 100 curated Orchidaceae species (balanced across top genera).

Usage:
  python3 tools/trim_to_orchidaceae.py --dry-run     # preview only
  python3 tools/trim_to_orchidaceae.py --execute     # backup + delete + vacuum
  python3 tools/trim_to_orchidaceae.py --restore     # restore latest pre-trim backup
"""

import argparse
import os
import shutil
import sqlite3
import sys
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.normpath(os.path.join(SCRIPT_DIR, '..', 'data', 'botanical.db'))
BACKUP_DIR = os.path.dirname(DB_PATH)
BACKUP_PREFIX = 'botanical.db.pre-trim-'

TARGET_FAMILY = '兰科 Orchidaceae'
TOP_N_GENERA = 25
PER_GENUS = 4  # 25 * 4 = 100


def select_species_ids(conn):
    """Pick top 25 genera by species count, 4 species per genus.

    Within each genus, prefer species with non-empty description, then alphabetical.
    Returns list of (id, genus, latin_name, chinese_name) rows, length = 100.
    """
    top_genera = [r[0] for r in conn.execute("""
        SELECT genus FROM plants
         WHERE family = ? AND parent_id IS NULL
         GROUP BY genus
         ORDER BY COUNT(*) DESC
         LIMIT ?
    """, (TARGET_FAMILY, TOP_N_GENERA)).fetchall()]

    selected = []
    for g in top_genera:
        rows = conn.execute("""
            SELECT id, genus, latin_name, chinese_name FROM plants
             WHERE family = ? AND parent_id IS NULL AND genus = ?
             ORDER BY
               CASE WHEN description IS NOT NULL AND description != '' THEN 0 ELSE 1 END,
               latin_name
             LIMIT ?
        """, (TARGET_FAMILY, g, PER_GENUS)).fetchall()
        selected.extend(rows)
    return selected[:100]


def find_latest_backup():
    candidates = sorted(
        [f for f in os.listdir(BACKUP_DIR)
         if f.startswith(BACKUP_PREFIX) and f.endswith('.bak')],
        reverse=True,
    )
    return os.path.join(BACKUP_DIR, candidates[0]) if candidates else None


def make_backup():
    ts = datetime.now().strftime('%Y%m%d-%H%M%S')
    path = os.path.join(BACKUP_DIR, f'{BACKUP_PREFIX}{ts}.bak')
    shutil.copy2(DB_PATH, path)
    return path


def cmd_dry_run():
    conn = sqlite3.connect(DB_PATH)
    total = conn.execute("SELECT COUNT(*) FROM plants").fetchone()[0]
    orch_species = conn.execute(
        "SELECT COUNT(*) FROM plants WHERE family = ? AND parent_id IS NULL",
        (TARGET_FAMILY,)).fetchone()[0]
    orch_infra = conn.execute(
        "SELECT COUNT(*) FROM plants WHERE family = ? AND parent_id IS NOT NULL",
        (TARGET_FAMILY,)).fetchone()[0]
    photos_total = conn.execute("SELECT COUNT(*) FROM photos").fetchone()[0]

    selected = select_species_ids(conn)
    ids = [r[0] for r in selected]
    placeholders = ','.join('?' * len(ids))

    infra_kept = conn.execute(
        f"SELECT COUNT(*) FROM plants "
        f"WHERE parent_id IS NOT NULL AND parent_id IN ({placeholders})",
        ids).fetchone()[0]

    print(f"当前状态:")
    print(f"  plants 总数:       {total}")
    print(f"  兰科物种(种级):    {orch_species}")
    print(f"  兰科种下分类群:    {orch_infra}")
    print(f"  photos 总数:       {photos_total}")
    print()
    print(f"瘦身计划:")
    print(f"  保留 {len(ids)} 个兰科种级物种 + {infra_kept} 个种下分类群")
    print(f"  删除 {total - len(ids) - infra_kept} 行 plants")
    print()

    from collections import defaultdict
    by_genus = defaultdict(list)
    for row in selected:
        by_genus[row[1]].append(f"{row[2]} ({row[3] or '-'})")
    print(f"选出的 {len(ids)} 个物种按属分布({len(by_genus)} 个属):")
    for g in sorted(by_genus, key=lambda x: (-len(by_genus[x]), x)):
        print(f"  {g} ({len(by_genus[g])}):")
        for s in by_genus[g]:
            print(f"    - {s}")
    conn.close()


def cmd_execute():
    backup = make_backup()
    print(f"✓ 备份已写入: {backup}")

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")

    plants_before = conn.execute("SELECT COUNT(*) FROM plants").fetchone()[0]
    photos_before = conn.execute("SELECT COUNT(*) FROM photos").fetchone()[0]

    selected = select_species_ids(conn)
    ids = [r[0] for r in selected]
    if len(ids) != 100:
        print(f"✗ 采样得到 {len(ids)} 个物种,预期 100。停止。", file=sys.stderr)
        conn.close()
        sys.exit(1)

    placeholders = ','.join('?' * len(ids))
    # 1) Delete species-level rows not in selected (CASCADE handles photos)
    cur = conn.execute(
        f"DELETE FROM plants WHERE parent_id IS NULL AND id NOT IN ({placeholders})",
        ids,
    )
    deleted_species = cur.rowcount
    # 2) Delete infraspecific taxa whose parent is gone
    cur = conn.execute(
        "DELETE FROM plants WHERE parent_id IS NOT NULL "
        "AND parent_id NOT IN (SELECT id FROM plants)"
    )
    deleted_infra = cur.rowcount
    # 3) Belt-and-suspenders: orphan photos (should already be gone via CASCADE)
    cur = conn.execute(
        "DELETE FROM photos WHERE plant_id NOT IN (SELECT id FROM plants)"
    )
    orphan_photos = cur.rowcount
    conn.commit()

    plants_after = conn.execute("SELECT COUNT(*) FROM plants").fetchone()[0]
    photos_after = conn.execute("SELECT COUNT(*) FROM photos").fetchone()[0]
    conn.close()

    # VACUUM must run outside a transaction
    conn2 = sqlite3.connect(DB_PATH)
    conn2.isolation_level = None
    conn2.execute("VACUUM")
    conn2.close()

    size_mb = os.path.getsize(DB_PATH) / (1024 * 1024)
    print(f"✓ 删除 {deleted_species} 个种级物种 + {deleted_infra} 个种下分类群")
    print(f"✓ photos 表级联清理: {photos_before} → {photos_after} "
          f"(额外孤立清理 {orphan_photos})")
    print(f"✓ plants: {plants_before} → {plants_after}")
    print(f"✓ VACUUM 完成,数据库大小: {size_mb:.1f} MB")


def cmd_restore():
    backup = find_latest_backup()
    if not backup:
        print(f"✗ 找不到 {BACKUP_PREFIX}*.bak 备份", file=sys.stderr)
        sys.exit(1)
    print(f"即将从备份恢复:")
    print(f"  来源: {backup}")
    print(f"  目标: {DB_PATH}")
    confirm = input("确认? 输入 yes 继续: ").strip()
    if confirm.lower() != 'yes':
        print("已取消")
        return
    shutil.copy2(backup, DB_PATH)
    print("✓ 恢复完成")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    grp = ap.add_mutually_exclusive_group(required=True)
    grp.add_argument('--dry-run', action='store_true')
    grp.add_argument('--execute', action='store_true')
    grp.add_argument('--restore', action='store_true')
    args = ap.parse_args()

    if args.dry_run:
        cmd_dry_run()
    elif args.execute:
        cmd_execute()
    elif args.restore:
        cmd_restore()


if __name__ == '__main__':
    main()
