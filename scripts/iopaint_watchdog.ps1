param(
  [Parameter(Mandatory=$true)][int]$ParentPid,
  [Parameter(Mandatory=$true)][int]$ServicePid
)

while ($true) {
  $parent = Get-Process -Id $ParentPid -ErrorAction SilentlyContinue
  $service = Get-Process -Id $ServicePid -ErrorAction SilentlyContinue
  if (-not $service) { exit 0 }
  if (-not $parent) { break }
  Start-Sleep -Seconds 2
}

try {
  & taskkill.exe /PID $ServicePid /T /F | Out-Null
} catch {
  try { Stop-Process -Id $ServicePid -Force -ErrorAction SilentlyContinue } catch {}
}
