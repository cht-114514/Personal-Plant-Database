#!/usr/bin/env python3
"""
回归：与 js/db.js findPlantForPPBC + 部分前置逻辑行为一致（同序 SQL + 同序 JS 分支）。
运行：python3 tools/verify_ppbc_resolve.py
"""
import re
import sqlite3
from typing import Optional


def norm_cn(s: Optional[str]) -> str:
    if not s:
        return ""
    t = s.replace("\u200b", "").replace("\u200c", "").replace("\u200d", "").replace("\ufeff", "")
    t = re.sub(r"[\s\u3000]+", "", t)
    return t.lower()


def norm_lat(s: Optional[str]) -> str:
    if not s:
        return ""
    return " ".join(str(s).split()).strip().lower()


def find_plant_by_latin_name(cur, latin_name: str):
    cur.execute("SELECT * FROM plants WHERE latin_name = ?", (latin_name,))
    row = cur.fetchone()
    return dict(zip([c[0] for c in cur.description], row)) if row else None


def find_plant_for_ppbc(cur, parsed: dict) -> Optional[dict]:
    if not parsed:
        return None

    parsed_cn = norm_cn(parsed.get("chinese_name"))
    pl = norm_lat(parsed.get("latin_name"))

    if pl and not pl.startswith("[ppbc"):
        r = find_plant_by_latin_name(cur, parsed["latin_name"])
        if r and parsed_cn and norm_cn(r.get("chinese_name")) != parsed_cn:
            r = None
        elif r:
            return r

        cur.execute("SELECT * FROM plants WHERE lower(trim(latin_name)) = ?", (pl,))
        cols = [c[0] for c in cur.description]
        ci = [dict(zip(cols, row)) for row in cur.fetchall()]
        if len(ci) >= 1:
            if parsed_cn:
                by_cn = [row for row in ci if norm_cn(row.get("chinese_name")) == parsed_cn]
                if len(by_cn) == 1:
                    return by_cn[0]
            if len(ci) == 1:
                one = ci[0]
                if not parsed_cn or norm_cn(one.get("chinese_name")) == parsed_cn:
                    return one

    if not parsed.get("genus") or not parsed.get("species_epithet"):
        return None

    full_ep = str(parsed["species_epithet"]).strip()
    genus_lower = str(parsed["genus"]).lower()

    cur.execute(
        "SELECT * FROM plants WHERE lower(genus) = ? AND trim(species_epithet) = ?",
        (genus_lower, full_ep),
    )
    cols = [c[0] for c in cur.description]
    rows_full = [dict(zip(cols, row)) for row in cur.fetchall()]
    if len(rows_full) == 1:
        one = rows_full[0]
        if not parsed_cn or norm_cn(one.get("chinese_name")) == parsed_cn:
            return one
    if len(rows_full) > 1 and parsed_cn:
        for row in rows_full:
            if norm_cn(row.get("chinese_name")) == parsed_cn:
                return row

    first_tok = full_ep.split()[0]
    cur.execute(
        "SELECT * FROM plants WHERE lower(genus) = ? AND trim(species_epithet) = ?",
        (genus_lower, first_tok),
    )
    rows_sp = [dict(zip(cols, row)) for row in cur.fetchall()]
    if len(rows_sp) == 1:
        only = rows_sp[0]
        only_l = norm_lat(only.get("latin_name"))
        cn_match = not parsed_cn or norm_cn(only.get("chinese_name")) == parsed_cn
        pl_longer = bool(
            pl and only_l and pl.startswith(only_l + " ") and len(pl) > len(only_l)
        )
        if parsed_cn and not cn_match and rows_full:
            for row in rows_full:
                if norm_cn(row.get("chinese_name")) == parsed_cn:
                    return row
        if cn_match and not pl_longer:
            return only

    cur.execute(
        """SELECT * FROM plants WHERE lower(genus) = ?
         AND (species_epithet LIKE ? OR species_epithet LIKE ? OR latin_name LIKE ?)""",
        (genus_lower, f"{first_tok} %", f"% {first_tok} %", f"% {first_tok} %"),
    )
    like_rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    if not like_rows:
        return None

    if parsed_cn:
        exact_cn = [row for row in like_rows if norm_cn(row.get("chinese_name")) == parsed_cn]
        if len(exact_cn) == 1:
            return exact_cn[0]
        if len(exact_cn) > 1:
            best = None
            for c in exact_cn:
                cl = norm_lat(c.get("latin_name"))
                if pl and (cl == pl or pl.startswith(cl + " ") or cl.startswith(pl + " ")):
                    if not best or len(c.get("latin_name") or "") > len(best.get("latin_name") or ""):
                        best = c
            if best:
                return best
            return exact_cn[0]

    if pl:
        best = None
        for c in like_rows:
            cl = norm_lat(c.get("latin_name"))
            if cl == pl or (pl.startswith(cl + " ") and len(pl) > cl):
                if not best or len(c.get("latin_name") or "") > len(best.get("latin_name") or ""):
                    best = c
        if best:
            return best

    if parsed_cn and len(like_rows) > 1:

        def se(row):
            return str(row.get("species_epithet") or "").strip()

        def rank_in(s):
            return bool(re.search(r"\b(var\.|subsp\.|ssp\.|f\.)\b", s or "", re.I))

        parent_like = next(
            (
                row
                for row in like_rows
                if not row.get("parent_id")
                and str(row.get("genus") or "").lower() == genus_lower
                and se(row) == first_tok
                and not rank_in(row.get("latin_name"))
            ),
            None,
        )
        if parent_like and norm_cn(parent_like.get("chinese_name")) != parsed_cn:
            for row in like_rows:
                if row["id"] != parent_like["id"] and norm_cn(row.get("chinese_name")) == parsed_cn:
                    return row

    return like_rows[0]


