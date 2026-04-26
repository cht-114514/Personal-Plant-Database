#!/usr/bin/env python3
"""
一键发布到 GitHub。

流程：
1. 运行语法检查与发行包打包
2. 初始化/检查 Git 仓库
3. 只添加交付所需的程序文件，避免 data/botanical.db 和 data/images 被上传
4. 提交、打版本 tag、推送到 GitHub
5. GitHub Actions 收到 tag 后自动创建 Release 和客户 zip
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent

TRACKED_PATHS = [
    ".github",
    ".gitignore",
    "INSTALL.md",
    "README.md",
    "VERSION",
    "check-data.bat",
    "index.html",
    "publish-github.bat",
    "publish-github.command",
    "start.bat",
    "start.command",
    "start.sh",
    "css",
    "js",
    "lib",
    "tools",
    "data/admin_divisions.json",
    "data/taxonomy-lookup.json",
]

FORBIDDEN_TRACKED_PREFIXES = [
    "data/botanical.db",
    "data/images/",
    "dist/",
]


def configure_output():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def run(cmd, check=True):
    print("+ " + " ".join(cmd))
    result = subprocess.run(cmd, cwd=PROJECT_ROOT)
    if check and result.returncode != 0:
        raise SystemExit(result.returncode)
    return result


def output(cmd, check=True):
    result = subprocess.run(
        cmd,
        cwd=PROJECT_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if check and result.returncode != 0:
        if result.stderr.strip():
            print(result.stderr.strip(), file=sys.stderr)
        raise SystemExit(result.returncode)
    return result.stdout.strip()


def read_version():
    version = (PROJECT_ROOT / "VERSION").read_text(encoding="utf-8").strip()
    if not version.startswith("v"):
        raise SystemExit("VERSION 必须以 v 开头，例如 v3.2.2")
    return version


def ensure_git_repo(repo_url, branch):
    if (PROJECT_ROOT / ".git").exists():
        return
    if not repo_url:
        raise SystemExit("当前目录还不是 Git 仓库。首次发布请提供 --repo-url。")

    run(["git", "init"])
    run(["git", "branch", "-M", branch])
    run(["git", "remote", "add", "origin", repo_url])


def ensure_remote(repo_url):
    remotes = output(["git", "remote"]).splitlines()
    if "origin" not in remotes:
        if not repo_url:
            raise SystemExit("没有配置 origin。请提供 --repo-url。")
        run(["git", "remote", "add", "origin", repo_url])
    elif repo_url:
        current = output(["git", "remote", "get-url", "origin"], check=False)
        if current != repo_url:
            run(["git", "remote", "set-url", "origin", repo_url])
    else:
        current = output(["git", "remote", "get-url", "origin"], check=False)
        if "github.com/example/" in current:
            raise SystemExit("origin 还是示例地址。首次正式发布请提供 --repo-url。")


def verify_no_forbidden_files_tracked():
    tracked = output(["git", "ls-files"], check=False).splitlines()
    leaked = []
    for name in tracked:
        if name.endswith(".bak"):
            leaked.append(name)
            continue
        for prefix in FORBIDDEN_TRACKED_PREFIXES:
            if name == prefix.rstrip("/") or name.startswith(prefix):
                leaked.append(name)
                break
    if leaked:
        print("以下用户数据/构建产物已经被 Git 跟踪，请先手动处理：", file=sys.stderr)
        for name in leaked:
            print(f"  - {name}", file=sys.stderr)
        raise SystemExit(2)


def run_checks():
    run([sys.executable, "-m", "py_compile", "tools/build_release.py", "tools/check_data_compat.py", "tools/publish_release.py", "tools/server.py"])
    run(["node", "--check", "js/db.js"])
    run([sys.executable, "tools/build_release.py"])


def stage_release_files():
    existing = [path for path in TRACKED_PATHS if (PROJECT_ROOT / path).exists()]
    run(["git", "add", "--", *existing])
    verify_no_forbidden_files_tracked()


def commit_if_needed(version, message):
    diff = output(["git", "status", "--short"])
    if not diff:
        print("没有新的文件变更，跳过 commit。")
        return False

    final_message = message or f"Release {version}"
    run(["git", "commit", "-m", final_message])
    return True


def tag_release(version, force_tag):
    exists = run(["git", "rev-parse", "-q", "--verify", f"refs/tags/{version}"], check=False).returncode == 0
    if exists and not force_tag:
        tag_commit = output(["git", "rev-list", "-n", "1", version])
        head_commit = output(["git", "rev-parse", "HEAD"])
        if tag_commit == head_commit:
            print(f"tag {version} 已存在且指向当前提交，直接复用。")
            return
        raise SystemExit(f"tag {version} 已存在但不指向当前提交。如需重打 tag，请使用 --force-tag。")
    if exists and force_tag:
        run(["git", "tag", "-d", version])
    run(["git", "tag", "-a", version, "-m", f"Release {version}"])


def push_release(branch, version, force_tag, dry_run):
    push_cmds = [
        ["git", "push", "-u", "origin", branch],
        ["git", "push", "origin", version],
    ]
    if force_tag:
        push_cmds[1] = ["git", "push", "--force", "origin", version]

    for cmd in push_cmds:
        if dry_run:
            print("[dry-run] " + " ".join(cmd))
        else:
            run(cmd)


def main():
    configure_output()
    parser = argparse.ArgumentParser(description="发布植物百科到 GitHub Release")
    parser.add_argument("--repo-url", help="GitHub 仓库地址，例如 https://github.com/name/botanical.git")
    parser.add_argument("--branch", default="main", help="默认分支，默认 main")
    parser.add_argument("--message", help="本次提交说明，默认 Release <VERSION>")
    parser.add_argument("--skip-checks", action="store_true", help="跳过本地检查和打包")
    parser.add_argument("--force-tag", action="store_true", help="删除并重建同名版本 tag")
    parser.add_argument("--dry-run", action="store_true", help="只显示 push 命令，不真正上传")
    args = parser.parse_args()

    os.chdir(PROJECT_ROOT)
    version = read_version()

    if not args.skip_checks:
        run_checks()

    ensure_git_repo(args.repo_url, args.branch)
    ensure_remote(args.repo_url)
    stage_release_files()
    commit_if_needed(version, args.message)
    tag_release(version, args.force_tag)
    push_release(args.branch, version, args.force_tag, args.dry_run)

    print()
    print(f"发布流程完成：{version}")
    print("GitHub Actions 会根据 tag 自动生成 Release 和客户 zip。")


if __name__ == "__main__":
    raise SystemExit(main())
