"""A stand-in for a model server, for running the docs' examples offline.

It answers OpenAI Chat Completions on 127.0.0.1:11434 — where every LM15 SDK
sends an `ollama:` model — with one fixed reply, plain or streamed, and appends
each request body it receives to the file named by the first argument (one
JSON object per line). Run it inside a network namespace with no route out
(`unshare -rn`), so an example that tried to reach a real provider would fail.
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG = sys.argv[1]
REPLY = "Open the Barolo."
USAGE = {"prompt_tokens": 12, "completion_tokens": 5, "total_tokens": 17}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def read_body(self):
        if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
            body = b""
            while size := int(self.rfile.readline().split(b";")[0], 16):
                body += self.rfile.read(size)
                self.rfile.readline()
            while self.rfile.readline() not in (b"\r\n", b"\n", b""):
                pass
            return body
        return self.rfile.read(int(self.headers["Content-Length"]))

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self.send_error(404)
            return
        body = json.loads(self.read_body())
        with open(LOG, "a") as log:
            log.write(json.dumps(body) + "\n")
        base = {"id": "chatcmpl-docs", "object": "chat.completion", "created": 0, "model": body["model"]}
        if body.get("stream"):
            words = ["Open ", "the ", "Barolo."]
            chunks = [{**base, "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {"role": "assistant", "content": w} if i == 0 else {"content": w}, "finish_reason": None}]} for i, w in enumerate(words)]
            chunks.append({**base, "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]})
            chunks.append({**base, "object": "chat.completion.chunk", "choices": [], "usage": USAGE})
            payload = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
        else:
            payload = json.dumps({**base, "choices": [{"index": 0, "message": {"role": "assistant", "content": REPLY}, "finish_reason": "stop"}], "usage": USAGE})
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
        data = payload.encode()
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


ThreadingHTTPServer(("127.0.0.1", 11434), Handler).serve_forever()
