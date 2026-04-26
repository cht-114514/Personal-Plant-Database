#!/usr/bin/env python3
"""Re-extract description_distribution for Orchidaceae species using the
improved regex from import_foc.py. Cleans already-imported polluted data
(fields that include habitat + altitude prefixes) without re-running the
full FOC PDF import.

Usage:
  python3 tools/retrim_descriptions.py --dry-run
  python3 tools/retrim_descriptions.py --execute
"""

import argparse
import os
import re
import sqlite3
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.normpath(os.path.join(SCRIPT_DIR, '..', 'data', 'botanical.db'))
sys.path.insert(0, SCRIPT_DIR)
from import_foc import _extract_distribution, _dehyphenate  # noqa: E402


TARGET_FAMILY = '兰科 Orchidaceae'


def clean_distribution(field):
    """Apply _extract_distribution to an already-polluted field string.
    Returns (cleaned_text, was_changed).
    If extraction yields nothing meaningful, returns empty string — better to
    show no distribution than to falsely display habitat + altitude.
    """
    if not field or not field.strip():
        return field, False
    cleaned = _extract_distribution(field)
    if cleaned is None:
        # Nothing geographic found — field was probably all habitat/altitude.
        # Return empty so frontend can show "暂无分布信息" rather than pollution.
        return '', (field.strip() != '')
    cleaned = cleaned.strip()
    return cleaned, cleaned != field.strip().rstrip('.')


def clean_habitat(field):
    """Minor cleanup for habitat field: collapse whitespace, fix hyphenation."""
    if not field:
        return field, False
    cleaned = re.sub(r'\s+', ' ', field).strip()
    cleaned = _dehyphenate(cleaned).rstrip('.').strip()
    return cleaned, cleaned != field.strip().rstrip('.')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    grp = ap.add_mutually_exclusive_group(required=True)
    grp.add_argument('--dry-run', action='store_true')
    grp.add_argument('--execute', action='store_true')
    args = ap.parse_args()

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, chinese_name, latin_name, description_habitat, "
        "description_distribution FROM plants "
        "WHERE family = ? ORDER BY id",
        (TARGET_FAMILY,),
    ).fetchall()

    changed_dist = 0
    changed_hab = 0
    emptied = 0
    preview_samples = []

    for row in rows:
        old_dist = row['description_distribution']
        new_dist, dist_changed = clean_distribution(old_dist)
        old_hab = row['description_habitat']
        new_hab, hab_changed = clean_habitat(old_hab)

        if dist_changed:
            changed_dist += 1
            if new_dist == '' and old_dist:
                emptied += 1
        if hab_changed:
            changed_hab += 1

        if dist_changed and len(preview_samples) < 12:
            preview_samples.append({
                'id': row['id'],
                'name': row['chinese_name'] or row['latin_name'],
                'old': (old_dist or '')[:100],
                'new': (new_dist or '(已清空)')[:100],
            })

        if args.execute and (dist_changed or hab_changed):
            conn.execute(
                "UPDATE plants SET description_distribution = ?, "
                "description_habitat = ?, updated_at = datetime('now') "
                "WHERE id = ?",
                (new_dist, new_hab, row['id']),
            )

    if args.execute:
        conn.commit()

    conn.close()

    print(f"扫描 {len(rows)} 个兰科记录:")
    print(f"  description_distribution 变化: {changed_dist}")
    print(f"    其中被清空(原字段全是生境/海拔): {emptied}")
    print(f"  description_habitat 变化: {changed_hab}")
    print()
    print(f"样本(前 {len(preview_samples)} 个变更):")
    for s in preview_samples:
        print(f"  [{s['id']}] {s['name']}")
        print(f"    旧: {s['old']}")
        print(f"    新: {s['new']}")
        print()
    if args.execute:
        print("✓ 已写入数据库")
    else:
        print("(dry-run,未写库。执行 --execute 生效)")


if __name__ == '__main__':
    main()
