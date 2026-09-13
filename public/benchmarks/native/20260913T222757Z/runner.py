#!/usr/bin/env python3
"""Server-side coordinator, launched through rcargo run. No model-provider traffic."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import platform
import queue
import random
import shutil
import statistics
import subprocess
import tarfile
import time

from cases import RUST, GO, RUST_MAIN, GO_MAIN, render

ROOT=Path(__file__).resolve().parent

def run(command, env, cwd, timeout=1800):
    result=subprocess.run(command,cwd=cwd,env=env,capture_output=True,text=True,timeout=timeout)
    if result.returncode: raise RuntimeError(f'{command}\n{result.stderr[-7000:]}\n{result.stdout[-2000:]}')
    return result.stdout

def stats(values):
    values=sorted(values)
    def q(p):
        position=(len(values)-1)*p; lo=int(position); hi=min(lo+1,len(values)-1)
        return values[lo]+(values[hi]-values[lo])*(position-lo)
    return {'median':statistics.median(values),'p25':q(.25),'p75':q(.75),'min':min(values),'max':max(values)}

def decode_many(text):
    result=[]; decoder=json.JSONDecoder()
    while text.strip():
        value,end=decoder.raw_decode(text.lstrip()); result.append(value); text=text.lstrip()[end:]
    return result

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workdir',type=Path,required=True)
    parser.add_argument('--prepare-only',action='store_true')
    parser.add_argument('--workers',type=int,default=20)
    parser.add_argument('--samples',type=int,default=40)
    parser.add_argument('--build-samples',type=int,default=5)
    parser.add_argument('--iterations',type=int,default=200)
    args=parser.parse_args()
    if args.workers < 1 or args.samples < 5 or args.samples % args.workers or args.build_samples < 3 or args.iterations < 1:
        parser.error('Use positive workers, at least five runtime samples divisible by workers, at least three builds, and positive iterations')
    work=args.workdir.resolve(); work.mkdir(parents=True,exist_ok=True)
    home=work/'home'; home.mkdir(exist_ok=True)
    env={key:value for key,value in os.environ.items() if key in ['PATH','NIX_LD','NIX_LD_LIBRARY_PATH','LD_LIBRARY_PATH','SSL_CERT_FILE','PKG_CONFIG_PATH','NIX_CFLAGS_COMPILE','NIX_LDFLAGS']}
    env.update({'HOME':str(home),'LANG':'C.UTF-8','LC_ALL':'C.UTF-8','CARGO_HOME':str(Path.home()/'.cargo'),'GOMODCACHE':str(work/'gomodcache'),'GOCACHE':str(work/'prepare-go-cache'),'GOTOOLCHAIN':'local','GOMAXPROCS':'1','CGO_ENABLED':'0','CARGO_BUILD_JOBS':'1','CMAKE_BUILD_PARALLEL_LEVEL':'1','NUM_JOBS':'1','OMP_NUM_THREADS':'1','OPENBLAS_NUM_THREADS':'1'})
    cpus={}
    for line in run(['lscpu','-p=CPU,CORE,SOCKET,ONLINE'],env,work).splitlines():
        if line.startswith('#'): continue
        cpu,core,socket,online=line.split(',')
        if online=='Y' and int(cpu) in os.sched_getaffinity(0): cpus.setdefault((socket,core),int(cpu))
    available=list(cpus.values())
    if args.workers>len(available): parser.error('Not enough distinct physical cores')
    cpus=available[-args.workers:]
    run(['unshare','--user','--map-root-user','--net','true'],env,work)
    sources=json.loads((ROOT/'inputs/sources.json').read_text())
    for language in ['rust','go']:
        archive=ROOT/'inputs'/f'{language}.tar.gz'
        if hashlib.sha256(archive.read_bytes()).hexdigest()!=sources[language]['archive_sha256']: raise RuntimeError('Source snapshot mismatch')
        dest=work/'sources'/language
        if not dest.exists():
            dest.mkdir(parents=True)
            with tarfile.open(archive) as tar: tar.extractall(dest,filter='data')
    versions={tool:run([tool,'--version'] if tool in ['cargo','rustc'] else ['go','version'],env,work).strip() for tool in ['rustc','cargo','go']}
    for tool in ['cc','cmake','pkg-config']:
        versions[tool]=run([tool,'--version'],env,work).splitlines()[0]
    cpu_model=next(line.split(':',1)[1].strip() for line in Path('/proc/cpuinfo').read_text().splitlines() if line.startswith('model name'))
    records={}; projects={}; binaries={}
    for language,cases in [('rust',RUST),('go',GO)]:
        for key,case in cases.items():
            ident=f'{language}/{key}'; project=work/language/key; project.mkdir(parents=True,exist_ok=True); projects[ident]=project
            if language=='rust':
                (project/'src').mkdir(exist_ok=True)
                manifest=f'''[package]\nname = "bench-{key}"\nversion = "0.0.0"\nedition = "2021"\npublish = false\n[workspace]\n[dependencies]\ntokio = {{ version = "1", features = ["rt", "macros", "time", "net"] }}\n{case['dependency']}\n[profile.release]\nopt-level = 3\nlto = false\ncodegen-units = 1\ndebug = 0\nstrip = "symbols"\n'''
                (project/'Cargo.toml').write_text(manifest)
                (project/'src/main.rs').write_text(render(case,RUST_MAIN))
                if not (project/'Cargo.lock').exists(): run(['cargo','generate-lockfile'],env,project)
                run(['cargo','fetch','--locked'],env,project)
                version=case['version']
            else:
                (project/'main.go').write_text(render(case,GO_MAIN))
                if not (project/'go.mod').exists():
                    module=f'module bench.local/{key}\n\ngo 1.26.0\n'
                    if key=='lm15': module+='\nrequire github.com/lm15-dev/lm15-go v0.0.0\nreplace github.com/lm15-dev/lm15-go => ../../sources/go\n'
                    (project/'go.mod').write_text(module)
                    if key!='lm15': run(['go','get',case['module']+'@latest'],env,project)
                run(['go','mod','tidy'],env,project)
                modules=decode_many(run(['go','list','-m','-json','all'],env,project))
                version='working-tree snapshot' if key=='lm15' else next(item['Version'] for item in modules if item['Path']==case['module'])
            records[ident]={'language':language,'id':key,'label':case['label'],'version':version,'source':case['source'],'builds':[],'samples':[]}
            print(f'Prepared {ident}: {version}',flush=True)

    def build(ident, cpu, build_id, cold):
        project=projects[ident]; record=records[ident]; language=record['language']
        destination=work/'targets'/build_id/language/record['id']
        destination.mkdir(parents=True,exist_ok=True)
        build_env=dict(env)
        if language=='rust':
            command=['cargo','build','--release','--locked','--offline','--jobs','1','--target-dir',str(destination)]
            binary=destination/'release'/f"bench-{record['id']}"
        else:
            if cold: build_env['GOCACHE']=str(destination/'cache')
            binary=destination/'program'
            command=['go','build','-mod=readonly','-trimpath','-buildvcs=false','-p=1','-ldflags=-s -w','-o',str(binary),'.']
        started=time.perf_counter()
        # Enforce a single CPU for compilers and all their children, with no network.
        output=subprocess.run(['taskset','-c',str(cpu),'unshare','--user','--map-root-user','--net',*command],cwd=project,env=build_env,capture_output=True,text=True)
        elapsed=time.perf_counter()-started
        if output.returncode: raise RuntimeError(f'{ident} build failed:\n{output.stderr[-7000:]}')
        return binary,{'seconds':elapsed,'bytes':binary.stat().st_size,'sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'cpu':cpu,'command':command}

    def probe(ident, cpu, iterations):
        text=run(['taskset','-c',str(cpu),'unshare','--user','--map-root-user','--net','python3',str(ROOT/'probe.py'),'--binary',str(binaries[ident]),'--iterations',str(iterations)],env,work,timeout=120)
        sample=json.loads(text)
        if sample['cpu_affinity']!=str(cpu): raise RuntimeError('Client changed CPU affinity')
        return sample

    def preflight(index, ident):
        binary,_=build(ident,cpus[index%len(cpus)],'prepare',False)
        binaries[ident]=binary
        sample=probe(ident,cpus[index%len(cpus)],2)
        print(f'Validated {ident}: {sample["fixture"]["dialects"]}',flush=True)
        return ident

    with ThreadPoolExecutor(max_workers=min(8,args.workers)) as pool:
        futures=[pool.submit(preflight,index,ident) for index,ident in enumerate(records)]
        errors=[]
        for future in as_completed(futures):
            try: future.result()
            except Exception as error: print(error,flush=True); errors.append(str(error))
        if errors: raise RuntimeError('Harness validation failed; no benchmark results published')
    if args.prepare_only:
        print('All native harnesses validated. Ready for cold builds and repeated runtime samples.',flush=True); return

    started_at=dt.datetime.now(dt.timezone.utc).isoformat()
    start_load=os.getloadavg()
    slots=queue.Queue()
    for cpu in cpus: slots.put(cpu)
    def cold_job(ident, repetition):
        cpu=slots.get()
        try:
            build_id=f'cold-{repetition}'
            dest=work/'targets'/build_id/records[ident]['language']/records[ident]['id']
            if dest.exists(): shutil.rmtree(dest)
            binary,result=build(ident,cpu,build_id,True)
            if repetition==0:
                retained=work/'binaries'/records[ident]['language']/records[ident]['id']; retained.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(binary,retained); retained.chmod(0o755); binaries[ident]=retained
            shutil.rmtree(dest)
            result['repetition']=repetition
            return ident,result
        finally: slots.put(cpu)
    jobs=[(ident,repetition) for repetition in range(args.build_samples) for ident in records]
    random.Random(20260913).shuffle(jobs)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures=[pool.submit(cold_job,*job) for job in jobs]
        for done,future in enumerate(as_completed(futures),1):
            ident,result=future.result(); records[ident]['builds'].append(result)
            print(f'Clean build {done}/{len(jobs)}: {ident} {result["seconds"]:.1f}s',flush=True)

    def runtime_worker(index,cpu):
        samples=[]; rng=random.Random(20260913+index)
        for repetition in range(args.samples//args.workers):
            keys=list(records); rng.shuffle(keys)
            for ident in keys:
                sample=probe(ident,cpu,args.iterations); sample.update({'worker':index,'round':repetition})
                samples.append((ident,sample))
        return samples
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures=[pool.submit(runtime_worker,index,cpu) for index,cpu in enumerate(cpus)]
        for done,future in enumerate(as_completed(futures),1):
            for ident,sample in future.result(): records[ident]['samples'].append(sample)
            print(f'Runtime worker {done}/{args.workers} complete',flush=True)
    for record in records.values():
        record['summary']={'build_s':stats([item['seconds'] for item in record['builds']]),'binary_bytes':stats([item['bytes'] for item in record['builds']]),'request_us':stats([item['request_us'] for item in record['samples']]),'rss_mib':stats([item['rss_mib'] for item in record['samples']])}
    result={'schema_version':1,'started_at':started_at,'finished_at':dt.datetime.now(dt.timezone.utc).isoformat(),'host':platform.node(),'os':f'{platform.system()} {platform.release()}','cpu':cpu_model,'toolchains':versions,'workers':args.workers,'worker_cpus':cpus,'runtime_samples':args.samples,'build_samples':args.build_samples,'iterations':args.iterations,'load_at_start':start_load,'load_at_end':os.getloadavg(),'sources':sources,'cases':records}
    output=work/'results'; output.mkdir(exist_ok=True)
    (output/'results.json').write_text(json.dumps(result,indent=2)+'\n')
    for filename in ['runner.py','cases.py','probe.py']:
        shutil.copyfile(ROOT/filename,output/filename)
    # Publish harnesses/locks, not the uncommitted Go implementation or build artifacts.
    for ident,project in projects.items():
        destination=output/'harnesses'/ident; destination.mkdir(parents=True,exist_ok=True)
        for name in (['Cargo.toml','Cargo.lock','src/main.rs'] if ident.startswith('rust/') else ['go.mod','go.sum','main.go']):
            source=project/name
            if source.exists(): target=destination/name; target.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(source,target)
    print(f'RESULTS={output}',flush=True)
    for ident,record in records.items(): print(ident,json.dumps(record['summary']),flush=True)

if __name__=='__main__': main()
