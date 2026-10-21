#!/usr/bin/env python3
"""Real Docker update/restore; only release downloads and target pulls are fixtures."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
IMAGE = sys.argv[1]
RUNTIME = sys.argv[2] if len(sys.argv) > 2 else 'bash'
DOCKER = shutil.which('docker')
OLD, NEW, FAILED = 'v0.0.900000', 'v0.0.900001', 'v0.0.900002'


def run(args, **kw):
    return subprocess.run([str(a) for a in args], check=True, text=True, **kw)


with tempfile.TemporaryDirectory(prefix='glosano-update-') as directory:
    root = Path(directory)
    instance = root/'instance'; instance.mkdir()
    assets = root/'assets'; assets.mkdir()
    project = 'glosano-update-test-'+os.urandom(5).hex()
    sock = socket.socket(); sock.bind(('127.0.0.1',0)); port = sock.getsockname()[1]; sock.close()
    for version in (OLD, NEW, FAILED):
        run(['bash',ROOT/'deploy/package-release.sh',version,assets/version])
        run([DOCKER,'tag',IMAGE,'ghcr.io/glosano/glosano:'+version])
    shutil.copyfile(assets/OLD/'compose.yaml',instance/'compose.yaml')
    original = f'''COMPOSE_PROJECT_NAME={project}
GLOSANO_VERSION={OLD}
GLOSANO_SECRET_KEY={os.urandom(32).hex()}
POSTGRES_PASSWORD={os.urandom(24).hex()}
GLOSANO_LOCAL_HTTP=true
GLOSANO_BIND=127.0.0.1:{port}
GLOSANO_INSTALL_URL=http://localhost:{port}
GLOSANO_LLM_ENABLED=false
'''
    (instance/'.env').write_text(original)
    (instance/'.glosano-install').write_text(OLD+'\n')
    compose = [DOCKER,'compose','-p',project,'-f',instance/'compose.yaml','--env-file',instance/'.env']
    def dc(*args, **kw): return run(compose+list(args), **kw)
    def sql(query): return dc('exec','-T','postgres','psql','-U','glosano','-d','glosano','-Atc',query,capture_output=True).stdout.strip()
    def ids(): return dc('ps','-q','postgres','redis',capture_output=True).stdout
    bin_dir = root/'bin'; bin_dir.mkdir()
    wrapper = bin_dir/'docker'
    wrapper.write_text('#!/usr/bin/env python3\n'+r'''
import os,subprocess,sys
args=sys.argv[1:]
if 'pull' in args and args[0]=='compose': sys.exit(0)
if os.environ.get('TEST_FAIL_MIGRATION') and 'run' in args and args[-1]=='migrate': sys.exit(97)
os.execv(os.environ['TEST_REAL_DOCKER'], [os.environ['TEST_REAL_DOCKER']]+args)
'''); wrapper.chmod(0o755)
    curl = bin_dir/'curl'
    curl.write_text('#!/usr/bin/env python3\n'+r'''
import os,pathlib,shutil,sys
args=sys.argv[1:]
url=next(a for a in args if a.startswith('http'))
if '/releases/download/' in url:
 version,asset=url.split('/')[-2:]; shutil.copyfile(pathlib.Path(os.environ['TEST_ASSETS'])/version/asset,args[args.index('-o')+1]); sys.exit(0)
os.execv(os.environ['TEST_REAL_CURL'],[os.environ['TEST_REAL_CURL']]+args)
'''); curl.chmod(0o755)
    harness = root/'harness.ps1'
    harness.write_text(r'''
$ErrorActionPreference='Stop'
function Invoke-WebRequest {
 param([string]$Uri,[string]$OutFile,[switch]$UseBasicParsing)
 $parts=$Uri.Split('/')
 [IO.File]::Copy((Join-Path (Join-Path $env:TEST_ASSETS $parts[-2]) $parts[-1]),$OutFile,$true)
}
& $env:TEST_UPDATER
''')
    env = {k:v for k,v in os.environ.items() if not k.startswith(('COMPOSE_','POSTGRES_','GLOSANO_'))}
    env.update(PATH=str(bin_dir)+os.pathsep+env['PATH'],TEST_REAL_DOCKER=DOCKER,TEST_REAL_CURL=shutil.which('curl'),TEST_ASSETS=str(assets),GLOSANO_INSTALL_DIR=str(instance))
    def update(version, fail=False):
        target = assets/version/('update.sh' if RUNTIME=='bash' else 'update.ps1')
        args = ['bash'] if RUNTIME=='bash' else [RUNTIME,'-NoProfile','-File',harness]
        result = subprocess.run([str(a) for a in args],env=env|{'TEST_UPDATER':str(target),'TEST_FAIL_MIGRATION':'1' if fail else ''},text=True,capture_output=True,input=target.read_text() if RUNTIME=='bash' else None)
        print(result.stdout)
        if result.returncode and not fail: raise RuntimeError(result.stderr)
        return result
    try:
        dc('up','-d','--wait','--wait-timeout','180')
        sql("CREATE TABLE update_probe (value text); INSERT INTO update_probe VALUES ('preserved');")
        dc('exec','-T','app-api','python','-c',"from pathlib import Path; Path('/var/lib/glosano/update-probe').write_bytes(b'file\\x00\\xff')")
        dc('exec','-T','redis','redis-cli','SET','update-probe','preserved')
        infrastructure = ids()
        update(NEW)
        assert ids()==infrastructure, 'Infrastructure containers were recreated'
        assert sql('SELECT value FROM update_probe')=='preserved'
        assert (instance/'.env').read_text()==original.replace(OLD,NEW)
        dc('exec','-T','app-api','python','-c',"from pathlib import Path; assert Path('/var/lib/glosano/update-probe').read_bytes()==b'file\\x00\\xff'")
        assert dc('exec','-T','redis','redis-cli','GET','update-probe',capture_output=True).stdout.strip()=='preserved'
        backup, = (instance/'backups').glob('update-*')
        for line in (backup/'SHA256SUMS').read_text().splitlines():
            digest,name=line.split(None,1); assert hashlib.sha256((backup/name.strip()).read_bytes()).hexdigest()==digest
        dc('cp',backup/'database.dump','postgres:/tmp/verify.dump')
        dc('exec','-T','postgres','createdb','-U','glosano','restore_probe')
        dc('exec','-T','postgres','pg_restore','-U','glosano','-d','restore_probe','--exit-on-error','/tmp/verify.dump')
        assert dc('exec','-T','postgres','psql','-U','glosano','-d','restore_probe','-Atc','SELECT value FROM update_probe',capture_output=True).stdout.strip()=='preserved'
        update(NEW)
        assert len(list((instance/'backups').glob('update-*')))==1
        result=update(FAILED,fail=True); assert result.returncode!=0
        failed_backup=instance/(instance/'.glosano-update').read_text().strip()
        assert (failed_backup/'BACKUP_COMPLETE').exists()
        assert not dc('ps','--status','running','-q','app-api','app-worker',capture_output=True).stdout.strip()
        # Emulate partial data changes from a failed release, then restore all stores.
        sql("UPDATE update_probe SET value='bad migration'; CREATE TABLE failed_migration_artifact (id int)")
        for name in ('.env','compose.yaml','.glosano-install'): shutil.copyfile(failed_backup/name,instance/name)
        dc('cp',failed_backup/'database.dump','postgres:/tmp/restore.dump')
        dc('exec','-T','postgres','pg_restore','--list','/tmp/restore.dump',stdout=subprocess.DEVNULL)
        dc('exec','-T','postgres','dropdb','-U','glosano','--force','glosano')
        dc('exec','-T','postgres','createdb','-U','glosano','-O','glosano','glosano')
        dc('exec','-T','postgres','pg_restore','-U','glosano','-d','glosano','--exit-on-error','--single-transaction','/tmp/restore.dump')
        assert sql("SELECT to_regclass('failed_migration_artifact')")==''
        restore=project+'-files'
        try:
            dc('run','--name',restore,'--no-deps','-d','--entrypoint','sleep','app-api','infinity')
            run([DOCKER,'cp',failed_backup/'app-data.tar.gz',restore+':/tmp/app-data.tar.gz'])
            run([DOCKER,'exec',restore,'python','-c',"import pathlib,shutil,tarfile; p=pathlib.Path('/var/lib/glosano'); [(shutil.rmtree(x) if x.is_dir() and not x.is_symlink() else x.unlink()) for x in p.iterdir()]; tarfile.open('/tmp/app-data.tar.gz').extractall(p,filter='data')"])
        finally: run([DOCKER,'rm','-f',restore])
        dc('stop','redis')
        restore=project+'-redis'
        try:
            dc('run','--name',restore,'--no-deps','-d','--entrypoint','sleep','redis','infinity')
            run([DOCKER,'cp',failed_backup/'redis.rdb',restore+':/data/dump.rdb'])
            run([DOCKER,'exec',restore,'chown','redis:redis','/data/dump.rdb'])
        finally: run([DOCKER,'rm','-f',restore])
        dc('up','-d','--no-deps','--wait','redis')
        dc('up','-d','--no-deps','--wait','--wait-timeout','180','app-api','app-worker')
        assert sql('SELECT value FROM update_probe')=='preserved'
        dc('exec','-T','app-api','python','-c',"from pathlib import Path; assert Path('/var/lib/glosano/update-probe').read_bytes()==b'file\\x00\\xff'")
        assert dc('exec','-T','redis','redis-cli','GET','update-probe',capture_output=True).stdout.strip()=='preserved'
        (instance/'.glosano-update').unlink()
        print('PASS: real update, repeat, failure isolation, PostgreSQL/files/Redis restore ('+RUNTIME+')')
    finally:
        dc('down','-v','--remove-orphans')
