#!/usr/bin/env python3
"""Run one client process with a private, single-core loopback fixture server."""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import socket
import subprocess
import threading

CHAT = {'id':'bench','object':'chat.completion','created':1,'model':'gpt-4.1-mini','choices':[{'index':0,'message':{'role':'assistant','content':'Hello.'},'finish_reason':'stop'}], 'usage':{'prompt_tokens':3,'completion_tokens':2,'total_tokens':5}}
ANTHROPIC = {'id':'bench','type':'message','role':'assistant','model':'claude-haiku-4-5','content':[{'type':'text','text':'Hello.'}],'stop_reason':'end_turn','stop_sequence':None,'usage':{'input_tokens':3,'output_tokens':2}}
GEMINI = {'candidates':[{'content':{'role':'model','parts':[{'text':'Hello.'}]},'finishReason':'STOP','index':0}],'modelVersion':'gemini-2.5-flash','usageMetadata':{'promptTokenCount':3,'candidatesTokenCount':2,'totalTokenCount':5}}
RESPONSES = {'id':'bench','object':'response','created_at':1,'status':'completed','model':'gpt-4.1-mini','output':[{'type':'message','id':'msg','status':'completed','role':'assistant','content':[{'type':'output_text','text':'Hello.','annotations':[]}]}], 'usage':{'input_tokens':3,'output_tokens':2,'total_tokens':5}, 'error':None,'incomplete_details':None}
FIXTURES = {'chat':CHAT,'anthropic':ANTHROPIC,'gemini':GEMINI,'responses':RESPONSES}


def content_text(value):
    if isinstance(value, str): return value
    if isinstance(value, list): return ''.join(content_text(item) for item in value)
    if isinstance(value, dict):
        return str(value.get('text', ''))
    return ''


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--binary',required=True)
    parser.add_argument('--iterations',type=int,default=200)
    args=parser.parse_args()
    # The enclosing user/network namespace has no external interfaces.
    subprocess.run(['ip','link','set','lo','up'],check=True,capture_output=True)
    observed={'requests':0,'errors':[],'request_bytes':0,'dialects':{},'first_request':None}
    class Handler(BaseHTTPRequestHandler):
        protocol_version='HTTP/1.1'
        def log_message(self,*args): pass
        def setup(self):
            super().setup()
            self.connection.setsockopt(socket.IPPROTO_TCP,socket.TCP_NODELAY,1)
        def do_POST(self):
            body=self.rfile.read(int(self.headers.get('Content-Length','0')))
            observed['requests']+=1
            observed['request_bytes']+=len(body)
            try:
                request=json.loads(body)
                if self.path.endswith('/chat/completions'):
                    dialect='chat'; entries=request['messages']; text=''.join(content_text(item.get('content')) for item in entries if item.get('role')=='user')
                elif self.path.endswith('/messages'):
                    dialect='anthropic'; entries=request['messages']; text=''.join(content_text(item.get('content')) for item in entries if item.get('role')=='user')
                elif ':generateContent' in self.path:
                    dialect='gemini'; text=''.join(content_text(item.get('parts')) for item in request['contents'] if item.get('role')=='user')
                elif self.path.endswith('/responses'):
                    dialect='responses'; text=content_text(request['input']) if isinstance(request['input'],str) else ''.join(content_text(item.get('content')) for item in request['input'] if item.get('role')=='user')
                else: raise ValueError('Unexpected path: '+self.path)
                if text != 'Say hello.': raise ValueError('Unexpected user input: '+repr(text))
                if request.get('stream'): raise ValueError('Expected a non-streaming request')
                limit = request.get('generationConfig', {}).get('maxOutputTokens') if dialect=='gemini' else request.get('max_tokens', request.get('max_completion_tokens', request.get('max_output_tokens')))
                if limit != 32: raise ValueError('Expected a 32-token output limit')
                observed['dialects'][dialect]=observed['dialects'].get(dialect,0)+1
                if observed['first_request'] is None: observed['first_request']={'path':self.path,'body':request}
                response=json.dumps(FIXTURES[dialect],separators=(',',':')).encode()
                self.send_response(200)
            except Exception as error:
                observed['errors'].append(str(error))
                response=json.dumps({'error':{'message':str(error)}}).encode()
                self.send_response(400)
            self.send_header('Content-Type','application/json')
            self.send_header('Content-Length',str(len(response)))
            self.end_headers()
            self.wfile.write(response)
            self.wfile.flush()
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    server.daemon_threads=True
    thread=threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    env={**os.environ,'LM15_BENCH_ENDPOINT':f'http://127.0.0.1:{server.server_port}','LM15_BENCH_ITERATIONS':str(args.iterations)}
    completed=subprocess.run([args.binary],env=env,text=True,capture_output=True,timeout=90)
    server.shutdown(); server.server_close()
    if completed.returncode:
        raise RuntimeError(f'Client failed:\n{completed.stderr[-6000:]}\nFixture errors: {observed["errors"]}')
    lines=[line[len('BENCH_RESULT='):] for line in completed.stdout.splitlines() if line.startswith('BENCH_RESULT=')]
    if len(lines)!=1: raise RuntimeError('Expected exactly one client result: '+completed.stdout[-1000:])
    result=json.loads(lines[0])
    if observed['errors'] or observed['requests'] != args.iterations+20:
        raise RuntimeError('Wrong number or shape of requests: '+json.dumps(observed))
    result['fixture']=observed
    result['fixture_sha256']=hashlib.sha256(json.dumps(FIXTURES,sort_keys=True).encode()).hexdigest()
    print(json.dumps(result),flush=True)


if __name__=='__main__': main()
