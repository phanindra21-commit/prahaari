# Generates one WAV narration file per scene using Windows' built-in voices.
# Run in PowerShell:  powershell -ExecutionPolicy Bypass -File docs\demo\make-voiceover.ps1
Add-Type -AssemblyName System.Speech
$out = Join-Path $PSScriptRoot "voiceover"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$scenes = Get-Content (Join-Path $PSScriptRoot "narration.txt") -Raw -Encoding UTF8
$blocks = $scenes -split "(?m)^---\s*$" | Where-Object { $_.Trim() -ne "" }
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
Write-Host "Voices:" ($s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name })
$s.Rate = -1   # slightly slower than default; range -10..10
$i = 1
foreach ($b in $blocks) {
  $file = Join-Path $out ("scene{0:D2}.wav" -f $i)
  $s.SetOutputToWaveFile($file)
  $s.Speak($b.Trim())
  $s.SetOutputToNull()
  Write-Host "Wrote $file"
  $i++
}
$s.Dispose()
Write-Host "Done. Import the WAVs into Clipchamp or CapCut, one per scene, over your screen recording."
