"""A stand-in for a model server, for running the docs' examples offline.

It answers OpenAI Chat Completions on 127.0.0.1:11434 — where every LM15 SDK
sends an `ollama:` model — with one fixed reply, plain or streamed, and appends
each request body it receives to the file named by the first argument (one
JSON object per line). Run it inside a network namespace with no route out
(`unshare -rn`), so an example that tried to reach a real provider would fail.
"""
import json
import pathlib
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG = sys.argv[1]
REPLY = "Probably wood mice."
USAGE = {"prompt_tokens": 12, "completion_tokens": 5, "total_tokens": 17}
# The tools page's question is answered with a call to its tool, as a model would.
TOUR = json.loads((pathlib.Path(__file__).parent.parent / "src/data/tour-text.json").read_text())
# The errors page: a model it does not have (Ollama's own 404 for a model not pulled), and one it
# rate-limits once (429, Retry-After: 0) before answering, so a retry has something to retry.
MISSING = "no-such-model"
BUSY = "busy-model"
BUSY_SEEN = []
CALL = {"id": "call_docs_1", "type": "function", "function": {"name": TOUR["tool"], "arguments": json.dumps({"query": "oak grove"})}}


def text_of(message):
    content = message.get("content")
    return content if isinstance(content, str) else "".join(p.get("text", "") for p in content or [])


def wants_call(body):
    last = body["messages"][-1]
    return bool(body.get("tools")) and last["role"] == "user" and text_of(last) == TOUR["toolQuestion"]


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
        if body["model"] == MISSING:
            self.reply(404, {"error": {"message": f'model "{MISSING}" not found, try pulling it first', "type": "api_error", "param": None, "code": None}})
            return
        if body["model"] == BUSY and not BUSY_SEEN:
            BUSY_SEEN.append(True)
            self.reply(429, {"error": {"message": "Rate limit reached, please retry.", "type": "rate_limit_error", "code": "rate_limit_exceeded"}}, [("Retry-After", "0")])
            return
        if body.get("stream"):
            words = ["Probably ", "wood ", "mice."]
            chunks = [{**base, "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {"role": "assistant", "content": w} if i == 0 else {"content": w}, "finish_reason": None}]} for i, w in enumerate(words)]
            chunks.append({**base, "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]})
            chunks.append({**base, "object": "chat.completion.chunk", "choices": [], "usage": USAGE})
            payload = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
        elif body.get("response_format", {}).get("type") == "json_schema":
            answer = json.dumps(TOUR["extract"]["fixtureAnswer"])
            payload = json.dumps({**base, "choices": [{"index": 0, "message": {"role": "assistant", "content": answer}, "finish_reason": "stop"}], "usage": USAGE})
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
        elif wants_call(body):
            payload = json.dumps({**base, "choices": [{"index": 0, "message": {"role": "assistant", "content": None, "tool_calls": [CALL]}, "finish_reason": "tool_calls"}], "usage": USAGE})
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
        else:
            payload = json.dumps({**base, "choices": [{"index": 0, "message": {"role": "assistant", "content": REPLY}, "finish_reason": "stop"}], "usage": USAGE})
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
        data = payload.encode()
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


    def reply(self, status, error, headers=()):
        data = json.dumps(error).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        for name, value in headers:
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


ThreadingHTTPServer(("127.0.0.1", 11434), Handler).serve_forever()
