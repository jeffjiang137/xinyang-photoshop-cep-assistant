param([Parameter(Mandatory=$true)][string]$ImagePath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class XinyangBrowserWindow {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr state);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr state);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
try {
  $script:target = [IntPtr]::Zero
  $callback = [XinyangBrowserWindow+EnumProc] {
    param($handle, $state)
    if ([XinyangBrowserWindow]::IsWindowVisible($handle)) {
      [uint32]$browserPid = 0
      [void][XinyangBrowserWindow]::GetWindowThreadProcessId($handle, [ref]$browserPid)
      $process = Get-Process -Id $browserPid -ErrorAction SilentlyContinue
      if ($process -and $process.ProcessName -match '^(chrome|msedge|firefox|brave|opera|vivaldi)$') {
        $script:target = $handle
        return $false
      }
    }
    return $true
  }
  [void][XinyangBrowserWindow]::EnumWindows($callback, [IntPtr]::Zero)
  if ($script:target -eq [IntPtr]::Zero) { throw 'No supported browser window is open.' }
  $image = [System.Drawing.Image]::FromFile($ImagePath)
  try { [System.Windows.Forms.Clipboard]::SetImage($image) } finally { $image.Dispose() }
  [void][XinyangBrowserWindow]::SetForegroundWindow($script:target)
  Start-Sleep -Milliseconds 450
  if ([XinyangBrowserWindow]::GetForegroundWindow() -ne $script:target) { throw 'Browser focus failed; image remains in clipboard.' }
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Write-Output 'PASTE_SENT'
} catch {
  Write-Output $_.Exception.Message
  exit 1
}
