param([Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$')][string]$RunId)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
$RunId = $RunId.ToLowerInvariant()
$started = [DateTime]::UtcNow
$clock = [Diagnostics.Stopwatch]::StartNew()
$stage = 'ENVIRONMENT'
$installer = 'C:\G1Input\Element Setup 1.12.30.exe'
$config = 'C:\G1Input\element-config.json'
$installRoot = Join-Path $env:LOCALAPPDATA 'element-desktop'
$exe = Join-Path $installRoot 'app-1.12.30\Element.exe'
$result = [ordered]@{
  schema='g1-install-v1'; runId=$RunId; status='FAIL'; stage=$stage
  stages=[ordered]@{ ENVIRONMENT='NOT_RUN'; INSTALL='NOT_RUN'; WELCOME='NOT_RUN'; QUIT='NOT_RUN' }
}
function Write-JsonNew([string]$name, $value) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($value | ConvertTo-Json -Depth 8 -Compress))
  $final = 'C:\G1Output\' + $name
  $staging = 'C:\G1Output\staging-' + [Guid]::NewGuid().ToString('D') + '-' + $name
  $file = [IO.File]::Open($staging, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $file.Write($bytes, 0, $bytes.Length); $file.Flush() } finally { $file.Dispose() }
  # Same-directory Move publishes only a closed complete JSON; it never replaces a final file.
  # If publication fails, retain the staging JSON and every previous final as evidence.
  [IO.File]::Move($staging, $final)
}
function Check-Time([long]$limit) {
  if ($clock.ElapsedMilliseconds -ge $limit) { throw ('TIMEOUT/' + $script:stage) }
}
function Start-Stage([string]$name) {
  $script:stage = $name
  $result.stage = $name
  Write-JsonNew ('stage-' + $name + '-started.json') @{ runId=$RunId; stage=$name; elapsedMs=$clock.ElapsedMilliseconds }
}
function Finish-Stage {
  $result.stages[$script:stage] = 'PASS'
  Write-JsonNew ('stage-' + $script:stage + '-passed.json') @{ runId=$RunId; stage=$script:stage; status='PASS'; elapsedMs=$clock.ElapsedMilliseconds }
}
function Read-Version {
  $item = Get-Item -LiteralPath $exe
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPARSE/Element.exe' }
  $product = [string]$item.VersionInfo.ProductVersion
  if ($product -notmatch '^1\.12\.30(\.0)?$') { throw 'VERSION/ProductVersion' }
  $records = @(Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction Stop |
    ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath } |
    Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -eq 'Element' })
  if ($records.Count -ne 1 -or [string]$records[0].DisplayVersion -ne '1.12.30') { throw 'VERSION/DisplayVersion' }
  if ($records[0].PSObject.Properties['InstallLocation'] -and $records[0].InstallLocation -and
    [IO.Path]::GetFullPath([string]$records[0].InstallLocation).TrimEnd('\') -ine $installRoot.TrimEnd('\')) { throw 'VERSION/InstallLocation' }
  return @{ productVersion=$product; displayVersion=[string]$records[0].DisplayVersion }
}
function Owned-Processes {
  # Sandbox can deny WMI/CIM queries; read the actual local process identity directly.
  $items = @([Diagnostics.Process]::GetProcessesByName('Element')) + @([Diagnostics.Process]::GetProcessesByName('Update'))
  $owned = @()
  try {
    foreach ($item in $items) {
      try {
        $module = $item.MainModule
        if ($null -eq $module -or [string]::IsNullOrEmpty($module.FileName)) { throw 'OWNERSHIP/Unreadable process' }
        $full = [IO.Path]::GetFullPath($module.FileName)
        $created = $item.StartTime.ToUniversalTime()
        if (-not $full.StartsWith(($installRoot.TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase) -or
          $created -lt $started) { throw 'OWNERSHIP/Unexpected Element or Update process' }
        $owned += [pscustomobject]@{ Name=($item.ProcessName + '.exe'); ProcessId=$item.Id; ExecutablePath=$full; CreationDate=$created }
      } catch {
        # An exited snapshot member is harmless; a live unreadable process still fails closed.
        if ($item.HasExited) { continue }
        throw
      }
    }
  } finally { foreach ($item in $items) { $item.Dispose() } }
  return $owned
}
function Main-Window($process) {
  $process.Refresh()
  $handle = $process.MainWindowHandle
  if ($handle -eq [IntPtr]::Zero) { return $null }
  $owner = [uint32]0
  [void][G1Window]::GetWindowThreadProcessId($handle, [ref]$owner)
  if ($owner -ne $process.Id) { throw 'OWNERSHIP/Window PID mismatch' }
  return [Windows.Automation.AutomationElement]::FromHandle($handle)
}
function Find-Control($root, [string]$name, $type) {
  $condition = [Windows.Automation.AndCondition]::new(
    [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, $name),
    [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty, $type))
  return $root.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
}
function Find-FileControl($root) {
  $barCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::MenuBar)
  $bar = $root.FindFirst([Windows.Automation.TreeScope]::Descendants, $barCondition)
  if ($null -eq $bar) { return $null }
  # Chromium exposes its native menu-bar entries as Buttons on this pinned build.
  foreach ($type in @([Windows.Automation.ControlType]::MenuItem, [Windows.Automation.ControlType]::Button)) {
    $control = Find-Control $bar 'File' $type
    if ($null -ne $control -and $control.Current.IsEnabled -and -not $control.Current.IsOffscreen) { return $control }
  }
  return $null
}
function Find-QuitAction($process) {
  $menuCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Menu)
  # Chromium may report UIA PID 0 even on its native root. Verify HWND ownership
  # before inspecting any menu, including a separate native popup.
  $roots = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition)
  foreach ($root in $roots) {
    $handle = [IntPtr]$root.Current.NativeWindowHandle
    if ($handle -eq [IntPtr]::Zero) { continue }
    $owner = [uint32]0
    [void][G1Window]::GetWindowThreadProcessId($handle, [ref]$owner)
    if ($owner -ne $process.Id) { continue }
    foreach ($menu in $root.FindAll([Windows.Automation.TreeScope]::Descendants, $menuCondition)) {
      foreach ($name in @('Quit', 'Exit')) {
        $candidate = Find-Control $menu $name ([Windows.Automation.ControlType]::MenuItem)
        if ($null -ne $candidate -and $candidate.Current.IsEnabled -and -not $candidate.Current.IsOffscreen) {
          return @{control=$candidate;action=('File/' + $name)}
        }
      }
    }
  }
  return $null
}
function Quit-ThroughMenu($process, [long]$limit) {
  Check-Time $limit
  $root = Main-Window $process
  if ($null -eq $root) { throw 'QUIT/No owned main window' }
  $file = Find-FileControl $root
  if ($null -eq $file) {
    Check-Time $limit
    # The pinned client hides its menu bar by default. One Alt stroke reveals it.
    [G1Window]::RevealMenu($process.MainWindowHandle, [int]$process.Id)
    while ($null -eq $file) {
      Check-Time $limit
      Start-Sleep -Milliseconds 100
      Check-Time $limit
      $root = Main-Window $process
      if ($null -eq $root) { throw 'QUIT/No owned main window' }
      $file = Find-FileControl $root
    }
  }
  $expand = $null
  $invoke = $null
  if ($file.Current.ControlType -eq [Windows.Automation.ControlType]::Button) {
    # The pinned SubmenuButton exposes no Invoke, and its Expand returns E_FAIL.
    # Focus the observed File control before sending its standard menu-opening key.
    $file.SetFocus()
    if (-not $file.Current.HasKeyboardFocus) { throw 'QUIT/File not focused' }
    Check-Time $limit
    [G1Window]::OpenFileMenu($process.MainWindowHandle, [int]$process.Id)
  }
  elseif ($file.TryGetCurrentPattern([Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$expand)) { $expand.Expand() }
  elseif ($file.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) { $invoke.Invoke() }
  else { throw 'UIA_UNSUPPORTED/File menu cannot open' }
  $quit = $null
  $action = $null
  while ($null -eq $quit) {
    Check-Time $limit
    $selection = Find-QuitAction $process
    if ($null -ne $selection) { $quit=$selection.control; $action=$selection.action }
    else { Start-Sleep -Milliseconds 100 }
  }
  $pattern = $null
  if (-not $quit.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { throw 'UIA_UNSUPPORTED/Quit cannot invoke' }
  Check-Time $limit
  $pattern.Invoke()
  while (-not $process.HasExited) { Check-Time $limit; Start-Sleep -Milliseconds 100; $process.Refresh() }
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw ('QUIT/ExitCode/' + $process.ExitCode) }
  while (@(Owned-Processes).Count -ne 0) { Check-Time $limit; Start-Sleep -Milliseconds 100 }
  return $action
}
function Save-OwnedWindow($process) {
  $process.Refresh()
  $handle = $process.MainWindowHandle
  $owner = [uint32]0
  [void][G1Window]::GetWindowThreadProcessId($handle, [ref]$owner)
  if ($owner -ne $process.Id -or $handle -eq [IntPtr]::Zero) { throw 'SCREENSHOT/Unowned window' }
  [void][G1Window]::SetForegroundWindow($handle)
  Start-Sleep -Milliseconds 200
  if ([G1Window]::GetForegroundWindow() -ne $handle) { throw 'SCREENSHOT/Window not foreground' }
  $rect = [G1Window+RECT]::new()
  if (-not [G1Window]::GetWindowRect($handle, [ref]$rect)) { throw 'SCREENSHOT/No rectangle' }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -lt 300 -or $height -lt 200 -or $width -gt 4096 -or $height -gt 4096) { throw 'SCREENSHOT/Invalid rectangle' }
  $bitmap = [Drawing.Bitmap]::new($width, $height)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, [Drawing.Size]::new($width, $height))
    $colors = @{}
    for ($x=0; $x -lt $width; $x += [Math]::Max(1,[int]($width/32))) {
      for ($y=0; $y -lt $height; $y += [Math]::Max(1,[int]($height/32))) { $colors[$bitmap.GetPixel($x,$y).ToArgb()]=$true }
    }
    if ($colors.Count -lt 8) { throw 'SCREENSHOT/Black or uniform image' }
    $file = [IO.File]::Open('C:\G1Output\welcome.png', [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $bitmap.Save($file, [Drawing.Imaging.ImageFormat]::Png) } finally { $file.Dispose() }
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
  return (Get-FileHash -LiteralPath 'C:\G1Output\welcome.png' -Algorithm SHA256).Hash.ToLowerInvariant()
}

