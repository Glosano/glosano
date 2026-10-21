"""Exercise update transactions with real shells and deterministic Docker failures."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
FAKE = r'''
import hashlib, json, os, pathlib, subprocess, sys
args = sys.argv[1:]
if args and args[0] == '--bridge':
    args = json.loads(pathlib.Path(args[1]).read_text(encoding='utf-8-sig'))
log = pathlib.Path(os.environ['TEST_LOG'])
with log.open('a') as f: f.write(json.dumps(args)+'\n')
fail = os.environ.get('TEST_FAIL', '')
if args == ['info']: sys.exit(0)
if args == ['compose', 'version', '--short']: print('2.39.0'); sys.exit(0)
if args[0] == 'inspect':
    print('ghcr.io/glosano/glosano:' + ('v0.0.3' if fail == 'image' else 'v0.0.4')); sys.exit(0)
if args[0] == 'rm': sys.exit(0)
if args[0] == 'run':
    sys.exit(subprocess.run([sys.executable, '-c', args[-1]], input=sys.stdin.read(), text=True).returncode)
if args[0] == 'cp':
    pathlib.Path(args[-1]).write_bytes(b'\x1f\x8b\x00\xffarchive'); sys.exit(0)
assert args[0] == 'compose', args
if 'config' in args:
    assert not any(k.startswith(('GLOSANO_', 'POSTGRES_', 'COMPOSE_')) for k in os.environ), 'environment leaked'
    settings = dict(line.split('=',1) for line in pathlib.Path(args[args.index('--env-file')+1]).read_text().splitlines() if '=' in line and not line.startswith('#'))
    version = settings['GLOSANO_VERSION']
    services = {k: {'image': k+':1', 'volumes': [{'source':k+'_data','target':'/data'}]} for k in ('postgres','redis')}
    for k in ('migrate','app-api','app-worker'):
        services[k] = {'image':'ghcr.io/glosano/glosano:'+version, 'environment':{'GLOSANO_SECRET_KEY':settings['GLOSANO_SECRET_KEY']}, 'volumes':[{'source':'app_data','target':'/var/lib/glosano'}]}
    config = {'name':settings['COMPOSE_PROJECT_NAME'], 'services':services, 'volumes':{'app_data':{'name':settings['COMPOSE_PROJECT_NAME']+'_app_data'}}, 'networks':{'default':{}}}
    if version == 'v0.0.5' and fail == 'storage': config['volumes']['app_data']['name'] = 'different'
    if version == 'v0.0.5' and fail == 'infra': services['postgres']['image'] = 'postgres:17'
    if fail == 'external': services['app-api']['environment']['GLOSANO_REDIS_URL']='redis://external:6379/0'
    if version == 'v0.0.5' and fail == 'settings': services['app-api']['environment']['GLOSANO_SECRET_KEY']='changed'
    print(json.dumps(config)); sys.exit(0)
if 'ps' in args:
    if args[-1] != 'migrate' and not (fail == 'missing' and args[-1] == 'app-worker'): print(args[-1]+'-id')
    sys.exit(0)
if 'pull' in args: sys.exit(1 if fail == 'pull' else 0)
if 'stop' in args: sys.exit(0)
if 'up' in args: sys.exit(1 if fail == 'start' else 0)
if 'exec' in args:
    if 'pg_dump' in args: sys.exit(1 if fail == 'backup' else 0)
    if 'SAVE' in args: print('ERR' if fail == 'redis' else 'OK')
    sys.exit(0)
if 'cp' in args:
    pathlib.Path(args[-1]).write_bytes(b'PGDMP\x00\xff\r\n' if 'postgres:' in args[-2] else b'REDIS\x00\xff'); sys.exit(0)
if 'run' in args: sys.exit(1 if args[-1] == 'migrate' and fail == 'migration' else 0)
raise Exception(args)
'''
CURL = r'''
import os, pathlib, shutil, sys
args = sys.argv[1:]
url = next(a for a in args if a.startswith('http'))
if url.endswith('/health/ready'):
    if os.environ.get('TEST_FAIL') == 'ready' and '"up"' in pathlib.Path(os.environ['TEST_LOG']).read_text(): sys.exit(22)
    print('{"status":"ready"}'); sys.exit(0)
if os.environ.get('TEST_FAIL') == 'download': sys.exit(22)
version, asset = url.split('/')[-2:]
shutil.copyfile(pathlib.Path(os.environ['TEST_ASSETS'])/version/asset, args[args.index('-o')+1])
'''


class UpdaterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.install = self.root / 'installation with spaces'
        self.install.mkdir()
        self.assets = self.root / 'assets'
        for version in ('v0.0.4', 'v0.0.5'):
            directory = self.assets / version
            directory.mkdir(parents=True)
            (directory/'compose.yaml').write_text('release: '+version+'\n')
            shutil.copyfile(ROOT/'deploy/update-check.py', directory/'update-check.py')
            (directory/'SHA256SUMS').write_text(''.join(hashlib.sha256((directory/f).read_bytes()).hexdigest()+'  '+f+'\n' for f in ('compose.yaml','update-check.py')))
        shutil.copyfile(self.assets/'v0.0.4/compose.yaml', self.install/'compose.yaml')
        self.original = ('COMPOSE_PROJECT_NAME=glosano-existing\nGLOSANO_VERSION=v0.0.4\nGLOSANO_SECRET_KEY=persisted-secret\nPOSTGRES_PASSWORD=persisted-password\nGLOSANO_INSTALL_URL=http://localhost:8000\nGLOSANO_LLM_API_KEY=preserved-key\n# keep this comment\n').encode()
        (self.install/'.env').write_bytes(self.original)
        (self.install/'.glosano-install').write_text('v0.0.4\n')
        self.bin = self.root/'bin'; self.bin.mkdir()
        for name, content in [('docker',FAKE), ('curl',CURL)]:
            path = self.bin/name
            path.write_text('#!'+sys.executable+'\n'+content)
            path.chmod(0o755)
        self.script = self.root/'update.sh'
        self.script.write_text((ROOT/'deploy/update.sh').read_text().replace('__VERSION__','v0.0.5'))
        self.env = {k:v for k,v in os.environ.items() if not k.startswith(('GLOSANO_','POSTGRES_','COMPOSE_'))}
        self.env.update(PATH=str(self.bin)+os.pathsep+self.env['PATH'], GLOSANO_INSTALL_DIR=str(self.install), TEST_ASSETS=str(self.assets), TEST_LOG=str(self.root/'docker.log'))

    def run_update(self, **extra):
        return subprocess.run(['bash',str(self.script)], env=self.env|extra, capture_output=True, text=True, timeout=40)

    def commands(self):
        path = self.root/'docker.log'
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def backups(self):
        return list((self.install/'backups').glob('update-*'))

    def assert_unchanged(self):
        self.assertEqual((self.install/'.env').read_bytes(), self.original)
        self.assertFalse(any('stop' in command for command in self.commands()))
        self.assertFalse(self.backups())
        self.assertFalse((self.install/'.install.lock').exists())

    def test_success_preserves_data_configuration_and_order(self):
        result = self.run_update(GLOSANO_SECRET_KEY='wrong', POSTGRES_PASSWORD='wrong', COMPOSE_PROJECT_NAME='wrong')
        self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
        self.assertEqual((self.install/'.env').read_bytes(), self.original.replace(b'v0.0.4',b'v0.0.5'))
        self.assertEqual((self.install/'.glosano-install').read_text().strip(),'v0.0.5')
        self.assertFalse((self.install/'.glosano-update').exists())
        backup, = self.backups()
        self.assertEqual((backup/'.env').read_bytes(),self.original)
        self.assertEqual((backup/'database.dump').read_bytes(),b'PGDMP\x00\xff\r\n')
        self.assertTrue((backup/'BACKUP_COMPLETE').exists())
        for line in (backup/'SHA256SUMS').read_text().splitlines():
            digest, name = line.split(None,1)
            self.assertEqual(hashlib.sha256((backup/name.strip()).read_bytes()).hexdigest(),digest.lower())
        calls = self.commands()
        locate = lambda token: next(i for i,c in enumerate(calls) if token in c)
        self.assertLess(locate('pull'),locate('stop'))
        self.assertLess(locate('stop'),locate('pg_dump'))
        migration = next(i for i,c in enumerate(calls) if 'run' in c and c[-1]=='migrate')
        self.assertLess(locate('pg_dump'),migration)
        self.assertLess(migration,locate('up'))
        count = len(calls)
        repeat = self.run_update()
        self.assertEqual(repeat.returncode,0,repeat.stderr)
        self.assertEqual(len(self.backups()),1)
        self.assertFalse(any('up' in c or 'stop' in c or 'pull' in c for c in self.commands()[count:]))

    def test_preflight_failures_leave_running_installation(self):
        for failure in ('download','pull','storage','infra','missing','image','external','settings'):
            with self.subTest(failure=failure):
                result = self.run_update(TEST_FAIL=failure)
                self.assertNotEqual(result.returncode,0,result.stdout)
                self.assert_unchanged()

    def test_local_compose_edits_are_rejected(self):
        with (self.install/'compose.yaml').open('a') as f: f.write('# local edit\n')
        self.assertNotEqual(self.run_update().returncode,0)
        self.assert_unchanged()

    def test_bad_target_checksum_is_rejected(self):
        (self.assets/'v0.0.5/update-check.py').write_text('tampered')
        self.assertNotEqual(self.run_update().returncode,0)
        self.assert_unchanged()

    def test_another_process_lock_is_preserved(self):
        lock = self.install/'.install.lock'
        lock.mkdir()
        self.assertNotEqual(self.run_update().returncode,0)
        self.assertTrue(lock.is_dir())
        self.assertFalse(any('stop' in c for c in self.commands()))

    def test_downgrade_is_rejected(self):
        (self.install/'.env').write_bytes(self.original.replace(b'v0.0.4',b'v0.0.6'))
        (self.install/'.glosano-install').write_text('v0.0.6\n')
        self.assertNotEqual(self.run_update().returncode,0)
        self.assertFalse(any('stop' in c for c in self.commands()))

    def test_pending_update_and_overrides_are_rejected(self):
        for name in ('.glosano-update','compose.override.yaml'):
            path = self.install/name; path.write_text('existing')
            result = self.run_update()
            path.unlink()
            self.assertNotEqual(result.returncode,0)
            self.assert_unchanged()

    def test_backup_failure_restarts_old_application(self):
        result = self.run_update(TEST_FAIL='backup')
        self.assertNotEqual(result.returncode,0)
        self.assertEqual((self.install/'.env').read_bytes(),self.original)
        self.assertFalse((self.install/'.glosano-update').exists())
        self.assertTrue(any('up' in c for c in self.commands()))
        self.assertFalse(any('run' in c and c[-1]=='migrate' for c in self.commands()))
        self.assertFalse((self.backups()[0]/'BACKUP_COMPLETE').exists())

    def test_migration_failure_preserves_recovery_and_blocks_retry(self):
        self.check_post_migration_failure('migration')

    def test_readiness_failure_preserves_recovery_and_blocks_retry(self):
        self.check_post_migration_failure('ready')

    def test_startup_failure_preserves_recovery_and_blocks_retry(self):
        self.check_post_migration_failure('start')

    def check_post_migration_failure(self, failure):
        result = self.run_update(TEST_FAIL=failure)
        self.assertNotEqual(result.returncode,0,result.stdout)
        backup, = self.backups()
        self.assertTrue((backup/'BACKUP_COMPLETE').exists())
        self.assertEqual((backup/'.env').read_bytes(),self.original)
        pointer = (self.install/'.glosano-update').read_bytes()
        self.assertEqual((self.install/'.glosano-install').read_text().strip(),'v0.0.4')
        calls = self.commands()
        self.assertIn('stop',calls[-1])
        self.assertNotEqual(self.run_update().returncode,0)
        self.assertEqual((self.install/'.glosano-update').read_bytes(),pointer)
        self.assertEqual(len(self.backups()),1)
        self.assertFalse((self.install/'.install.lock').exists())

if __name__ == '__main__': unittest.main()
