#!/usr/bin/env python3
"""
只读数据兼容检查工具。

用于交付或客户本地升级后检查：
- data/botanical.db 是否可读、完整
- 关键表/字段是否存在
- 图片记录是否能在 data/images/ 找到对应文件
- 已知分类修订是否仍有旧值
"""

import argparse
import sqlite3
import sys
from collections import Counter
from pathlib import Path


TARGET_ADAPTER_VERSION = 2


def configure_output():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def line(status, message):
    print(f"[{status}] {message}")


def table_exists(conn, table_name):
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,),
    ).fetchone()
    return bool(row)


def column_names(conn, table_name):
    if not table_exists(conn, table_name):
        return set()
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table_name})")}


def count_rows(conn, table_name):
    if not table_exists(conn, table_name):
        return None
    return conn.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]


def read_meta(conn, key):
    if not table_exists(conn, "app_meta"):
        return None
    row = conn.execute("SELECT value FROM app_meta WHERE key=?", (key,)).fetchone()
    return row[0] if row else None


def check(args):
    root = Path(args.root).resolve() if args.root else Path(__file__).resolve().parents[1]
    db_path = Path(args.db).resolve() if args.db else root / "data" / "botanical.db"
    image_dir = root / "data" / "images"
    warnings = []

    print("植物百科 数据兼容检查")
    print(f"目录: {root}")
    print(f"数据库: {db_path}")
    print()

    if not db_path.exists():
        line("FAIL", "没有找到 data/botanical.db。首次使用请先启动一次应用，或确认 data 目录没有被误删。")
        return 1

    try:
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
    except sqlite3.Error as exc:
        line("FAIL", f"数据库无法打开: {exc}")
        return 1

    try:
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity == "ok":
            line("OK", "SQLite 完整性检查通过")
        else:
            line("FAIL", f"SQLite 完整性检查失败: {integrity}")
            return 1

        required_tables = [
            "plants", "photos", "taxonomy_descriptions", "dictionary",
            "admin_divisions", "pending_changes", "taxonomy_overrides", "app_meta",
        ]
        missing_tables = [name for name in required_tables if not table_exists(conn, name)]
        if missing_tables:
            warnings.append("缺少新版本表: " + ", ".join(missing_tables))
        else:
            line("OK", "关键数据表齐全")

        plant_cols = column_names(conn, "plants")
        required_plant_cols = {
            "latin_name", "chinese_name", "genus", "species_epithet",
            "phylum", "class", "order", "family", "status",
            "data_source", "taxonomy_system",
        }
        missing_cols = sorted(required_plant_cols - plant_cols)
        if missing_cols:
            warnings.append("plants 表缺少字段: " + ", ".join(missing_cols))
        else:
            line("OK", "plants 表字段兼容当前版本")

        plants_count = count_rows(conn, "plants")
        photos_count = count_rows(conn, "photos")
        pending_count = count_rows(conn, "pending_changes")
        line("INFO", f"植物记录: {plants_count if plants_count is not None else '未知'}")
        line("INFO", f"照片记录: {photos_count if photos_count is not None else '未知'}")
        if pending_count is not None:
            line("INFO", f"待审定记录: {pending_count}")

        adapter_version = read_meta(conn, "data_adapter_version")
        if adapter_version is None:
            warnings.append("尚未记录数据适配版本。启动新版应用一次后会自动补齐。")
        else:
            try:
                version_num = int(adapter_version)
            except ValueError:
                version_num = 0
            if version_num < TARGET_ADAPTER_VERSION:
                warnings.append(
                    f"数据适配版本为 {adapter_version}，当前应为 {TARGET_ADAPTER_VERSION}。启动新版应用一次后会自动升级。"
                )
            else:
                line("OK", f"数据适配版本: {adapter_version}")

        if table_exists(conn, "plants"):
            old_taxonomy = conn.execute(
                """
                SELECT id, latin_name FROM plants
                WHERE "order" = ?
                  AND (
                    phylum IS NULL OR phylum = '' OR phylum LIKE '%被子%' OR phylum LIKE '%Angiosperm%'
                    OR class IS NULL OR class = '' OR class LIKE '%木兰%' OR class LIKE '%Magnoliopsida%'
                  )
                ORDER BY latin_name
                LIMIT 10
                """,
                ("松目 Pinales",),
            ).fetchall()
            if old_taxonomy:
                names = ", ".join(row["latin_name"] for row in old_taxonomy)
                warnings.append(f"仍有松目植物使用旧门/纲分类: {names}")
            else:
                line("OK", "已知裸子植物分类未发现旧值")

        if table_exists(conn, "photos"):
            rows = conn.execute("SELECT id, file_path FROM photos ORDER BY id").fetchall()
            paths = [row["file_path"] for row in rows if row["file_path"]]
            invalid_names = [p for p in paths if any(ch in p for ch in '<>:"/\\|?*')]
            if invalid_names:
                warnings.append("存在 Windows 不兼容图片文件名: " + ", ".join(invalid_names[:5]))

            missing = [p for p in paths if not (image_dir / p).exists()]
            if missing:
                warnings.append(f"有 {len(missing)} 条照片记录找不到图片文件，例如: {missing[0]}")
            else:
                line("OK", "照片记录均能找到对应图片文件")

            duplicate_paths = [p for p, count in Counter(paths).items() if count > 1]
            if duplicate_paths:
                warnings.append(f"有 {len(duplicate_paths)} 个重复照片路径，例如: {duplicate_paths[0]}")
            else:
                line("OK", "未发现重复照片路径")

        print()
        if warnings:
            line("WARN", "发现需要关注的事项：")
            for item in warnings:
                print(f"  - {item}")
            if args.strict:
                return 2
            return 0

        line("OK", "数据兼容检查完成，未发现需要处理的问题")
        return 0
    finally:
        conn.close()


def main():
    configure_output()
    parser = argparse.ArgumentParser(description="植物百科只读数据兼容检查")
    parser.add_argument("--root", help="项目根目录，默认自动识别")
    parser.add_argument("--db", help="数据库路径，默认 data/botanical.db")
    parser.add_argument("--strict", action="store_true", help="有警告时返回非零退出码")
    args = parser.parse_args()
    return check(args)


if __name__ == "__main__":
    raise SystemExit(main())
