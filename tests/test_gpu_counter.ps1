$procJob = Start-Job -ScriptBlock {
    & "c:\App\Electron\PDF_Translator\.venv-ocr\Scripts\python.exe" -c "
import onnxruntime as ort, numpy as np, time
det_path = r'C:\Users\auand\.paddleocr\whl\det\ch\ch_PP-OCRv4_det_infer\model.onnx'
sess = ort.InferenceSession(det_path, providers=['DmlExecutionProvider', 'CPUExecutionProvider'])
dummy = np.zeros((1, 3, 960, 960), dtype=np.float32)
time.sleep(0.5)
for i in range(100):
    sess.run(None, {'x': dummy})
"
}

Start-Sleep -Milliseconds 600
$pyProcs = Get-Process -Name python -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending
$pidNum = $pyProcs[0].Id
Write-Host "Monitoring Python PID: $pidNum"

$samples = @()
while ((Get-Job -Id $procJob.Id).State -eq 'Running') {
    $now = (Get-Date -Format 'HH:mm:ss.fff')
    try {
        $pattern = "\GPU Engine(*pid_" + $pidNum + "*engtype_Compute*)\Utilization Percentage"
        $c = Get-Counter -Counter $pattern -ErrorAction SilentlyContinue
        if ($c) {
            $vals = $c.CounterSamples | ForEach-Object { $_.CookedValue }
            $maxV = ($vals | Measure-Object -Maximum).Maximum
            $samples += [PSCustomObject]@{
                Timestamp = $now
                Pid = $pidNum
                ComputeUtilization = [math]::Round($maxV, 2)
            }
        }
    } catch {}
    Start-Sleep -Milliseconds 100
}

Receive-Job -Job $procJob | Out-Null
Remove-Job -Job $procJob

Write-Host "`n=== GPU ENGINE COMPUTE UTILIZATION SAMPLES ==="
$samples | Format-Table -AutoSize
