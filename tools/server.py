#!/usr/bin/env python3
"""
植物资料库 - HTTP 服务器（带 API 支持）
提供静态文件服务 + 数据持久化 API：
  POST /api/save-db        — 保存数据库到 data/botanical.db
  POST /api/upload-image   — 上传图片到 data/images/
  POST /api/backup-db      — 备份当前数据库（?suffix=xxx 指定后缀）
  POST /api/restore-db     — 从 data/*.bak 恢复数据库（?source=xxx）
  DELETE /api/delete-image  — 删除 data/images/ 中的图片
  GET /api/list-images     — 列出 data/images/ 中的图片
  GET /api/list-backups    — 列出 data/ 中的数据库备份
"""

import os
import sys
import json
import shutil
import time
import urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler

class BotanicalHandler(SimpleHTTPRequestHandler):
    """扩展的 HTTP 处理器，支持 API 端点"""

    def do_POST(self):
        if self.path == '/api/save-db':
            self._handle_save_db()
        elif self.path == '/api/upload-image':
            self._handle_upload_image()
        elif self.path.startswith('/api/backup-db'):
            self._handle_backup_db()
        elif self.path.startswith('/api/restore-db'):
            self._handle_restore_db()
        else:
            self.send_error(404, 'API not found')

    def do_DELETE(self):
        if self.path.startswith('/api/delete-image'):
            self._handle_delete_image()
        else:
            self.send_error(404, 'API not found')

    def do_GET(self):
        if self.path == '/api/list-images':
            self._handle_list_images()
        elif self.path == '/api/list-backups':
            self._handle_list_backups()
        else:
            super().do_GET()

    def _handle_save_db(self):
        """保存数据库二进制到 data/botanical.db"""
        try:
            length = int(self.headers.get('Content-Length', 0))
            if length == 0:
                self.send_error(400, 'Empty body')
                return

            data = self.rfile.read(length)
            db_path = os.path.join(self._root(), 'data', 'botanical.db')
            os.makedirs(os.path.dirname(db_path), exist_ok=True)

            # 写入临时文件再重命名，避免写入中断导致数据损坏
            tmp_path = db_path + '.tmp'
            with open(tmp_path, 'wb') as f:
                f.write(data)
            # 替换
            if os.path.exists(db_path):
                backup_path = db_path + '.bak'
                if os.path.exists(backup_path):
                    os.remove(backup_path)
                os.rename(db_path, backup_path)
            os.rename(tmp_path, db_path)

            self._send_json({'ok': True, 'size': len(data)})
        except Exception as e:
            self.send_error(500, str(e))

    def _handle_upload_image(self):
        """上传图片到 data/images/"""
        try:
            length = int(self.headers.get('Content-Length', 0))
            filename = urllib.parse.unquote(self.headers.get('X-Filename', ''))
            if not filename or length == 0:
                self.send_error(400, 'Missing filename or body')
                return

            # 安全化文件名
            filename = os.path.basename(filename)
            img_dir = os.path.join(self._root(), 'data', 'images')
            os.makedirs(img_dir, exist_ok=True)

            data = self.rfile.read(length)
            filepath = os.path.join(img_dir, filename)
            with open(filepath, 'wb') as f:
                f.write(data)

            self._send_json({'ok': True, 'path': filename, 'size': len(data)})
        except Exception as e:
            self.send_error(500, str(e))

    def _handle_delete_image(self):
        """删除 data/images/ 中的图片"""
        try:
            # 从 query string 获取文件名
            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)
            filename = params.get('file', [''])[0]
            if not filename:
                self.send_error(400, 'Missing file parameter')
                return

            filename = os.path.basename(filename)
            filepath = os.path.join(self._root(), 'data', 'images', filename)
            if os.path.exists(filepath):
                os.remove(filepath)
                self._send_json({'ok': True, 'deleted': filename})
            else:
                self._send_json({'ok': True, 'deleted': None})
        except Exception as e:
            self.send_error(500, str(e))

    def _handle_backup_db(self):
        """备份当前数据库到 data/botanical.db.<suffix>.bak（默认 backup-<时间戳>）"""
        try:
            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)
            suffix = params.get('suffix', [''])[0] or 'backup'
            # 安全化 suffix：仅允许字母、数字、连字符、点
            suffix = ''.join(c for c in suffix if c.isalnum() or c in '-_.')[:64] or 'backup'

            db_path = os.path.join(self._root(), 'data', 'botanical.db')
            if not os.path.exists(db_path):
                self._send_json({'ok': False, 'reason': 'no_db'})
                return

            backup_path = f'{db_path}.{suffix}.bak'
            # 已存在则不覆盖（备份是一次性，避免被多次升级覆盖原始备份）
            if os.path.exists(backup_path):
                self._send_json({'ok': True, 'skipped': True, 'path': backup_path})
                return

            shutil.copy2(db_path, backup_path)
            self._send_json({'ok': True, 'path': backup_path,
                             'size': os.path.getsize(backup_path)})
        except Exception as e:
            self.send_error(500, str(e))

    def _handle_list_backups(self):
        """列出 data/ 目录下的数据库备份文件"""
        try:
            data_dir = os.path.join(self._root(), 'data')
            files = []
            if os.path.isdir(data_dir):
                for name in os.listdir(data_dir):
                    if name.startswith('.') or not name.endswith('.bak'):
                        continue
                    path = os.path.join(data_dir, name)
                    if not os.path.isfile(path):
                        continue
                    stat = os.stat(path)
                    files.append({
                        'name': name,
                        'size': stat.st_size,
                        'modified': time.strftime('%Y-%m-%d %H:%M', time.localtime(stat.st_mtime))
                    })
            files.sort(key=lambda x: x['modified'], reverse=True)
            self._send_json({'ok': True, 'files': files})
        except Exception as e:
            self.send_error(500, str(e))

    def _handle_restore_db(self):
        """从 data/ 中的 .bak 文件恢复 data/botanical.db，恢复前先备份当前数据库"""
        try:
            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)
            source = params.get('source', [''])[0]
            if not source:
                self.send_error(400, 'Missing source parameter')
                return

            source = os.path.basename(source)
            if not source.endswith('.bak'):
                self.send_error(400, 'Invalid backup file')
                return

            data_dir = os.path.join(self._root(), 'data')
            source_path = os.path.join(data_dir, source)
            db_path = os.path.join(data_dir, 'botanical.db')
            if not os.path.exists(source_path):
                self._send_json({'ok': False, 'reason': 'backup_not_found'})
                return

            if os.path.exists(db_path):
                stamp = time.strftime('%Y%m%d-%H%M%S')
                pre_restore = os.path.join(data_dir, f'botanical.db.pre-restore-{stamp}.bak')
                shutil.copy2(db_path, pre_restore)

            tmp_path = db_path + '.restore-tmp'
            shutil.copy2(source_path, tmp_path)
            os.replace(tmp_path, db_path)
            self._send_json({'ok': True, 'restored': source})
        except Exception as e:
            self.send_error(500, str(e))

    def _handle_list_images(self):
        """列出 data/images/ 中的所有图片"""
        try:
            img_dir = os.path.join(self._root(), 'data', 'images')
            if os.path.isdir(img_dir):
                files = os.listdir(img_dir)
                files = [f for f in files if not f.startswith('.')]
            else:
                files = []
            self._send_json({'ok': True, 'files': files})
        except Exception as e:
            self.send_error(500, str(e))

    def _send_json(self, obj):
        """发送 JSON 响应"""
        body = json.dumps(obj).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _root(self):
        """获取项目根目录"""
        return self.directory if hasattr(self, 'directory') else os.getcwd()

    # 静默日志（太频繁的 GET 请求不打印）
    def log_message(self, format, *args):
        # 只打印 API 请求和错误
        msg = format % args
        if '/api/' in msg or '404' in msg or '500' in msg:
            super().log_message(format, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    root = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root)

    # 确保 data/images 目录存在
    os.makedirs(os.path.join(root, 'data', 'images'), exist_ok=True)

    server = HTTPServer(('localhost', port), BotanicalHandler)
    print(f'\n  Botanical Database Server')
    print(f'  URL: http://localhost:{port}')
    print(f'  Root: {root}')
    print(f'  Press Ctrl+C to stop\n')

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n  Server stopped.')
        server.server_close()


if __name__ == '__main__':
    main()
