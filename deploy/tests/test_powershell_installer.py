"""Run the same installer guarantees in real PowerShell with fake host commands."""
import os
from pathlib import Path
import shutil
import subprocess
import unittest

import test_installer

POWERSHELL = os.environ.get('GLOSANO_TEST_POWERSHELL') or shutil.which('pwsh') or shutil.which('powershell')


@unittest.skipUnless(POWERSHELL, 'PowerShell is required (Windows CI runs this suite)')
class PowerShellInstallerTests(test_installer.InstallerTests):
    def setUp(self):
        super().setUp()
        self.script = self.root / 'install.ps1'
        self.script.write_text((test_installer.ROOT / 'deploy/install.ps1').read_text().replace('__VERSION__', 'v0.0.1'))
        self.harness = self.root / 'harness.ps1'
        self.harness.write_text(r'''
$ErrorActionPreference = 'Stop'
function docker {
    [IO.File]::AppendAllText($env:TEST_LOG, ($args -join ' ') + "`n")
    $global:LASTEXITCODE = 0
    switch ($args -join ' ') {
        'info' { if ($env:TEST_FAIL_DOCKER) { $global:LASTEXITCODE = 1 }; return }
        'compose version --short' { if ($env:TEST_COMPOSE_VERSION) { $env:TEST_COMPOSE_VERSION } else { '2.39.0' }; return }
    }
    if (($args -join ' ') -match 'up -d' -and $env:TEST_FAIL_UP) { $global:LASTEXITCODE = 1 }
}
function Invoke-WebRequest {
    param([string]$Uri, [string]$OutFile, [switch]$UseBasicParsing)
    if ($env:TEST_FAIL_DOWNLOAD) { throw 'download failed' }
    [IO.File]::Copy((Join-Path $env:TEST_ASSETS ($Uri.Split('/')[-1])), $OutFile, $true)
}
function Invoke-RestMethod {
    param([string]$Uri, [int]$TimeoutSec)
    if ($env:TEST_FAIL_READY) { return @{ status = 'not_ready' } }
    return @{ status = 'ready' }
}
& $env:TEST_INSTALLER
''')
        self.env['TEST_INSTALLER'] = str(self.script)

    def run_install(self, **extra):
        return subprocess.run([POWERSHELL, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(self.harness)],
                              env=self.env | extra, capture_output=True, text=True, timeout=30)

    def test_install_and_repeat_preserve_configuration(self):
        result = self.run_install()
        self.assertEqual(result.returncode, 0, result.stderr)
        before = (self.install / '.env').read_bytes()
        self.assertFalse(before.startswith(b'\xef\xbb\xbf'))
        self.assertEqual(self.run_install().returncode, 0)
        self.assertEqual(before, (self.install / '.env').read_bytes())
        self.assertIn('--if-missing', (self.root / 'docker.log').read_text())

    def test_other_version_is_not_upgraded(self):
        self.assertEqual(self.run_install().returncode, 0)
        self.script.write_text(self.script.read_text().replace("$version = 'v0.0.1'", "$version = 'v0.0.2'"))
        self.assertNotEqual(self.run_install().returncode, 0)

    @unittest.skip('Bash-specific portable checksum path')
    def test_macos_uses_portable_checksum_and_local_http(self):
        pass

    def test_docker_not_running_is_rejected(self):
        result = self.run_install(TEST_FAIL_DOCKER='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Docker is unavailable', result.stderr)
        self.assertFalse(self.install.exists())
