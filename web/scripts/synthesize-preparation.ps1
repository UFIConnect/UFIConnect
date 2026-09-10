param([Parameter(Mandatory=$true)][string]$ManifestPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $speaker.SelectVoice('Microsoft Zira Desktop')
  $speaker.Rate = -1
  foreach ($part in (Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json)) {
    $speaker.SetOutputToWaveFile($part.path)
    $speaker.Speak($part.text)
    $speaker.SetOutputToNull()
  }
} finally {
  $speaker.Dispose()
}
