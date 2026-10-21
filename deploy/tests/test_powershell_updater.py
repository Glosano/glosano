"""Run the update transaction suite in native Windows PowerShell 5.1 and PS7."""
import os
import shutil
import subprocess
import sys
import unittest
import test_updater

POWERSHELL = os.environ.get('GLOSANO_TEST_POWERSHELL') or shutil.which('pwsh') or shutil.which('powershell')

@unittest.skipUnless(POWERSHELL, 'PowerShell is required (Windows CI runs this suite)')
class PowerShellUpdaterTests(test_updater.UpdaterTests):
    def setUp(self):
        super().setUp()
        self.script = self.root/'update.ps1'
        self.script.write_text((test_updater.ROOT/'deploy/update.ps1').read_text().replace('__VERSION__','v0.0.5'))
        self.harness = self.root/'harness.ps1'
        self.harness.write_text(r'''
$ErrorActionPreference = 'Stop'
function Invoke-WebRequest {
    param([string]$Uri, [string]$OutFile, [switch]$UseBasicParsing)
    if ($env:TEST_FAIL -eq 'download') { throw 'download failed' }
    $parts = $Uri.Split('/')
    [IO.File]::Copy((Join-Path (Join-Path $env:TEST_ASSETS $parts[-2]) $parts[-1]), $OutFile, $true)
}
function Invoke-RestMethod {
    param([string]$Uri, [int]$TimeoutSec)
    if ($env:TEST_FAIL -eq 'ready' -and (Get-Content -Raw $env:TEST_LOG).Contains('"up"')) { return @{status='not_ready'} }
    return @{status='ready'}
}
$before = [Environment]::GetEnvironmentVariables('Process')
& $env:TEST_UPDATER
$after = [Environment]::GetEnvironmentVariables('Process')
foreach ($name in @('GLOSANO_INSTALL_DIR','GLOSANO_SECRET_KEY','POSTGRES_PASSWORD','COMPOSE_PROJECT_NAME')) {
    if ($before.Contains($name) -ne $after.Contains($name) -or $before[$name] -cne $after[$name]) { throw "Changed caller environment: $name" }
}
''')
        # Use a native command, so PS5 quoting and stdin behavior are exercised.
        if os.name == 'nt':
            (self.bin/'docker.cmd').write_text('@echo off\n"'+sys.executable+'" "'+str(self.bin/'docker')+'" %*\n')
        self.env.update(TEST_UPDATER=str(self.script))

    def run_update(self, **extra):
        return subprocess.run([POWERSHELL,'-NoProfile','-ExecutionPolicy','Bypass','-File',str(self.harness)],env=self.env|extra,capture_output=True,text=True,stdin=subprocess.DEVNULL,timeout=60)
