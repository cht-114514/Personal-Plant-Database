# 植物百科 安装与升级指南

## Windows 首次安装

1. 在 GitHub 页面右上角点击绿色 `Code`。
2. 选择 `Download ZIP`。
3. 解压下载得到的 `Personal-Plant-Database-main.zip`。
4. 进入解压出来的 `Personal-Plant-Database-main` 文件夹。
5. 双击 `start.bat`。
6. 浏览器会自动打开 `http://localhost:8080`。

建议安装 Python。没有 Python 时，`start.bat` 会使用 Windows PowerShell 的只读模式启动，页面可以浏览，但图片上传、数据库保存、备份恢复等写入功能不可用。

## Windows 覆盖升级

升级前先关闭正在运行的窗口，包括浏览器页面和 `start.bat` 打开的黑色命令窗口。

1. 备份现有 `data` 文件夹：在资源管理器里复制 `data`，粘贴成一份例如 `data-backup-20260426`。
2. 在 GitHub 页面右上角点击绿色 `Code`，选择 `Download ZIP`。
3. 解压下载得到的 `Personal-Plant-Database-main.zip`。
4. 进入解压出来的 `Personal-Plant-Database-main` 文件夹。
5. 全选里面的所有内容，复制到原来的程序目录。
6. 如果 Windows 提示文件已存在，选择“替换目标中的文件”。
7. 不要删除现有 `data` 文件夹。
8. 双击 `start.bat` 启动新版。

GitHub 下载的 ZIP 不包含客户数据，所以覆盖更新只会替换程序文件、参考数据和工具文件。客户数据仍保留在：

- `data/botanical.db`
- `data/images/`
- `data/*.bak`

## 自动数据适配

新版首次启动时会自动检查旧数据库，并按版本执行兼容适配：

- 自动补齐缺失的数据表和字段
- 自动修正已知分类参考数据变化，例如松目等裸子植物门/纲
- 自动补齐分类页需要的可编辑骨架记录
- 自动记录 `data_adapter_version`，后续启动不会重复执行已完成的适配

如果需要写回数据库，程序会先尝试创建备份，例如：

- `data/botanical.db.data-adapter.bak`
- `data/botanical.db.bak`

## 数据兼容检查

Windows 客户可以双击 `check-data.bat` 做只读检查。它不会修改数据，会检查：

- 数据库是否完整
- 新版本需要的表和字段是否齐全
- 照片记录是否找得到对应图片文件
- 是否还有已知旧分类值
- 是否存在 Windows 不兼容的图片文件名

也可以在命令行运行：

```bat
py tools\check_data_compat.py
```

如果检查提示“尚未记录数据适配版本”，先双击 `start.bat` 启动并打开页面一次，然后再运行检查。

## 下载包规则

GitHub 页面右上角 `Code -> Download ZIP` 下载的包只保留客户运行和更新所需文件：

- 包含：`index.html`、`css/`、`js/`、`lib/`、`tools/server.py`、`tools/check_data_compat.py`、`tools/serve.ps1`、`start.bat`、`check-data.bat`、`data/admin_divisions.json`、`data/taxonomy-lookup.json`
- 不包含：`data/botanical.db*`、`data/images/`、`*.bak`、`.git/`、`dist/`、`.github/`、发布维护脚本

因此客户下载新版后直接覆盖现有目录即可完成更新。

## 版本号

当前版本号在 `VERSION` 文件中，启动后顶部栏会显示。
