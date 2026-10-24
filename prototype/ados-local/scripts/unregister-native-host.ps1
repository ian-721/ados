[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$hostName = 'org.ados.public_fixture.slice3a'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$expectedManifest = [System.IO.Path]::GetFullPath((Join-Path $repoRoot '.ados-local\slice3a\native-host-manifest.json'))
$expectedLauncher = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'native-host\ados-local-slice3a.cmd'))
$basePath = 'Software\Google\Chrome\NativeMessagingHosts'
$fullPath = "$basePath\$hostName"
$root = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
  [Microsoft.Win32.RegistryHive]::CurrentUser,
  [Microsoft.Win32.RegistryView]::Registry64
)
try {
  $existing = $root.OpenSubKey($fullPath, $false)
  if ($existing) {
    try { $value = [string]$existing.GetValue('') } finally { $existing.Dispose() }
    if ($value -ne $expectedManifest) {
      throw 'BLOCKED_NATIVE_HOST_REGISTRATION:UNREGISTER_PATH_MISMATCH'
    }
    if (-not (Test-Path -LiteralPath $expectedManifest -PathType Leaf)) {
      throw 'BLOCKED_NATIVE_HOST_REGISTRATION:UNREGISTER_MANIFEST_MISSING'
    }
    $parsed = Get-Content -LiteralPath $expectedManifest -Raw | ConvertFrom-Json
    if (
      $parsed.name -ne $hostName -or
      $parsed.path -ne $expectedLauncher -or
      $parsed.type -ne 'stdio' -or
      @($parsed.allowed_origins).Count -ne 1 -or
      @($parsed.allowed_origins)[0] -ne 'chrome-extension://fpmliiakgebgdlgaddocgddllidmkomd/'
    ) {
      throw 'BLOCKED_NATIVE_HOST_REGISTRATION:UNREGISTER_MANIFEST_MISMATCH'
    }
    $root.DeleteSubKeyTree($fullPath, $false)
  }
  $verify = $root.OpenSubKey($fullPath, $false)
  if ($verify) {
    $verify.Dispose()
    throw 'BLOCKED_NATIVE_HOST_REGISTRATION:UNREGISTER_FAILED'
  }
} finally {
  $root.Dispose()
}

[pscustomobject]@{
  status = 'PASS'
  host_name = $hostName
  registry_view = 'Registry64'
  key_present = $false
  unrelated_keys_touched = $false
} | ConvertTo-Json -Depth 3
