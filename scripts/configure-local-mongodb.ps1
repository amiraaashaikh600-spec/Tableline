$ErrorActionPreference = 'Stop'

if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Open PowerShell as Administrator, change to the Tableline project folder, then run this script.'
}

$service = Get-CimInstance Win32_Service -Filter "Name='MongoDB'"
if (-not $service -or $service.State -ne 'Running') {
  throw 'The existing MongoDB Windows service must be installed and running.'
}

$configMatch = [regex]::Match($service.PathName, '--config\s+"([^"]+\.cfg)"|--config\s+([^\s]+\.cfg)')
if (-not $configMatch.Success) {
  throw 'Could not safely identify the MongoDB service config path; no changes were made.'
}
$configPath = if ($configMatch.Groups[1].Success) { $configMatch.Groups[1].Value } else { $configMatch.Groups[2].Value }
$configText = [System.IO.File]::ReadAllText($configPath)
if ($configText -match '(?m)^\s*replSetName:\s*(\S+)') {
  if ($Matches[1] -ne 'rs0') { throw "The MongoDB service already uses replica set $($Matches[1]); no changes were made." }
  Write-Output 'The existing MongoDB config already specifies rs0.'
} else {
  $backupPath = "$configPath.tableline-backup"
  if (Test-Path -LiteralPath $backupPath) { throw "Backup already exists at $backupPath; inspect it before proceeding." }
  Copy-Item -LiteralPath $configPath -Destination $backupPath
  [System.IO.File]::AppendAllText($configPath, [Environment]::NewLine + 'replication:' + [Environment]::NewLine + '  replSetName: rs0' + [Environment]::NewLine)
  try {
    Restart-Service -Name MongoDB
    (Get-Service MongoDB).WaitForStatus('Running', [TimeSpan]::FromSeconds(45))
    Write-Output "Added rs0 to the existing config. Backup: $backupPath"
  } catch {
    Copy-Item -LiteralPath $backupPath -Destination $configPath -Force
    try { Start-Service MongoDB } catch {}
    throw "MongoDB restart failed; the original config was restored. $($_.Exception.Message)"
  }
}

npm.cmd run db:init
if ($LASTEXITCODE -ne 0) { throw 'MongoDB config is set, but rs0 initialization/PRIMARY verification failed. Review the message above and MongoDB service log.' }

npm.cmd run seed
if ($LASTEXITCODE -ne 0) { throw 'MongoDB is PRIMARY, but demo seeding failed. Review the seed output and retry with npm run seed.' }
