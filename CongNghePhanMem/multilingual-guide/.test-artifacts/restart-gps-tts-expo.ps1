$ErrorActionPreference = 'Stop'
$taskWorkspace = 'C:\CongNghePhanMem\multilingual-guide'
$taskCli = Join-Path $taskWorkspace 'node_modules\expo\bin\cli'
$taskListeners = @(Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($taskPid in $taskListeners) {
  $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$taskPid"
  $taskMatches = [regex]::Matches([string]$taskProcess.CommandLine, '"([^\"]*expo\\bin\\cli)"')
  $taskOwned = $taskProcess.CommandLine -and $taskProcess.CommandLine.IndexOf($taskCli, [StringComparison]::OrdinalIgnoreCase) -ge 0
  foreach ($taskMatch in $taskMatches) { if ([IO.Path]::GetFullPath($taskMatch.Groups[1].Value) -eq [IO.Path]::GetFullPath($taskCli)) { $taskOwned = $true } }
  if ($taskProcess.Name -ne 'node.exe' -or !$taskOwned) {
    throw "Port 8081 belongs to another process; it was not stopped."
  }
  Stop-Process -Id $taskPid -Force
}
for ($taskAttempt = 0; $taskAttempt -lt 20; $taskAttempt++) {
  if (!(Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 250
}
if (Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 8081 did not become free.' }
$env:BROWSER = 'none'
$env:EXPO_OFFLINE = '1'
$env:EXPO_NO_TELEMETRY = '1'
Remove-Item Env:CI -ErrorAction SilentlyContinue
$taskNode = (Get-Command node.exe).Source
$taskNew = Start-Process -FilePath $taskNode -ArgumentList @($taskCli, 'start', '--clear', '--web', '--localhost', '--port', '8081') -WorkingDirectory $taskWorkspace -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskWorkspace '.test-artifacts\gps-tts-expo.log') -RedirectStandardError (Join-Path $taskWorkspace '.test-artifacts\gps-tts-expo.err.log') -PassThru
Write-Output "Restarted workspace Expo PID $($taskNew.Id) on localhost:8081."
