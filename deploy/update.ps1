#Requires -Version 5.1
# Published per release; __VERSION__ selects matching target assets and image.
& {
    $ErrorActionPreference = 'Stop'
    $OutputEncoding = New-Object Text.UTF8Encoding $false
    $version = '__VERSION__'
    $staging = $null; $backup = $null; $backupContainer = $null; $lock = $null
    $stopped = $false; $migrating = $false; $savedEnvironment = @{}
    function Fail([string]$message) { throw "Glosano: $message" }
    function InvokeDocker([string[]]$Arguments, [string]$InputText) {
        if ($PSBoundParameters.ContainsKey('InputText')) { $InputText | & docker @Arguments } else { & docker @Arguments }
        if ($LASTEXITCODE -ne 0) { Fail "Docker command failed: docker $($Arguments -join ' ')" }
    }
    function PrivateDirectory([string]$path) {
        if (-not (Test-Path -LiteralPath $path)) { New-Item -ItemType Directory -Path $path | Out-Null }
        if ((Get-Item -Force -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint) { Fail 'Backup directories must not be symbolic links.' }
        if ($env:OS -eq 'Windows_NT') {
            $acl = New-Object Security.AccessControl.DirectorySecurity
            $acl.SetAccessRuleProtection($true, $false)
            $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
            $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
            $acl.SetAccessRule($rule)
            Set-Acl -LiteralPath $path -AclObject $acl
        } else { & chmod 700 $path; if ($LASTEXITCODE -ne 0) { Fail 'Cannot protect backup directory.' } }
    }
    function PrivateFile([string]$path, [string]$content) {
        [IO.File]::WriteAllText($path, $content, (New-Object Text.UTF8Encoding $false))
        if ($env:OS -eq 'Windows_NT') {
            $acl = New-Object Security.AccessControl.FileSecurity
            $acl.SetAccessRuleProtection($true, $false)
            $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
            $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'Allow')
            $acl.SetAccessRule($rule)
            Set-Acl -LiteralPath $path -AclObject $acl
        } else { & chmod 600 $path; if ($LASTEXITCODE -ne 0) { Fail 'Cannot protect configuration.' } }
    }
    function Verify([string]$manifest, [string]$asset, [string]$path) {
        $lines = @(Get-Content -LiteralPath $manifest | Where-Object { $_ -match ('^([0-9a-fA-F]{64})\s+' + [regex]::Escape($asset) + '$') })
        if ($lines.Count -ne 1) { Fail "Missing or ambiguous checksum: $asset" }
        if ((Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash -ne ($lines[0] -split '\s+')[0]) { Fail "Checksum mismatch: $asset. Compose customizations need manual updates." }
    }
    function Ready {
        $response = Invoke-RestMethod -Uri "$url/health/ready" -TimeoutSec 20
        if ($response.status -ne 'ready') { Fail "Application is not ready at $url." }
    }
    try {
        if ($version -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+$') { Fail 'Use update.ps1 from a published release.' }
        if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'Install and start Docker Desktop (Linux containers) first.' }
        InvokeDocker -Arguments @('info') | Out-Null
        $composeVersion = (InvokeDocker -Arguments @('compose', 'version', '--short') | Out-String).Trim().TrimStart('v').Split('-')[0]
        if ([version]$composeVersion -lt [version]'2.20.0') { Fail 'Docker Compose v2.20+ is required.' }
        $installDir = $env:GLOSANO_INSTALL_DIR
        if (-not $installDir) { $installDir = (Get-Location).Path }
        $installDir = [IO.Path]::GetFullPath($installDir)
        foreach ($name in @('.env', 'compose.yaml', '.glosano-install')) {
            $path = Join-Path $installDir $name
            if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or ((Get-Item -Force -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint)) { Fail 'Run in a managed installer directory; managed files must not be symlinks.' }
        }
        foreach ($name in @('compose.override.yml', 'compose.override.yaml', 'docker-compose.override.yml', 'docker-compose.override.yaml')) {
            if (Test-Path -LiteralPath (Join-Path $installDir $name)) { Fail 'Compose overrides need the manual update procedure.' }
        }
        $pointer = Join-Path $installDir '.glosano-update'
        if (Test-Path -LiteralPath $pointer) { Fail 'An unfinished update needs recovery. See .glosano-update and docs/docker-update.md.' }
        $lockPath = Join-Path $installDir '.install.lock'
        try { New-Item -ItemType Directory -Path $lockPath | Out-Null } catch { Fail 'Another installer/updater is running (or .install.lock remains after interruption).' }
        $lock = $lockPath
        if (Test-Path -LiteralPath $pointer) { Fail 'An unfinished update needs recovery; see docs/docker-update.md.' }
        $envPath = Join-Path $installDir '.env'
        $composePath = Join-Path $installDir 'compose.yaml'
        $marker = Join-Path $installDir '.glosano-install'
        $originalEnv = [IO.File]::ReadAllText($envPath)
        $values = @{}
        foreach ($key in @('GLOSANO_VERSION', 'COMPOSE_PROJECT_NAME', 'GLOSANO_INSTALL_URL')) {
            $matchesForKey = [regex]::Matches($originalEnv, '(?m)^' + $key + '=([^\r\n]*)')
            if ($matchesForKey.Count -ne 1) { Fail "Missing or duplicate $key in .env." }
            $values[$key] = $matchesForKey[0].Groups[1].Value
        }
        $sourceVersion = $values['GLOSANO_VERSION']; $project = $values['COMPOSE_PROJECT_NAME']; $url = $values['GLOSANO_INSTALL_URL']
        if ($sourceVersion -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+$' -or (Get-Content -Raw -LiteralPath $marker).Trim() -ne $sourceVersion) { Fail 'Installed version and marker disagree; reconcile manually.' }
        if ($project -notmatch '^[a-z0-9][a-z0-9_-]*$') { Fail 'Invalid saved Compose project name.' }
        if ($url -notmatch '^https://[A-Za-z0-9.-]+(:[0-9]+)?$' -and $url -notmatch '^http://(localhost|127\.0\.0\.1)(:[0-9]+)?$') { Fail 'Invalid saved application URL.' }
        foreach ($entry in @(Get-ChildItem Env: | Where-Object { $_.Name -match '^(GLOSANO_|POSTGRES_|COMPOSE_)|^FORWARDED_ALLOW_IPS$' })) {
            $savedEnvironment[$entry.Name] = $entry.Value
            Remove-Item -LiteralPath "Env:$($entry.Name)"
        }
        $oldCompose = @('compose', '--project-directory', $installDir, '-p', $project, '-f', $composePath, '--env-file', $envPath)
        if ($sourceVersion -eq $version) { Ready; Write-Host "Glosano $version is already installed; no changes made."; return }
        if ([version]$version.Substring(1) -le [version]$sourceVersion.Substring(1)) { Fail 'Downgrades require the restore procedure, not the updater.' }
        $staging = Join-Path $installDir ('.update.' + [Guid]::NewGuid().ToString('N'))
        PrivateDirectory $staging
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $base = 'https://github.com/Glosano/glosano/releases/download'
        foreach ($asset in @('compose.yaml', 'SHA256SUMS', 'update-check.py')) {
            Invoke-WebRequest -UseBasicParsing -Uri "$base/$version/$asset" -OutFile (Join-Path $staging $asset)
        }
        Invoke-WebRequest -UseBasicParsing -Uri "$base/$sourceVersion/SHA256SUMS" -OutFile (Join-Path $staging 'old-SHA256SUMS')
        Verify (Join-Path $staging 'old-SHA256SUMS') 'compose.yaml' $composePath
        Verify (Join-Path $staging 'SHA256SUMS') 'compose.yaml' (Join-Path $staging 'compose.yaml')
        Verify (Join-Path $staging 'SHA256SUMS') 'update-check.py' (Join-Path $staging 'update-check.py')
        $targetEnv = [regex]::Replace($originalEnv, '(?m)^GLOSANO_VERSION=[^\r\n]*', "GLOSANO_VERSION=$version")
        PrivateFile (Join-Path $staging '.env') $targetEnv
        $newCompose = @('compose', '--project-directory', $installDir, '-p', $project, '-f', (Join-Path $staging 'compose.yaml'), '--env-file', (Join-Path $staging '.env'))
        $oldJson = InvokeDocker -Arguments ($oldCompose + @('config', '--format', 'json')) | Out-String
        $newJson = InvokeDocker -Arguments ($newCompose + @('config', '--format', 'json')) | Out-String
        $payload = '{"source":"' + $sourceVersion + '","target":"' + $version + '","old":' + $oldJson + ',"new":' + $newJson + '}'
        InvokeDocker -Arguments @('run', '--rm', '--pull', 'never', '-i', '--entrypoint', 'python', "ghcr.io/glosano/glosano:$sourceVersion", '-c', [IO.File]::ReadAllText((Join-Path $staging 'update-check.py'))) -InputText $payload
        if ((InvokeDocker -Arguments ($oldCompose + @('ps', '--status', 'running', '-q', 'migrate')) | Out-String).Trim()) { Fail 'A migration is already running.' }
        foreach ($role in @('app-api', 'app-worker', 'postgres', 'redis')) {
            $container = (InvokeDocker -Arguments ($oldCompose + @('ps', '--status', 'running', '-q', $role)) | Out-String).Trim()
            if (-not $container) { Fail "Start the existing $role service before updating." }
            if ($role.StartsWith('app-')) {
                $runningImage = (InvokeDocker -Arguments @('inspect', '--format', '{{.Config.Image}}', $container) | Out-String).Trim()
                if ($runningImage -ne "ghcr.io/glosano/glosano:$sourceVersion") { Fail 'Running app image differs from .env; reconcile manually.' }
            }
        }
        Ready
        Write-Host "Downloading Glosano $version before stopping the application..."
        InvokeDocker -Arguments ($newCompose + @('pull', 'migrate', 'app-api', 'app-worker'))
        PrivateDirectory (Join-Path $installDir 'backups')
        $relativeBackup = 'backups/update-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
        $backup = Join-Path $installDir $relativeBackup
        PrivateDirectory $backup
        foreach ($name in @('.env', 'compose.yaml', '.glosano-install')) { Copy-Item -LiteralPath (Join-Path $installDir $name) -Destination (Join-Path $backup $name) }
        PrivateFile $pointer "$relativeBackup`n"
        PrivateFile (Join-Path $backup 'status') "backing-up`n"
        $stopped = $true
        InvokeDocker -Arguments ($oldCompose + @('stop', '--timeout', '60', 'app-api', 'app-worker'))
        Write-Host "Creating a private backup in $backup..."
        $dump = '/tmp/glosano-update-' + [Guid]::NewGuid().ToString('N') + '.dump'
        InvokeDocker -Arguments ($oldCompose + @('exec', '-T', 'postgres', 'pg_dump', '-U', 'glosano', '-Fc', '-f', $dump, 'glosano'))
        InvokeDocker -Arguments ($oldCompose + @('exec', '-T', 'postgres', 'pg_restore', '--list', $dump)) | Out-Null
        # Never redirect binary native stdout through Windows PowerShell 5.1.
        InvokeDocker -Arguments ($oldCompose + @('cp', "postgres:$dump", (Join-Path $backup 'database.dump')))
        InvokeDocker -Arguments ($oldCompose + @('exec', '-T', 'postgres', 'rm', '-f', $dump))
        $redisResult = (InvokeDocker -Arguments ($oldCompose + @('exec', '-T', 'redis', 'redis-cli', 'SAVE')) | Out-String).Trim()
        if ($redisResult -ne 'OK') { Fail 'Redis snapshot failed.' }
        InvokeDocker -Arguments ($oldCompose + @('cp', 'redis:/data/dump.rdb', (Join-Path $backup 'redis.rdb')))
        $backupContainer = 'glosano-backup-' + [Guid]::NewGuid().ToString('N')
        InvokeDocker -Arguments ($oldCompose + @('run', '--name', $backupContainer, '--no-deps', '-T', '--entrypoint', 'python', 'app-api', '-c', "import tarfile; a=tarfile.open('/tmp/app-data.tar.gz','w:gz'); a.add('/var/lib/glosano',arcname='.'); a.close()"))
        InvokeDocker -Arguments @('cp', "${backupContainer}:/tmp/app-data.tar.gz", (Join-Path $backup 'app-data.tar.gz'))
        InvokeDocker -Arguments @('rm', $backupContainer) | Out-Null
        $backupContainer = $null
        foreach ($name in @('database.dump', 'redis.rdb', 'app-data.tar.gz')) {
            if ((Get-Item -LiteralPath (Join-Path $backup $name)).Length -eq 0) { Fail "Empty backup: $name" }
        }
        $checksums = foreach ($name in @('.env', 'compose.yaml', '.glosano-install', 'database.dump', 'redis.rdb', 'app-data.tar.gz')) {
            (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $backup $name)).Hash.ToLowerInvariant() + '  ' + $name
        }
        PrivateFile (Join-Path $backup 'SHA256SUMS') (($checksums -join "`n") + "`n")
        PrivateFile (Join-Path $backup 'BACKUP_COMPLETE') "complete`n"
        PrivateFile (Join-Path $backup 'status') "migrating`n"
        $migrating = $true
        PrivateFile $envPath $targetEnv
        Copy-Item -LiteralPath (Join-Path $staging 'compose.yaml') -Destination $composePath -Force
        $newCompose = @('compose', '--project-directory', $installDir, '-p', $project, '-f', $composePath, '--env-file', $envPath)
        InvokeDocker -Arguments ($newCompose + @('run', '--rm', '--no-deps', '-T', 'migrate'))
        PrivateFile (Join-Path $backup 'status') "starting`n"
        InvokeDocker -Arguments ($newCompose + @('up', '-d', '--no-deps', '--wait', '--wait-timeout', '180', 'app-api'))
        InvokeDocker -Arguments ($newCompose + @('up', '-d', '--no-deps', '--wait', '--wait-timeout', '180', 'app-worker'))
        Ready
        PrivateFile $marker "$version`n"
        PrivateFile (Join-Path $backup 'status') "complete`n"
        Remove-Item -Force -LiteralPath $pointer
        Write-Host "`nGlosano updated from $sourceVersion to $version at $url`nBackup retained: $backup"
    } catch {
        $failure = $_
        if ($stopped) {
            if (-not $migrating) {
                try {
                    InvokeDocker -Arguments ($oldCompose + @('up', '-d', '--no-deps', '--wait', '--wait-timeout', '180', 'app-api', 'app-worker'))
                    Remove-Item -Force -LiteralPath $pointer
                    Write-Warning 'Backup failed; the previous application has been restarted.'
                } catch { Write-Warning 'Could not restart the previous application. Inspect logs and the recovery marker.' }
            } else {
                try { InvokeDocker -Arguments ($newCompose + @('stop', '--timeout', '60', 'app-api', 'app-worker')) } catch { Write-Warning 'Could not stop application services; stop them before recovery.' }
                Write-Warning "Update failed after migration may have begun. Application stopped. Backup: $backup. See docs/docker-update.md; do not rerun or switch only the image tag."
            }
        }
        throw $failure
    } finally {
        foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
        if ($backupContainer) { try { & docker rm $backupContainer *> $null } catch {} }
        if ($staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
        if ($lock) { Remove-Item -LiteralPath $lock -Force }
    }
}
