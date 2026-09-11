@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$port=8765;if(Test-Path -LiteralPath 'config.local.json'){$configured=(Get-Content -Raw -LiteralPath 'config.local.json'|ConvertFrom-Json).port;if($configured){$port=[int]$configured}};$found=$false;foreach($connection in @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)){$processId=$connection.OwningProcess;$process=Get-CimInstance Win32_Process -Filter ('ProcessId='+$processId);if($process.Name -eq 'node.exe' -and $process.CommandLine -match 'server\.mjs'){Stop-Process -Id $processId;$found=$true}};if($found){Write-Host ('worklog_manager stopped (port '+$port+')')}else{Write-Host ('worklog_manager is not running (port '+$port+')')}"
endlocal
