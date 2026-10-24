[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$hostName = 'org.ados.public_fixture.slice3a'
$extensionOrigin = 'chrome-extension://fpmliiakgebgdlgaddocgddllidmkomd/'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$launcher = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'native-host\ados-local-slice3a.cmd'))
$entryPoint = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'dist\src\native\host.js'))
$manifestDirectory = [System.IO.Path]::GetFullPath((Join-Path $repoRoot '.ados-local\slice3a'))
$manifestPath = [System.IO.Path]::GetFullPath((Join-Path $manifestDirectory 'native-host-manifest.json'))

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'BLOCKED_NATIVE_HOST_REGISTRATION:ELEVATED_PROCESS'
}
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
  throw 'BLOCKED_NATIVE_HOST_REGISTRATION:LAUNCHER_MISSING'
}
if (-not (Test-Path -LiteralPath $entryPoint -PathType Leaf)) {
  throw 'BLOCKED_NATIVE_HOST_REGISTRATION:BUILD_MISSING'
}
$nodeVersion = (& node --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -ne 'v22.23.1') {
  throw 'BLOCKED_NATIVE_HOST_REGISTRATION:NODE_IDENTITY'
}

# This public fixture has a versioned, fixed installation identity. Loading the
# checked-in expected bytes does not trust the currently installed registration.
$expectedManifestPath = Join-Path $repoRoot 'fixtures\public-native-host-manifest.json'
$manifestJson = [System.IO.File]::ReadAllText($expectedManifestPath)
$manifest = $manifestJson | ConvertFrom-Json
if ($manifest.path -cne $launcher -or $manifest.name -cne $hostName -or
    @($manifest.allowed_origins).Count -ne 1 -or @($manifest.allowed_origins)[0] -cne $extensionOrigin) {
  throw 'BLOCKED_NATIVE_HOST_REGISTRATION:PUBLIC_FIXTURE_LAYOUT_MISMATCH'
}

function Test-ExpectedManifest([string]$path) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $false }
  try { $parsed = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json } catch { return $false }
  return (
    $parsed.name -eq $hostName -and
    $parsed.path -eq $launcher -and
    $parsed.type -eq 'stdio' -and
    @($parsed.allowed_origins).Count -eq 1 -and
    @($parsed.allowed_origins)[0] -eq $extensionOrigin
  )
}

$basePath = 'Software\Google\Chrome\NativeMessagingHosts'
$fullPath = "$basePath\$hostName"
$root = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
  [Microsoft.Win32.RegistryHive]::CurrentUser,
  [Microsoft.Win32.RegistryView]::Registry64
)
try {
  $existing = $root.OpenSubKey($fullPath, $false)
  if ($existing) {
    try { $existingValue = [string]$existing.GetValue('') } finally { $existing.Dispose() }
    if ($existingValue -ne $manifestPath) {
      throw 'BLOCKED_NATIVE_HOST_REGISTRATION:KEY_COLLISION'
    }
    if (-not (Test-ExpectedManifest $manifestPath)) {
      throw 'BLOCKED_NATIVE_HOST_REGISTRATION:MANIFEST_COLLISION'
    }
  } else {
    if (Test-Path -LiteralPath $manifestPath) {
      if (-not (Test-ExpectedManifest $manifestPath)) {
        throw 'BLOCKED_NATIVE_HOST_REGISTRATION:MANIFEST_COLLISION'
      }
    } else {
      New-Item -ItemType Directory -Path $manifestDirectory -Force | Out-Null
      [System.IO.File]::WriteAllText($manifestPath, $manifestJson, [System.Text.UTF8Encoding]::new($false))
    }
    $key = $root.CreateSubKey($fullPath, $true)
    if (-not $key) { throw 'BLOCKED_NATIVE_HOST_REGISTRATION:WRITE_FAILED' }
    try { $key.SetValue('', $manifestPath, [Microsoft.Win32.RegistryValueKind]::String) } finally { $key.Dispose() }
  }
  $readbackKey = $root.OpenSubKey($fullPath, $false)
  if (-not $readbackKey) { throw 'BLOCKED_NATIVE_HOST_REGISTRATION:READBACK_MISSING' }
  try { $readback = [string]$readbackKey.GetValue('') } finally { $readbackKey.Dispose() }
  if ($readback -ne $manifestPath) { throw 'BLOCKED_NATIVE_HOST_REGISTRATION:READBACK_MISMATCH' }
} finally {
  $root.Dispose()
}

if (-not (Test-ExpectedManifest $manifestPath)) {
  throw 'BLOCKED_NATIVE_HOST_REGISTRATION:MANIFEST_MISMATCH'
}

[pscustomobject]@{
  status = 'PASS'
  host_name = $hostName
  allowed_origin = $extensionOrigin
  registry_view = 'Registry64'
  manifest_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $manifestPath).Hash.ToLowerInvariant()
  launcher_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $launcher).Hash.ToLowerInvariant()
  path_readback = 'EXACT_LOCAL_PATH'
  administrator = $false
} | ConvertTo-Json -Depth 3
