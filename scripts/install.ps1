[CmdletBinding()]
param(
	[string]$Checkout,
	[string[]]$Register = @(),
	[switch]$NoDoctor
)
$ErrorActionPreference = 'Stop'

Get-ChildItem Env:APPLE_CUA_* | ForEach-Object {
	$name = $_.Name -replace '^APPLE_CUA_', 'OPENCUA_'
	if ($null -eq [Environment]::GetEnvironmentVariable($name, 'Process')) {
		[Environment]::SetEnvironmentVariable($name, $_.Value, 'Process')
	}
}

function Assert-Exit([string]$Step) {
	if ($LASTEXITCODE -ne 0) { throw "$Step failed (exit $LASTEXITCODE)." }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
	if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
		throw 'Install Node.js 20+ from https://nodejs.org, reopen PowerShell, then rerun this script. Alternatively install App Installer to enable winget.'
	}
	& winget install --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements
	Assert-Exit 'Node.js installation'
	$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
	if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
		throw 'Node.js was installed. Reopen PowerShell and rerun this script.'
	}
}
$major = & node -p 'process.versions.node.split(".")[0]'
Assert-Exit 'Node.js version check'
if ([int]$major -lt 20) { throw 'Install Node.js 20+: winget install --id OpenJS.NodeJS.LTS --exact' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
	throw 'Install Git, reopen PowerShell and rerun: winget install --id Git.Git --exact'
}

$root = Join-Path $env:LOCALAPPDATA 'opencua'
$repo = if ($env:OPENCUA_REPO) { $env:OPENCUA_REPO } else { 'https://github.com/trac3r00/opencua.git' }
$ref = if ($env:OPENCUA_REF) { $env:OPENCUA_REF } else { 'main' }
$useExistingCheckout = -not [string]::IsNullOrEmpty($Checkout)
if (-not $useExistingCheckout) { $Checkout = Join-Path $root 'app' }
if (-not (Test-Path $Checkout)) {
	New-Item -ItemType Directory -Force -Path (Split-Path $Checkout) | Out-Null
	& git clone --branch $ref -- $repo $Checkout
	Assert-Exit 'Repository clone'
} elseif (-not (Test-Path (Join-Path $Checkout 'scripts/setup.sh'))) {
	throw "$Checkout is not an OpenCUA checkout; it was left untouched."
} elseif (-not $useExistingCheckout) {
	& git -C $Checkout status --porcelain
	Assert-Exit 'Repository inspection'
	$dirty = & git -C $Checkout status --porcelain
	if ($dirty) { throw "$Checkout has local changes; update it manually before rerunning." }
	& git -C $Checkout fetch origin $ref
	Assert-Exit 'Repository fetch'
	& git -C $Checkout merge --ff-only FETCH_HEAD
	Assert-Exit 'Repository update'
}

if (-not $env:OPENCUA_HOME) {
	$current = Join-Path $HOME '.opencua'
	$legacy = Join-Path $HOME '.apple-cua'
	$env:OPENCUA_HOME = if (-not (Test-Path $current) -and (Test-Path $legacy)) { $legacy } else { $current }
}
if (-not $env:OPENCUA_BIN_DIR) { $env:OPENCUA_BIN_DIR = Join-Path $root 'bin' }
$version = ((Get-Content (Join-Path $Checkout 'package.json') -Raw | ConvertFrom-Json).packageManager -split '@')[1]

function Invoke-Pnpm {
	if (Get-Command corepack -ErrorAction SilentlyContinue) {
		& corepack "pnpm@$version" @args
	} else {
		& npx --yes "pnpm@$version" @args
	}
	Assert-Exit "pnpm $args"
}

Push-Location $Checkout
try {
	Invoke-Pnpm install --frozen-lockfile
	Invoke-Pnpm --filter '@opencua/core' run build:ts
	Invoke-Pnpm --filter '@opencua/mcp' --filter '@opencua/cli' --filter '@opencua/pi-extension' --filter '@opencua/agent' --filter '@opencua/browser' run build
} finally {
	Pop-Location
}

$node = (Get-Command node).Source
$cli = Join-Path $Checkout 'packages/cli/dist/cli.js'
New-Item -ItemType Directory -Force -Path $env:OPENCUA_BIN_DIR | Out-Null
foreach ($name in @('opencua', 'apple-cua')) {
	$launcher = Join-Path $env:OPENCUA_BIN_DIR "$name.cmd"
	if (Test-Path $launcher) {
		$lines = Get-Content $launcher
		if ($lines.Count -lt 2 -or $lines[1] -notmatch '^rem (opencua|apple-cua)-launcher checkout=') {
			Write-Warning "$launcher is foreign; left it untouched."
			continue
		}
	}
	# Quote cmd metacharacters through SET's quoted assignment syntax and escape literal percent signs.
	$cmdNode = $node.Replace('%', '%%')
	$cmdCli = $cli.Replace('%', '%%')
	$cmdHome = $env:OPENCUA_HOME.Replace('%', '%%')
	$cmdBin = $env:OPENCUA_BIN_DIR.Replace('%', '%%')
	$content = @(
		'@echo off',
		"rem opencua-launcher checkout=$Checkout",
		'chcp 65001 >nul',
		'if not defined OPENCUA_HOME if defined APPLE_CUA_HOME set "OPENCUA_HOME=%APPLE_CUA_HOME%"',
		'if not defined OPENCUA_BIN_DIR if defined APPLE_CUA_BIN_DIR set "OPENCUA_BIN_DIR=%APPLE_CUA_BIN_DIR%"',
		"if not defined OPENCUA_HOME set `"OPENCUA_HOME=$cmdHome`"",
		"if not defined OPENCUA_BIN_DIR set `"OPENCUA_BIN_DIR=$cmdBin`"",
		"`"$cmdNode`" `"$cmdCli`" %*"
	)
	[System.IO.File]::WriteAllLines($launcher, $content, [System.Text.UTF8Encoding]::new($false))
}
$userPath = [string][Environment]::GetEnvironmentVariable('Path', 'User')
if (($userPath -split ';') -notcontains $env:OPENCUA_BIN_DIR) {
	[Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ';' + $env:OPENCUA_BIN_DIR), 'User')
}
$env:Path = "$env:OPENCUA_BIN_DIR;$env:Path"
New-Item -ItemType Directory -Force -Path $env:OPENCUA_HOME | Out-Null
if (-not $useExistingCheckout) {
	@{ checkout = $Checkout; repo = $repo; ref = $ref } | ConvertTo-Json |
		Set-Content -Path (Join-Path $env:OPENCUA_HOME 'install.json') -Encoding UTF8
}
if ($Register.Count -eq 0) {
	$detected = & $node $cli --json config --detect
	Assert-Exit 'MCP client detection'
	$Register = @((($detected -join "`n") | ConvertFrom-Json).detected | ForEach-Object { $_.client })
}
if ($Register.Count -gt 0) {
	& $node $cli config --register ($Register -join ',')
} else {
	& $node $cli config --apply
}
Assert-Exit 'MCP registration'
if (-not $NoDoctor) {
	& $node $cli doctor
	Assert-Exit 'OpenCUA doctor'
}
Write-Output "OpenCUA installed in $Checkout. New terminals can run opencua."
