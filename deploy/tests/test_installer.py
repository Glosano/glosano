"""Installer failure/retry tests; fake only host commands, not a database."""
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.assets = self.root / "assets"
        self.assets.mkdir()
        compose = (ROOT / "deploy/compose.yaml").read_bytes()
        (self.assets / "compose.yaml").write_bytes(compose)
        (self.assets / "SHA256SUMS").write_text(
            hashlib.sha256(compose).hexdigest() + "  compose.yaml\n"
        )
        self.script = self.root / "install.sh"
        self.script.write_text((ROOT / "deploy/install.sh").read_text().replace("__VERSION__", "v0.0.1"))
        self.install = self.root / "instance with spaces"
        self.env = os.environ | {
            "PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}",
            "GLOSANO_INSTALL_DIR": str(self.install),
            "GLOSANO_ADMIN_EMAIL": "owner@example.com",
            "GLOSANO_URL": "http://localhost:49179",
            "GLOSANO_BIND": "127.0.0.1:49179",
            "TEST_ASSETS": str(self.assets),
            "TEST_LOG": str(self.root / "docker.log"),
        }
        self.command("uname", '#!/bin/sh\necho Linux\n')
        self.command("docker", '''#!/bin/sh
printf '%s\n' "$*" >> "$TEST_LOG"
case "$*" in
  'info') exit 0;;
  'compose version --short') echo "${TEST_COMPOSE_VERSION:-2.39.0}";;
  *'up -d'*) test "${TEST_FAIL_UP:-}" != 1;;
esac
''')
        self.command("curl", '''#!/usr/bin/env python3
import os, pathlib, sys
args=sys.argv[1:]
if os.environ.get('TEST_FAIL_DOWNLOAD') == '1': sys.exit(22)
if '-o' in args:
 target=pathlib.Path(args[args.index('-o')+1])
 url=next(a for a in args if a.startswith('https://'))
 target.write_bytes((pathlib.Path(os.environ['TEST_ASSETS'])/url.rsplit('/',1)[1]).read_bytes())
else:
 print('{"status":"not_ready"}' if os.environ.get('TEST_FAIL_READY') else '{"status":"ready"}')
''')
        self.command("sha256sum", '''#!/usr/bin/env python3
import hashlib,pathlib,sys
for line in pathlib.Path(sys.argv[-1]).read_text().splitlines():
 expected,name=line.split()
 if hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest()!=expected: sys.exit(1)
''')

    def command(self, name, content):
        path = self.bin / name
        path.write_text(content)
        path.chmod(0o755)

    def run_install(self, **extra):
        return subprocess.run(["bash", str(self.script)], env=self.env | extra,
                              capture_output=True, text=True, timeout=20)

    def test_install_and_repeat_preserve_configuration(self):
        result = self.run_install()
        self.assertEqual(result.returncode, 0, result.stderr)
        before = (self.install / ".env").read_bytes()
        self.assertEqual((self.install / ".env").stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.run_install().returncode, 0)
        self.assertEqual(before, (self.install / ".env").read_bytes())
        self.assertIn("--if-missing", (self.root / "docker.log").read_text())

    def test_download_failure_can_resume_without_new_secrets(self):
        self.assertNotEqual(self.run_install(TEST_FAIL_DOWNLOAD="1").returncode, 0)
        before = (self.install / ".env").read_bytes()
        self.assertFalse((self.install / "compose.yaml").exists())
        self.assertEqual(self.run_install().returncode, 0)
        self.assertEqual(before, (self.install / ".env").read_bytes())

    def test_changed_compose_is_not_overwritten(self):
        self.assertEqual(self.run_install().returncode, 0)
        (self.install / "compose.yaml").write_text("local customization")
        self.assertNotEqual(self.run_install().returncode, 0)
        self.assertEqual((self.install / "compose.yaml").read_text(), "local customization")

    def test_checksum_mismatch_is_rejected(self):
        (self.assets / "compose.yaml").write_text("corrupt")
        self.assertNotEqual(self.run_install().returncode, 0)
        self.assertFalse((self.install / "compose.yaml").exists())

    def test_existing_unmanaged_directory_is_untouched(self):
        self.install.mkdir()
        (self.install / ".env").write_text("existing")
        self.assertNotEqual(self.run_install().returncode, 0)
        self.assertEqual((self.install / ".env").read_text(), "existing")

    def test_other_version_is_not_upgraded(self):
        self.assertEqual(self.run_install().returncode, 0)
        self.script.write_text(self.script.read_text().replace("version=v0.0.1", "version=v0.0.2"))
        self.assertNotEqual(self.run_install().returncode, 0)

    def test_startup_or_public_url_failure_never_reports_success(self):
        for extra in [{"TEST_FAIL_UP": "1"}, {"TEST_FAIL_READY": "1"}]:
            with self.subTest(extra=extra):
                result = self.run_install(**extra)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("is ready at", result.stdout)

    def test_old_compose_and_invalid_input_are_rejected(self):
        for extra in [{"TEST_COMPOSE_VERSION": "2.19.0"}, {"GLOSANO_ADMIN_EMAIL": "invalid"},
                      {"GLOSANO_URL": "http://192.168.1.2:8000"}]:
            with self.subTest(extra=extra):
                self.assertNotEqual(self.run_install(**extra).returncode, 0)

    def test_occupied_port_is_rejected(self):
        import socket
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            bind = f"127.0.0.1:{listener.getsockname()[1]}"
            result = self.run_install(GLOSANO_BIND=bind, GLOSANO_URL=f"http://localhost:{listener.getsockname()[1]}")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("occupied", result.stderr)

    def test_macos_uses_portable_checksum_and_local_http(self):
        self.command("uname", '#!/bin/sh\necho Darwin\n')
        self.command("shasum", (self.bin / "sha256sum").read_text())
        bash_env = self.root / "bash-env"
        bash_env.write_text('command() { if [[ "$*" == "-v sha256sum" ]]; then return 1; fi; builtin command "$@"; }\n')
        result = self.run_install(BASH_ENV=str(bash_env))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("GLOSANO_LOCAL_HTTP=true", (self.install / ".env").read_text())

    def test_local_network_binding_and_port_mismatch_are_rejected(self):
        for bind in ("0.0.0.0:49179", "192.168.1.2:49179", "127.0.0.1:49180"):
            with self.subTest(bind=bind):
                result = self.run_install(GLOSANO_BIND=bind)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((self.install / ".env").exists())

    def test_https_preserves_server_cookie_mode(self):
        result = self.run_install(GLOSANO_URL="https://glosano.example.com")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("GLOSANO_LOCAL_HTTP=false", (self.install / ".env").read_text())

    def test_local_url_port_sets_default_binding(self):
        self.env.pop("GLOSANO_BIND", None)
        result = self.run_install(GLOSANO_URL="http://127.0.0.1:49179")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("GLOSANO_BIND=127.0.0.1:49179", (self.install / ".env").read_text())


if __name__ == "__main__":
    unittest.main()
