#!/usr/bin/env python3
"""
RVC Sound Clone —— 本地服务桥接层（仅用 Python 标准库）

作用
----
静态网页（GitHub Pages / 任意 origin）无法直接跨域调用你本机的 RVC 服务，
这个桥接层做三件事：

  1. 提供 CORS 头，让网页可以直接 fetch；
  2. 把网页的 JSON 协议翻译成官方 RVC WebUI 的 API 调用；
  3. 顺带做请求超时与错误归一化。

协议（与 assets/js/engine-server.js 一致）
------------------------------------------
GET  /api/health
    -> { ok: true, service: "rvc-bridge", upstream: "http://127.0.0.1:5555", models: [...] }

POST /api/convert
    body: {
      "audio": "<base64 WAV>",
      "sample_rate": 16000,
      "model": { "name": "MyVoice" } | null,
      "out_sample_rate": 0,
      "params": { "f0up_key": 0, "index_rate": 0.75,
                  "protect": 0.33, "rms_mix_rate": 0.25, "filter_radius": 3 }
    }
    -> { "audio": "<base64 WAV>", "sample_rate": 48000, "metrics": { "ms": 123 } }

用法
----
    python3 server/bridge.py [--host 127.0.0.1] [--port 7865] \
        [--upstream http://127.0.0.1:5555] [--mode rvc|echo]

    --mode echo：不调用上游，直接把收到的音频原样返回，
                 用于在没有安装 RVC 的机器上联调网页与桥接层。

然后在网页“设置”里把引擎切到“本地服务引擎”，地址填 http://127.0.0.1:7865。
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_UPSTREAM = "http://127.0.0.1:5555"   # 官方 RVC WebUI api.py 默认端口
BODY_LIMIT = 64 * 1024 * 1024                # 64 MB


class Config:
    upstream = DEFAULT_UPSTREAM
    mode = "rvc"
    started = time.time()


# ---------------------------------------------------------------------------
# 上游调用
# ---------------------------------------------------------------------------

def rvc_list_voices() -> list:
    """向上游询问可用音色（官方 api.py 的 /pld_id_get）。"""
    try:
        req = urllib.request.Request(Config.upstream + "/pld_id_get", method="POST",
                                     data=json.dumps({}).encode(),
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode() or "{}")
        if isinstance(data, dict) and "models" in data:
            return data["models"]
        return []
    except Exception:
        return []


def rvc_convert(payload: dict) -> dict:
    """把网页 payload 翻译成官方 api.py 的 infer_dev/infer_upload 调用。"""
    params = payload.get("params") or {}
    upstream_body = {
        "audio_bytes": payload["audio"],          # base64 WAV
        "voice_id": 0,                            # 由 --voice 或后续版本细化
        "sample_rate": int(payload.get("sample_rate") or 16000),
        "f0up_key": int(params.get("f0up_key") or 0),
        "index_rate": float(params.get("index_rate", 0.75)),
        "protect": float(params.get("protect", 0.33)),
        "rms_mix_rate": float(params.get("rms_mix_rate", 0.25)),
        "filter_radius": int(params.get("filter_radius", 3)),
        "resample_sr": int(payload.get("out_sample_rate") or 0),
    }
    req = urllib.request.Request(
        Config.upstream + "/infer_dev",
        data=json.dumps(upstream_body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    started = time.time()
    with urllib.request.urlopen(req, timeout=600) as resp:
        data = json.loads(resp.read().decode() or "{}")
    return {
        "audio": data.get("audio") or data.get("audio_bytes"),
        "sample_rate": data.get("sample_rate") or payload.get("out_sample_rate") or 16000,
        "metrics": {"ms": int((time.time() - started) * 1000), "upstream": Config.upstream},
    }


def echo_convert(payload: dict) -> dict:
    """联调用：原样返回输入音频。"""
    return {
        "audio": payload["audio"],
        "sample_rate": int(payload.get("sample_rate") or 16000),
        "metrics": {"ms": 3, "mode": "echo"},
    }


# ---------------------------------------------------------------------------
# HTTP 处理
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "rvc-bridge/0.1"
    protocol_version = "HTTP/1.1"

    # 安静一点，只打错误
    def log_message(self, fmt, *args):  # noqa: A003
        sys.stderr.write("[bridge] %s\n" % (fmt % args))

    # ---- CORS ----
    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _json(self, obj: dict, status: int = 200) -> None:
        body = json.dumps(obj).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status: int, message: str) -> None:
        self._json({"ok": False, "error": message}, status)

    def do_GET(self):  # noqa: N802
        if self.path in ("/api/health", "/api/health/"):
            models = rvc_list_voices() if Config.mode == "rvc" else ["echo"]
            return self._json({
                "ok": True,
                "service": "rvc-bridge",
                "version": "0.1.0",
                "mode": Config.mode,
                "upstream": Config.upstream,
                "models": models,
                "uptime_s": int(time.time() - Config.started),
            })
        if self.path in ("/", "/index.html"):
            return self._json({
                "ok": True,
                "service": "rvc-bridge",
                "hint": "POST /api/convert，浏览器里设置服务地址为 http://127.0.0.1:%d" % self.server.server_port,
            })
        return self._error(404, "not found: " + self.path)

    def do_POST(self):  # noqa: N802
        if self.path.rstrip("/") != "/api/convert":
            return self._error(404, "not found: " + self.path)

        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                return self._error(400, "empty request body")
            if length > BODY_LIMIT:
                return self._error(413, "request body too large")
            payload = json.loads(self.rfile.read(length).decode() or "{}")
        except Exception as err:
            return self._error(400, f"bad request: {err}")

        if not payload.get("audio"):
            return self._error(400, "missing 'audio' (base64 WAV)")

        try:
            if Config.mode == "echo":
                result = echo_convert(payload)
            else:
                result = rvc_convert(payload)
            if not result.get("audio"):
                return self._error(502, "上游未返回音频，请确认 RVC WebUI 已启动且已加载模型")
            return self._json({
                "ok": True,
                "audio": result["audio"],
                "sample_rate": result.get("sample_rate") or 16000,
                "metrics": result.get("metrics") or {},
            })
        except urllib.error.URLError as err:
            return self._error(502, f"无法连接上游 RVC 服务（{Config.upstream}）：{err.reason}")
        except Exception as err:
            return self._json({"ok": False, "error": f"{type(err).__name__}: {err}"}, 500)


def main() -> None:
    ap = argparse.ArgumentParser(description="RVC Sound Clone 本地服务桥接层")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=7865)
    ap.add_argument("--upstream", default=DEFAULT_UPSTREAM,
                    help=f"官方 RVC WebUI API 地址（默认 {DEFAULT_UPSTREAM}）")
    ap.add_argument("--mode", default="rvc", choices=["rvc", "echo"],
                    help="echo 模式不调用上游，用于联调")
    args = ap.parse_args()

    Config.upstream = args.upstream.rstrip("/")
    Config.mode = args.mode

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"RVC bridge 已启动：http://{args.host}:{args.port}")
    print(f"  mode      : {args.mode}")
    print(f"  upstream  : {Config.upstream}")
    print("  在网页“设置 → 本地服务引擎”中填入上面的地址即可。Ctrl+C 退出。\n")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已退出。")


if __name__ == "__main__":
    main()
