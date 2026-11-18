param([Parameter(Mandatory=$true)][string]$ImagePath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class XinyangBrowserWindow {
  [DllImport("user32.dll", SetLastError=true)] static extern bool OpenClipboard(IntPtr owner);
  [DllImport("user32.dll")] static extern bool CloseClipboard();
  [DllImport("user32.dll")] static extern bool EmptyClipboard();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern uint RegisterClipboardFormat(string name);
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetClipboardData(uint format, IntPtr memory);
  [DllImport("user32.dll")] static extern bool IsClipboardFormatAvailable(uint format);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalAlloc(uint flags, UIntPtr size);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr memory);
  [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr memory);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalFree(IntPtr memory);
  public static void PutPng(byte[] bytes) {
    uint format = RegisterClipboardFormat("PNG");
    if (format == 0) throw new Exception("PNG clipboard registration failed.");
    IntPtr memory = GlobalAlloc(0x42, (UIntPtr)bytes.Length);
    if (memory == IntPtr.Zero) throw new Exception("Clipboard allocation failed.");
    bool opened = false;
    try {
      IntPtr pointer = GlobalLock(memory);
      if (pointer == IntPtr.Zero) throw new Exception("Clipboard memory lock failed.");
      try { Marshal.Copy(bytes, 0, pointer, bytes.Length); } finally { GlobalUnlock(memory); }
      for (int i=0; i<10 && !opened; i++) {
        opened = OpenClipboard(GetForegroundWindow());
        if (!opened) System.Threading.Thread.Sleep(100);
      }
      if (!opened) throw new Exception("Clipboard is busy.");
      if (!EmptyClipboard() || SetClipboardData(format, memory) == IntPtr.Zero)
        throw new Exception("PNG clipboard write failed.");
      memory = IntPtr.Zero; // Windows owns the persistent allocation now.
      // CF_DIBV5 lets browsers which do not enumerate registered PNG still
      // recognize an image. Explicit alpha masks retain transparency.
      using (var stream = new System.IO.MemoryStream(bytes))
      using (var image = System.Drawing.Image.FromStream(stream))
      using (var bitmap = new System.Drawing.Bitmap(image.Width, image.Height, System.Drawing.Imaging.PixelFormat.Format32bppArgb)) {
        using (var graphics = System.Drawing.Graphics.FromImage(bitmap)) {
          graphics.CompositingMode = System.Drawing.Drawing2D.CompositingMode.SourceCopy;
          graphics.DrawImage(image, 0, 0, image.Width, image.Height);
        }
        int stride = checked(bitmap.Width * 4);
        byte[] dib = new byte[checked(124 + stride * bitmap.Height)];
        using (var writer = new System.IO.BinaryWriter(new System.IO.MemoryStream(dib))) {
          writer.Write(124); writer.Write(bitmap.Width); writer.Write(-bitmap.Height);
          writer.Write((short)1); writer.Write((short)32); writer.Write(3);
          writer.Write(stride * bitmap.Height);
          writer.BaseStream.Position = 40;
          writer.Write(0x00ff0000); writer.Write(0x0000ff00); writer.Write(0x000000ff); writer.Write(unchecked((int)0xff000000));
          writer.Write(0x73524742); // LCS_sRGB
          writer.BaseStream.Position = 108; writer.Write(4); // LCS_GM_IMAGES
        }
        var data = bitmap.LockBits(new System.Drawing.Rectangle(0,0,bitmap.Width,bitmap.Height), System.Drawing.Imaging.ImageLockMode.ReadOnly, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        try {
          for (int row=0; row<bitmap.Height; row++)
            Marshal.Copy(IntPtr.Add(data.Scan0, row * data.Stride), dib, 124 + row * stride, stride);
        } finally { bitmap.UnlockBits(data); }
        IntPtr dibMemory = GlobalAlloc(0x42, (UIntPtr)dib.Length);
        if (dibMemory == IntPtr.Zero) throw new Exception("DIBV5 allocation failed.");
        try {
          IntPtr dibPointer = GlobalLock(dibMemory);
          if (dibPointer == IntPtr.Zero) throw new Exception("DIBV5 lock failed.");
          try { Marshal.Copy(dib,0,dibPointer,dib.Length); } finally { GlobalUnlock(dibMemory); }
          if (SetClipboardData(17, dibMemory) == IntPtr.Zero) throw new Exception("DIBV5 clipboard write failed.");
          dibMemory = IntPtr.Zero;
        } finally { if (dibMemory != IntPtr.Zero) GlobalFree(dibMemory); }
      }
      if (!IsClipboardFormatAvailable(format)) throw new Exception("PNG clipboard verification failed.");
    } finally {
      if (opened) CloseClipboard();
      if (memory != IntPtr.Zero) GlobalFree(memory);
    }
  }
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
  # SetImage exposes a Windows bitmap, which can lose alpha when browsers
  # convert it. Publish the original PNG bytes instead, without a bitmap
  # fallback that could be preferred and flattened by the receiving app.
  $pngBytes = [System.IO.File]::ReadAllBytes($ImagePath)
  [XinyangBrowserWindow]::PutPng($pngBytes)
  [void][XinyangBrowserWindow]::SetForegroundWindow($script:target)
  Start-Sleep -Milliseconds 450
  if ([XinyangBrowserWindow]::GetForegroundWindow() -ne $script:target) { throw 'Browser focus failed; image remains in clipboard.' }
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Write-Output 'PASTE_SENT'
} catch {
  Write-Output $_.Exception.Message
  exit 1
}