try {
  Start-Stage 'ENVIRONMENT'
  if ($env:USERNAME -ne 'WDAGUtilityAccount' -or -not [Environment]::Is64BitOperatingSystem -or -not [Environment]::Is64BitProcess -or
    -not (Test-Path -LiteralPath 'C:\G1Input' -PathType Container) -or -not (Test-Path -LiteralPath 'C:\G1Output' -PathType Container)) { throw 'ENVIRONMENT/Expected fresh x64 Windows Sandbox' }
  if (@(Get-Command node.exe,npm.cmd,npx.cmd -CommandType Application -ErrorAction SilentlyContinue).Count -ne 0) { throw 'ENVIRONMENT/Development tools present' }
  if ((Test-Path -LiteralPath $installRoot) -or (Test-Path -LiteralPath 'C:\G1Profile') -or @(Owned-Processes).Count -ne 0) { throw 'ENVIRONMENT/Not fresh' }
  $names = @(Get-ChildItem -LiteralPath 'C:\G1Input' | ForEach-Object { $_.Name } | Sort-Object)
  if ($names.Count -ne 3 -or -not ($names -ccontains 'Element Setup 1.12.30.exe') -or
    -not ($names -ccontains 'element-config.json') -or -not ($names -ccontains 'guest.ps1')) { throw 'INPUT/Unexpected files' }
  $installerItem = Get-Item -LiteralPath $installer
  $hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($installerItem.Length -ne 208730288 -or $hash -ne 'b9ac9617acfa667eb5470e67e5db744d3b595b35c285100a53ad17719f7cc6d3') { throw 'INPUT/Installer hash' }
  $result.installerSha256=$hash
  $result.configSha256=(Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash.ToLowerInvariant()
  $configBytes = [IO.File]::ReadAllBytes($config)
  $defaultProfile = Join-Path $env:APPDATA 'Element'
  [void][IO.Directory]::CreateDirectory($defaultProfile)
  [void][IO.Directory]::CreateDirectory('C:\G1Profile')
  foreach ($target in @((Join-Path $defaultProfile 'config.json'), 'C:\G1Profile\config.json')) {
    $file = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $file.Write($configBytes,0,$configBytes.Length) } finally { $file.Dispose() }
  }
  $result.defaultProfileSeeded=$true
  $result.controlledProfileSeeded=$true
  $result.environment='Windows Sandbox'
  $result.architecture='x64'
  $result.developmentToolsAbsent=$true
  Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Drawing
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class G1Window {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  // The guest is required to be x64: native INPUT is 40 bytes, with keyboard data at offset 8.
  [StructLayout(LayoutKind.Explicit, Size=40)] public struct INPUT {
    [FieldOffset(0)] public uint type;
    [FieldOffset(8)] public ushort key;
    [FieldOffset(12)] public uint flags;
  }
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
  public static void RevealMenu(IntPtr handle, int processId) { SendOwnedKey(handle, processId, 0x12, true); }
  public static void OpenFileMenu(IntPtr handle, int processId) { SendOwnedKey(handle, processId, 0x28, false); }
  private static void SendOwnedKey(IntPtr handle, int processId, ushort key, bool activate) {
    uint owner;
    GetWindowThreadProcessId(handle, out owner);
    if (handle == IntPtr.Zero || owner != processId) throw new InvalidOperationException("QUIT/Unowned window");
    if (activate) SetForegroundWindow(handle);
    if (GetForegroundWindow() != handle) throw new InvalidOperationException("QUIT/Window not foreground");
    INPUT[] keys = { new INPUT { type=1, key=key }, new INPUT { type=1, key=key, flags=2 } };
    int size = Marshal.SizeOf(typeof(INPUT));
    uint sent = SendInput(2, keys, size);
    if (sent != 2) {
      int error = Marshal.GetLastWin32Error();
      if (sent == 1) SendInput(1, new INPUT[] { keys[1] }, size);
      throw new System.ComponentModel.Win32Exception(error, "QUIT/Menu key input failed");
    }
    if (GetForegroundWindow() != handle) throw new InvalidOperationException("QUIT/Window lost foreground");
  }
}
'@
  Finish-Stage
  Start-Stage 'INSTALL'
  $installLimit = $clock.ElapsedMilliseconds + 120000
  $setup = Start-Process -FilePath $installer -ArgumentList '--silent' -PassThru
  # Bootstrap exit 0 is only one piece; wait for installed application/registry convergence.
  while ($true) {
    Check-Time $installLimit
    if (@(Get-Process consent -ErrorAction SilentlyContinue).Count -ne 0) { throw 'INSTALL/Unexpected UAC' }
    $setup.Refresh()
    if (-not $setup.HasExited -and $setup.MainWindowHandle -ne [IntPtr]::Zero) { throw 'INSTALL/Unexpected installer interaction' }
    $version = $null
    if ($setup.HasExited) {
      $setup.WaitForExit()
      if ($setup.ExitCode -ne 0) { throw ('INSTALL/ExitCode/' + $setup.ExitCode) }
      if (Test-Path -LiteralPath $exe -PathType Leaf) {
        try { $version=Read-Version } catch { $version=$null }
      }
    }
    if ($null -ne $version) { break }
    Start-Sleep -Milliseconds 200
  }
  # Hooks can de-elevate/relaunch via Explorer; do not depend on inherited environment.
  $earlyLimit = [Math]::Min($installLimit, $clock.ElapsedMilliseconds + 15000)
  $quietSince = $null
  while ($true) {
    Check-Time $installLimit
    $owned = @(Owned-Processes)
    $element = @($owned | Where-Object { $_.Name -ieq 'Element.exe' })
    $main = $null
    foreach ($item in $element) {
      $candidate=[Diagnostics.Process]::GetProcessById([int]$item.ProcessId)
      if ($null -ne (Main-Window $candidate)) { $main=$candidate; break }
    }
    if ($null -ne $main) { [void](Quit-ThroughMenu $main $earlyLimit); $quietSince=$null }
    elseif ($owned.Count -eq 0) {
      if ($null -eq $quietSince) { $quietSince=$clock.ElapsedMilliseconds }
      if ($clock.ElapsedMilliseconds - $quietSince -ge 1500) { break }
    } else { $quietSince=$null }
    Check-Time $earlyLimit
    Start-Sleep -Milliseconds 100
  }
  $result.earlyProcessesGone=$true
  $result.installExitCode=$setup.ExitCode
  $result.productVersion=$version.productVersion
  $result.displayVersion=$version.displayVersion
  Finish-Stage
  Start-Stage 'WELCOME'
  $welcomeLimit=$clock.ElapsedMilliseconds + 60000
  $env:ELEMENT_DESKTOP_CONFIG_JSON=$config
  $app=Start-Process -FilePath $exe -ArgumentList @('--no-update','--profile-dir','C:\G1Profile','--config',$config) -PassThru
  $result.controlledLaunch=$true
  $controls=$null
  while ($true) {
    Check-Time $welcomeLimit
    [void](Owned-Processes)
    if ($app.HasExited) { throw 'WELCOME/Application exited' }
    $root=Main-Window $app
    if ($null -ne $root) {
      $all=$root.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
      $names=@()
      for ($i=0; $i -lt $all.Count; $i++) {
        $item=$all.Item($i)
        if (-not $item.Current.IsOffscreen -and $item.Current.IsEnabled) {
          $name=[string]$item.Current.Name
          if ($name -match '^(Be in your element|Sign in|Create account)$') { $names += $name }
        }
      }
      if (($names -contains 'Be in your element') -and ($names -contains 'Sign in') -and ($names -contains 'Create account')) { $controls=@($names | Select-Object -Unique); break }
    }
    Start-Sleep -Milliseconds 200
  }
  $result.controls=$controls
  $result.welcomeObserved=$true
  $result.ownedWindow=$true
  $result.screenshot='welcome.png'
  $result.screenshotSha256=Save-OwnedWindow $app
  Check-Time $welcomeLimit
  Write-JsonNew 'welcome-controls.json' @{ runId=$RunId; processId=$app.Id; controls=$controls; screenshot='welcome.png'; screenshotSha256=$result.screenshotSha256 }
  Finish-Stage
  Start-Stage 'QUIT'
  $quitLimit=$clock.ElapsedMilliseconds + 15000
  $result.quitAction=Quit-ThroughMenu $app $quitLimit
  $result.mainExitCode=$app.ExitCode
  $result.ownedProcessesGone=$true
  $finalVersion=Read-Version
  $result.finalProductVersion=$finalVersion.productVersion
  $result.finalDisplayVersion=$finalVersion.displayVersion
  Check-Time $quitLimit
  Finish-Stage
  $result.status='PASS'
} catch {
  $result.status='FAIL'
  $result.stage=$stage
  $result.stages[$stage]='FAIL'
  $result.category=([string]$_.Exception.Message).Split('/')[0]
  $result.error=([string]$_.Exception.Message -replace '(?i)(Bearer\s+)\S+','$1[REDACTED]' -replace '(?i)((token|password|secret)\s*[=:]\s*)[^\s,;]+','$1[REDACTED]')
  $result.failure=@{ scriptLineNumber=$_.InvocationInfo.ScriptLineNumber; hresult=$_.Exception.HResult; exceptionType=$_.Exception.GetType().FullName }
} finally {
  $result.elapsedMs=$clock.ElapsedMilliseconds
  Write-JsonNew ('guest-' + $RunId + '.json') $result
}
if ($result.status -ne 'PASS') { exit 1 }
exit 0
