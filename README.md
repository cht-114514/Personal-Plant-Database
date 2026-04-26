# 植物百科

本项目是可在本地运行的植物资料库。Windows 客户下载发行包后，解压覆盖现有目录即可更新程序，原有数据库和图片会保留在本机 `data` 目录中。

## 客户下载方式

请在 GitHub Releases 中下载 `botanical-vX.X.X.zip`，不要下载 Source code 压缩包。发行包已经排除本地数据库和图片，并包含 Windows 启动入口。

## Windows 使用

- 启动：双击 `start.bat`
- 数据检查：双击 `check-data.bat`
- 详细安装与升级步骤：见 `INSTALL.md`

## 数据目录

客户数据不应提交到 GitHub：

- `data/botanical.db`
- `data/images/`
- `data/*.bak`

这些路径已在 `.gitignore` 中排除。升级时请保留现有 `data` 文件夹。

## 维护者发布

首次发布到 GitHub 时运行：

```bash
python3 tools/publish_release.py --repo-url https://github.com/<账号>/<仓库>.git
```

后续更新完成后，修改 `VERSION`，再运行：

```bash
python3 tools/publish_release.py
```

脚本会先运行检查和打包，只提交程序文件与参考数据，然后推送当前分支和版本 tag。GitHub Actions 会根据 tag 自动创建 Release，并上传客户可下载的 `botanical-vX.X.X.zip`。
