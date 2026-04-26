# 植物百科

本项目是可在本地运行的植物资料库。Windows 客户从本页面下载 ZIP 后，解压覆盖现有目录即可更新程序，原有数据库和图片会保留在本机 `data` 目录中。

## 客户下载方式

在本页面右上角点击绿色 `Code`，选择 `Download ZIP`。

下载后会得到类似 `Personal-Plant-Database-main.zip` 的文件。解压后进入里面那层 `Personal-Plant-Database-main` 文件夹，把其中所有内容复制到原来的程序目录并选择覆盖。不要删除原程序目录里的 `data` 文件夹。

这个 ZIP 已排除维护脚本、GitHub 工作流和本地客户数据，只保留客户运行和更新所需的文件。

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

脚本会先运行检查和打包，只提交程序文件与参考数据，然后推送当前分支和版本 tag。GitHub Actions 会根据 tag 自动创建 Release。客户也可以直接使用首页右上角 `Code -> Download ZIP` 下载当前最新版。
