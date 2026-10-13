param(
  [Parameter(Mandatory=$true)][string]$ImagePath,
  [Parameter(Mandatory=$true)][string]$OutputPath
)

Add-Type -AssemblyName System.Runtime.WindowsRuntime

function Await-WinRt($operation, [Type]$resultType) {
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } |
    Where-Object { $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*' } |
    Select-Object -First 1
  if (-not $asTask) { throw 'AsTask method unavailable' }
  $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.Wait()
  return $task.Result
}

$storageFile = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
$stream = Await-WinRt ($storageFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

$language = [System.Globalization.CultureInfo]::GetCultureInfo('zh-CN')
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if (-not $engine) { throw 'Windows OCR engine unavailable' }
$result = Await-WinRt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

$lines = @()
foreach ($line in $result.Lines) {
  $words = @()
  foreach ($word in $line.Words) {
    $r = $word.BoundingRect
    $words += [pscustomobject]@{ text=$word.Text; x=[math]::Round($r.X,2); y=[math]::Round($r.Y,2); width=[math]::Round($r.Width,2); height=[math]::Round($r.Height,2) }
  }
  $rect = $line.Words | ForEach-Object { $_.BoundingRect } | ForEach-Object {
    [pscustomobject]@{ left=$_.X; top=$_.Y; right=($_.X+$_.Width); bottom=($_.Y+$_.Height) }
  }
  if ($rect) {
    $left = ($rect | Measure-Object left -Minimum).Minimum
    $top = ($rect | Measure-Object top -Minimum).Minimum
    $right = ($rect | Measure-Object right -Maximum).Maximum
    $bottom = ($rect | Measure-Object bottom -Maximum).Maximum
    $lines += [pscustomobject]@{ text=$line.Text; x=[math]::Round($left,2); y=[math]::Round($top,2); width=[math]::Round(($right-$left),2); height=[math]::Round(($bottom-$top),2); words=$words }
  }
}

[pscustomobject]@{ text=$result.Text; lines=$lines } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
Write-Output $OutputPath