def main():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE plants (
            id INTEGER PRIMARY KEY,
            latin_name TEXT NOT NULL,
            chinese_name TEXT,
            genus TEXT,
            species_epithet TEXT,
            parent_id INTEGER
        )
        """
    )
    cur.executemany(
        "INSERT INTO plants (id, latin_name, chinese_name, genus, species_epithet, parent_id) VALUES (?,?,?,?,?,?)",
        [
            (1, "Viola dissecta L.", "裂叶堇菜", "Viola", "dissecta", None),
            (2, "Viola dissecta var. incisa", "总裂叶堇菜", "Viola", "dissecta var. incisa", 1),
            (3, "Viola dissecta var. incisa", "总裂叶堇菜", "viola", "dissecta var. incisa", None),
        ],
    )
    conn.commit()

    # 1) 种级拉丁 + 种下中文 → 应用变种 id=2（大写属名）
    p = {
        "latin_name": "Viola dissecta",
        "chinese_name": "总裂叶堇菜",
        "genus": "Viola",
        "species_epithet": "dissecta",
    }
    hit = find_plant_for_ppbc(cur, p)
    assert hit and hit["id"] == 2, f"case1 expected id=2 got {hit}"

    # 2) 同场景，库中属名为小写 viola 的种下行 id=3（验证 lower(genus)）
    cur.execute("DELETE FROM plants WHERE id IN (1,2)")
    conn.commit()
    p2 = {
        "latin_name": "Viola dissecta",
        "chinese_name": "总裂叶堇菜",
        "genus": "Viola",
        "species_epithet": "dissecta",
    }
    hit2 = find_plant_for_ppbc(cur, p2)
    assert hit2 and hit2["id"] == 3, f"case2 expected id=3 got {hit2}"

    # 3) 中文名一致时取完整拉丁匹配的种下
    conn.execute("DELETE FROM plants")
    conn.executemany(
        "INSERT INTO plants (id, latin_name, chinese_name, genus, species_epithet, parent_id) VALUES (?,?,?,?,?,?)",
        [
            (1, "Viola dissecta", "裂叶堇菜", "Viola", "dissecta", None),
            (2, "Viola dissecta var. incisa Auth.", "总裂叶堇菜", "Viola", "dissecta var. incisa", 1),
        ],
    )
    conn.commit()
    p3 = {
        "latin_name": "Viola dissecta var. incisa",
        "chinese_name": "总裂叶堇菜",
        "genus": "Viola",
        "species_epithet": "dissecta var. incisa",
    }
    hit3 = find_plant_for_ppbc(cur, p3)
    assert hit3 and hit3["id"] == 2, f"case3 expected id=2 got {hit3}"

    print("verify_ppbc_resolve: OK (3 cases)")


if __name__ == "__main__":
    main()
