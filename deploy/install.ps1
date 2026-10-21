#Requires -Version 5.1
# Published per release; __VERSION__ is replaced when packaging release assets.
& {
    $ErrorActionPreference = 'Stop'
    $version = '__VERSION__'
    $staging = $null
    $lock = $null
    $savedEnvironment = @{}
    function Fail([string]$message) { throw "Glosano: $message" }
    function Prompt([string]$label, [string]$default) {
        $answer = Read-Host "$label [$default]"
        if ([string]::IsNullOrWhiteSpace($answer)) { return $default }
        return $answer
    }
    function RandomHex([int]$bytes) {
        $buffer = New-Object byte[] $bytes
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
        return ([BitConverter]::ToString($buffer)).Replace('-', '').ToLowerInvariant()
    }
    function WritePrivateFile([string]$path, [string]$content) {
        [IO.File]::WriteAllText($path, $content, (New-Object Text.UTF8Encoding $false))
        if ($env:OS -eq 'Windows_NT') {
            $acl = Get-Acl -LiteralPath $path
            $acl.SetAccessRuleProtection($true, $false)
            $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
            $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'Allow')
            $acl.SetAccessRule($rule)
            Set-Acl -LiteralPath $path -AclObject $acl
        } else {
            & chmod 600 $path
            if ($LASTEXITCODE -ne 0) { Fail 'Cannot protect the configuration file.' }
        }
    }
    function InvokeDocker([string[]]$Arguments) {
        & docker @Arguments
        if ($LASTEXITCODE -ne 0) { Fail "Docker command failed: docker $($Arguments -join ' ')" }
    }
    try {
        if ($version -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+$') { Fail 'Use install.ps1 from a published release.' }
        if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'Install and start Docker Desktop (Linux containers) first.' }
        & docker info *> $null
        if ($LASTEXITCODE -ne 0) { Fail 'Docker is unavailable. Start Docker Desktop with Linux containers.' }
        $composeVersion = (InvokeDocker -Arguments @('compose', 'version', '--short') | Out-String).Trim().TrimStart('v').Split('-')[0]
        if ([version]$composeVersion -lt [version]'2.20.0') { Fail 'Docker Compose v2.20 or newer is required.' }
        $installDir = $env:GLOSANO_INSTALL_DIR
        if (-not $installDir) { $installDir = Prompt 'Installation directory' (Join-Path (Get-Location) 'glosano') }
        if (-not $installDir) { Fail 'An installation directory is required.' }
        $installDir = [IO.Path]::GetFullPath($installDir)
        if (-not (Test-Path -LiteralPath $installDir)) { New-Item -ItemType Directory -Path $installDir | Out-Null }
        foreach ($name in @('.env', 'compose.yaml', '.glosano-install')) {
            $path = Join-Path $installDir $name
            if ((Test-Path -LiteralPath $path) -and ((Get-Item -Force -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                Fail 'Managed files must not be symbolic links.'
            }
        }
        if (Test-Path -LiteralPath (Join-Path $installDir '.glosano-update')) { Fail 'An unfinished update needs recovery; see docs/docker-update.md.' }
        $markerPath = Join-Path $installDir '.glosano-install'
        if (-not (Test-Path -LiteralPath $markerPath)) {
            if (@(Get-ChildItem -Force -LiteralPath $installDir).Count -ne 0) { Fail 'Choose an empty directory; existing files will not be overwritten.' }
            WritePrivateFile $markerPath "$version`n"
        }
        if ((Get-Content -Raw -LiteralPath $markerPath).Trim() -ne $version) { Fail 'This directory belongs to another release. Follow the update procedure.' }
        $lockPath = Join-Path $installDir '.install.lock'
        try { New-Item -ItemType Directory -Path $lockPath | Out-Null } catch { Fail 'Another installer is running (or .install.lock remains after interruption).' }
        $lock = $lockPath
        $staging = Join-Path $installDir ('.install.' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $staging | Out-Null
        $envPath = Join-Path $installDir '.env'
        if (Test-Path -LiteralPath $envPath) {
            $values = @{}
            foreach ($line in Get-Content -LiteralPath $envPath) {
                if ($line -match '^([^=]+)=(.*)$') { $values[$Matches[1]] = $Matches[2] }
            }
            if ($values['GLOSANO_VERSION'] -ne $version) { Fail 'Configured version differs. Use the update procedure.' }
            $email = $values['GLOSANO_INSTALL_ADMIN_EMAIL']
            $url = $values['GLOSANO_INSTALL_URL']
        } else {
            $email = $env:GLOSANO_ADMIN_EMAIL
            if (-not $email) { $email = Prompt 'Administrator email' '' }
            if ($email -notmatch '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$') { Fail 'Enter a valid administrator email.' }
            $url = $env:GLOSANO_URL
            if (-not $url) { $url = Prompt 'Application URL (local HTTP or server HTTPS)' 'http://localhost:8000' }
            $url = $url.TrimEnd('/')
            if ($url -notmatch '^https://[A-Za-z0-9.-]+(:[0-9]+)?$' -and $url -notmatch '^http://(localhost|127\.0\.0\.1)(:[0-9]+)?$') {
                Fail 'Use http://localhost:PORT (or 127.0.0.1) or an HTTPS origin, without a path.'
            }
            $localHttp = $url.StartsWith('http://')
            $urlPort = ([Uri]$url).Port
            $bind = $env:GLOSANO_BIND
            if (-not $bind) { if ($localHttp) { $bind = "127.0.0.1:$urlPort" } else { $bind = '127.0.0.1:8000' } }
            if ($bind -notmatch '^((?:[0-9]{1,3}\.){3}[0-9]{1,3}):([0-9]{1,5})$') { Fail 'GLOSANO_BIND must be IPv4:PORT.' }
            $bindHost = $Matches[1]
            $port = [int]$Matches[2]
            if ($port -lt 1 -or $port -gt 65535) { Fail 'Port must be between 1 and 65535.' }
            if ($localHttp -and ($bindHost -ne '127.0.0.1' -or $port -ne $urlPort)) { Fail 'Local HTTP must bind to 127.0.0.1 with the same port as the URL.' }
            $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Parse($bindHost), $port)
            try { $listener.Start() } catch { Fail "Port $bind is occupied or unavailable. Choose GLOSANO_BIND and a matching URL." } finally { $listener.Stop() }
            $config = @(
                'COMPOSE_PROJECT_NAME=glosano-' + (RandomHex 4)
                "GLOSANO_VERSION=$version"
                'GLOSANO_SECRET_KEY=' + (RandomHex 32)
                'POSTGRES_PASSWORD=' + (RandomHex 24)
                "GLOSANO_BIND=$bind"
                'GLOSANO_LOCAL_HTTP=' + $localHttp.ToString().ToLowerInvariant()
                'GLOSANO_ALLOW_PUBLIC_REGISTRATION=false'
                'GLOSANO_LLM_ENABLED=false'
                'GLOSANO_LLM_FORCE_DISABLED=false'
                "GLOSANO_INSTALL_ADMIN_EMAIL=$email"
                "GLOSANO_INSTALL_URL=$url"
            ) -join "`n"
            $temporaryEnv = Join-Path $staging 'env'
            WritePrivateFile $temporaryEnv "$config`n"
            Move-Item -LiteralPath $temporaryEnv -Destination $envPath
        }
        if (-not $email -or -not $url) { Fail 'Installer metadata is missing from .env; restore it before resuming.' }
        # Windows PowerShell 5.1 must negotiate modern TLS when fetching release assets.
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $base = "https://github.com/Glosano/glosano/releases/download/$version"
        foreach ($asset in @('compose.yaml', 'SHA256SUMS')) {
            Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile (Join-Path $staging $asset)
        }
        $checksums = @(Get-Content -LiteralPath (Join-Path $staging 'SHA256SUMS') | Where-Object { $_ -match '^([0-9a-fA-F]{64})\s+compose\.yaml$' })
        if ($checksums.Count -ne 1) { Fail 'Release checksum for compose.yaml is missing or ambiguous.' }
        $expected = ($checksums[0] -split '\s+')[0]
        $downloadedCompose = Join-Path $staging 'compose.yaml'
        if ((Get-FileHash -Algorithm SHA256 -LiteralPath $downloadedCompose).Hash -ne $expected) { Fail 'Compose checksum verification failed.' }
        $composePath = Join-Path $installDir 'compose.yaml'
        if (Test-Path -LiteralPath $composePath) {
            if ((Get-FileHash -Algorithm SHA256 -LiteralPath $composePath).Hash -ne $expected) { Fail 'Existing Compose differs; refusing to overwrite local changes.' }
        } else { Move-Item -LiteralPath $downloadedCompose -Destination $composePath }
        foreach ($name in @('COMPOSE_PROJECT_NAME', 'GLOSANO_VERSION', 'GLOSANO_IMAGE', 'GLOSANO_SECRET_KEY', 'POSTGRES_PASSWORD', 'GLOSANO_BIND', 'GLOSANO_LOCAL_HTTP', 'GLOSANO_ALLOW_PUBLIC_REGISTRATION', 'GLOSANO_LLM_ENABLED', 'GLOSANO_LLM_FORCE_DISABLED')) {
            $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
            Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
        }
        $compose = @('compose', '--project-directory', $installDir, '-f', $composePath, '--env-file', $envPath)
        InvokeDocker -Arguments ($compose + @('config', '--quiet'))
        InvokeDocker -Arguments ($compose + @('pull'))
        InvokeDocker -Arguments ($compose + @('up', '-d', '--wait', '--wait-timeout', '180'))
        InvokeDocker -Arguments ($compose + @('exec', '-T', 'app-api', 'glosano', 'identity', 'create-admin', $email, '--if-missing'))
        $ready = Invoke-RestMethod -Uri "$url/health/ready" -TimeoutSec 20
        if ($ready.status -ne 'ready') { Fail "Services are not ready at $url. Check Docker and the URL, then re-run." }
        Write-Host "`nGlosano $version is ready at $url`nInstallation: $installDir`nChange the initial password in Settings."
    } finally {
        foreach ($name in $savedEnvironment.Keys) {
            if ($null -eq $savedEnvironment[$name]) {
                Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
            } else {
                [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
            }
        }
        if ($staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
        if ($lock) { Remove-Item -LiteralPath $lock -Force }
    }
}
