$ErrorActionPreference = 'Stop'
$projectDirectory = $PSScriptRoot
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compilerPath)) { throw '.NET Framework 4.x C# compiler is required.' }
$outputDirectory = Join-Path $projectDirectory 'dist'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$references = @('/r:System.dll','/r:System.Core.dll','/r:System.Drawing.dll','/r:System.Windows.Forms.dll','/r:System.Web.Extensions.dll','/r:System.Net.Http.dll','/r:System.Security.dll','/r:System.ServiceProcess.dll')
$sources = @('Core.cs','WindowsPlatform.cs','Controller.cs','Program.cs') | ForEach-Object { Join-Path $projectDirectory $_ }
& $compilerPath /nologo /target:winexe /platform:x64 /optimize+ /warnaserror+ ("/win32manifest:" + (Join-Path $projectDirectory 'app.manifest')) ("/out:" + (Join-Path $outputDirectory 'UFIConnectVpn.exe')) @references @sources
if ($LASTEXITCODE -ne 0) { throw 'Windows client compilation failed.' }
$clientHash = (Get-FileHash -LiteralPath (Join-Path $outputDirectory 'UFIConnectVpn.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
$hashSource = Join-Path $outputDirectory 'SetupHashes.cs'
[IO.File]::WriteAllText($hashSource, ('namespace UfiConnect.Vpn { internal static class SetupHashes { internal const string ClientHash="' + $clientHash + '"; } }'))
$setupSources = @('Core.cs','WindowsPlatform.cs','SetupProgram.cs') | ForEach-Object { Join-Path $projectDirectory $_ }
& $compilerPath /nologo /target:winexe /platform:x64 /optimize+ /warnaserror+ /main:UfiConnect.Vpn.SetupProgram ("/win32manifest:" + (Join-Path $projectDirectory 'app.manifest')) ("/out:" + (Join-Path $outputDirectory 'UFIConnectVpnSetup.exe')) @references @setupSources $hashSource
if ($LASTEXITCODE -ne 0) { throw 'Windows bootstrap compilation failed.' }
& $compilerPath /nologo /target:exe /platform:x64 /optimize+ /warnaserror+ /main:UfiConnect.Vpn.Tests ("/out:" + (Join-Path $outputDirectory 'UFIConnectVpn.Tests.exe')) @references @sources (Join-Path $projectDirectory 'SetupProgram.cs') $hashSource (Join-Path $projectDirectory 'Tests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Windows tests compilation failed.' }
& (Join-Path $outputDirectory 'UFIConnectVpn.Tests.exe')
if ($LASTEXITCODE -ne 0) { throw 'Windows unit checks failed.' }
Compress-Archive -LiteralPath (Join-Path $outputDirectory 'UFIConnectVpn.exe'),(Join-Path $outputDirectory 'UFIConnectVpnSetup.exe'),(Join-Path $projectDirectory 'README.md') -DestinationPath (Join-Path $outputDirectory 'UFIConnect-VPN-Windows-x64-validation.zip') -Force
Write-Output 'Built UFIConnectVpn.exe. No VPN was installed, started, or changed.'
