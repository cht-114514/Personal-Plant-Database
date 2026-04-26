#!/usr/bin/env python3
"""
植物百科发行包打包脚本

打包内容：
- index.html, css/, js/, lib/, tools/
- start.bat, start.command, start.sh, check-data.bat
- data/admin_divisions.json, data/taxonomy-lookup.json
- VERSION, INSTALL.md, README.md（如存在）

显式排除：
- data/botanical.db*（用户数据）
- data/images/（用户图片）
- *.bak、__pycache__、.git/、.DS_Store
- GitHub 发布辅助脚本（publish_release.py、publish-github.*）

输出：dist/botanical-vX.X.X.zip
"""

import os
import sys
import zipfile
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DIST_DIR = PROJECT_ROOT / 'dist'

# 包含的根级文件
INCLUDE_FILES = [
    'index.html', 'VERSION', 'INSTALL.md', 'README.md',
    'start.bat', 'start.command', 'start.sh', 'check-data.bat',
]

# 包含的整个目录（递归打包）
INCLUDE_DIRS = ['css', 'js', 'lib', 'tools']

# data/ 目录下白名单（其他文件均不打包）
DATA_WHITELIST = ['admin_divisions.json', 'taxonomy-lookup.json']

# 排除规则（凡匹配则跳过）
EXCLUDE_PATTERNS = [
    '__pycache__', '.git', '.DS_Store', '.idea', '.vscode',
    '.pyc', '.bak', '.swp', 'node_modules', 'dist',
    'publish_release.py', 'publish-github.bat', 'publish-github.command'
]


def should_exclude(path: Path) -> bool:
    """判断路径是否应被排除。"""
    parts = path.parts
    name = path.name
    for pat in EXCLUDE_PATTERNS:
        if pat.startswith('.') and name.endswith(pat):
            return True
        if pat in parts or name == pat:
            return True
    return False


def read_version() -> str:
    """读取 VERSION 文件。"""
    version_file = PROJECT_ROOT / 'VERSION'
    if not version_file.exists():
        return 'v0.0.0'
    return version_file.read_text(encoding='utf-8').strip()


def collect_files() -> list:
    """收集所有要打包的文件，返回 [(绝对路径, zip 内相对路径)] 列表。"""
    files = []

    # 根级单文件
    for fname in INCLUDE_FILES:
        fpath = PROJECT_ROOT / fname
        if fpath.exists():
            files.append((fpath, fname))

    # 递归目录
    for dname in INCLUDE_DIRS:
        dpath = PROJECT_ROOT / dname
        if not dpath.exists():
            continue
        for f in dpath.rglob('*'):
            if f.is_file() and not should_exclude(f):
                rel = f.relative_to(PROJECT_ROOT)
                files.append((f, str(rel)))

    # data/ 白名单
    for fname in DATA_WHITELIST:
        fpath = PROJECT_ROOT / 'data' / fname
        if fpath.exists():
            files.append((fpath, f'data/{fname}'))

    return files


def build():
    version = read_version()
    DIST_DIR.mkdir(exist_ok=True)
    zip_name = f'botanical-{version}.zip'
    zip_path = DIST_DIR / zip_name

    files = collect_files()
    if not files:
        print('错误：没有收集到任何文件', file=sys.stderr)
        return 1

    # 写 zip
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for abs_path, rel_path in files:
            zf.write(abs_path, rel_path)

    size_mb = zip_path.stat().st_size / 1024 / 1024
    print(f'打包完成：{zip_path}')
    print(f'  版本：{version}')
    print(f'  文件数：{len(files)}')
    print(f'  压缩后大小：{size_mb:.2f} MB')
    print(f'  打包时间：{datetime.now().isoformat(timespec="seconds")}')
    print('  Windows 客户入口：双击 start.bat 启动，双击 check-data.bat 做数据兼容检查')

    # 验证：确认排除项不在 zip 中
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
        leaked = [n for n in names
                  if n.startswith('data/botanical.db')
                  or n.startswith('data/images')
                  or n.endswith('.bak')]
        if leaked:
            print(f'警告：以下用户数据文件意外进入 zip：{leaked}', file=sys.stderr)
            return 2

    print('  ✓ 已确认 data/botanical.db / data/images / *.bak 未被打包')
    return 0


if __name__ == '__main__':
    sys.exit(build())
