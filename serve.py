"""Run the ChristmasTree static preview on localhost using Python 3."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import socket
import threading
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener
import webbrowser


class StaticHandler(SimpleHTTPRequestHandler):
    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map,
                          **{'.mjs': 'text/javascript', '.wasm': 'application/wasm',
                             '.task': 'application/octet-stream'})


class LocalPreviewServer(ThreadingHTTPServer):
    allow_reuse_address = os.name != 'nt'

    def server_bind(self):
        if os.name == 'nt':
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def same_preview(root, port):
    opener = build_opener(ProxyHandler({}))
    try:
        for name in ('index.html', 'style.css', 'scene.js', 'gestures.js'):
            source = (root / name).read_bytes()
            with opener.open(f'http://127.0.0.1:{port}/{name}', timeout=2) as response:
                if response.read(len(source) + 1) != source:
                    return False
    except (OSError, URLError):
        return False
    return True


def open_preview(url):
    if os.name == 'nt':
        import winreg

        app_path = r'Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe'
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            try:
                with winreg.OpenKey(hive, app_path) as key:
                    chrome = Path(os.path.expandvars(winreg.QueryValueEx(key, '')[0]))
                if chrome.is_file() and webbrowser.BackgroundBrowser(str(chrome)).open(url):
                    return
            except OSError:
                continue
    webbrowser.open(url)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, help='Use a specific port. Default: try 8077 and fall back to a free port.')
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    if args.port is not None and not 0 <= args.port <= 65535:
        parser.error('--port must be between 0 and 65535')

    root = Path(__file__).resolve().parent
    handler = partial(StaticHandler, directory=str(root))
    port = 8077 if args.port is None else args.port
    try:
        server = LocalPreviewServer(('127.0.0.1', port), handler)
    except OSError as exc:
        if same_preview(root, port):
            url = f'http://localhost:{port}/'
            print(f'ChristmasTree is already running: {url}', flush=True)
            if not args.no_browser:
                open_preview(url)
            return
        if args.port is not None:
            parser.exit(1, f'Could not use port {port}: {exc}\nRun without --port to choose a free port.\n')
        server = LocalPreviewServer(('127.0.0.1', 0), handler)

    url = f'http://localhost:{server.server_port}'
    print(f'ChristmasTree: {url}\nPress Ctrl+C to stop.', flush=True)
    if not args.no_browser:
        timer = threading.Timer(0.3, open_preview, args=(url,))
        timer.daemon = True
        timer.start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
