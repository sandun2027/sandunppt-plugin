#define MyAppName "SANDUN PPT 开源版"
#define MyAppVersion "2.0.2"
#define MyAppPublisher "SANDUN"
#define MyAppExeName "sandun-open-local.exe"

[Setup]
AppId={{DFB0641B-FA91-4437-9134-BB59480C8C8E}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={code:ExistingInstallDirectory}
UsePreviousAppDir=yes
DefaultGroupName=SANDUN
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\build\installer-engine
OutputBaseFilename=SANDUN-Install-Engine-{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
CloseApplications=no
RestartApplications=no
UninstallDisplayIcon={app}\local\{#MyAppExeName}

[InstallDelete]
Type: files; Name: "{app}\legacy\sandun-compatibility.ppam"

[Files]
Source: "..\..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\NOTICE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\taskpane\public\icon-settings.svg"; DestDir: "{app}\wps"; Flags: ignoreversion
Source: "..\..\licenses\*"; DestDir: "{app}\licenses"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\dist\sandun-open-local\*"; DestDir: "{app}\local"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\dist\native\SANDUN.OpenPresentationBootstrap.dll"; DestDir: "{app}\native"; Flags: ignoreversion restartreplace uninsrestartdelete
Source: "..\..\dist\native\Microsoft.Web.WebView2.Core.dll"; DestDir: "{app}\native"; Flags: ignoreversion restartreplace uninsrestartdelete
Source: "..\..\dist\native\Microsoft.Web.WebView2.WinForms.dll"; DestDir: "{app}\native"; Flags: ignoreversion restartreplace uninsrestartdelete
Source: "..\..\dist\native\WebView2Loader.dll"; DestDir: "{app}\native"; Flags: ignoreversion restartreplace uninsrestartdelete
Source: "..\..\dist\native\runtimes\*"; DestDir: "{app}\native\runtimes"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\native\lib\Extensibility.dll"; DestDir: "{app}\native"; Flags: ignoreversion
Source: "..\..\manifests\wps\*"; DestDir: "{app}\wps"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\taskpane\public\icon.svg"; DestDir: "{app}\wps"; Flags: ignoreversion
Source: "..\..\taskpane\public\icon-image.svg"; DestDir: "{app}\wps"; Flags: ignoreversion
Source: "..\..\taskpane\public\icon-chart.svg"; DestDir: "{app}\wps"; Flags: ignoreversion
Source: "..\..\taskpane\public\icon-diagram.svg"; DestDir: "{app}\wps"; Flags: ignoreversion
Source: "..\..\taskpane\public\tools\*.svg"; DestDir: "{app}\wps\tools"; Flags: ignoreversion
Source: "..\..\scripts\install-wps-plugin.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\..\scripts\install-native-bootstrap.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\..\scripts\prepare-plugin-update.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion

[Icons]
Name: "{group}\修复 SANDUN 插件"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\scripts\install-native-bootstrap.ps1"" -InstallDir ""{app}"" -RepairOnly"; WorkingDir: "{app}"

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\install-native-bootstrap.ps1"" -InstallDir ""{app}"" -Uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveNativeBootstrap"
Filename: "{app}\local\{#MyAppExeName}"; Parameters: "--remove-certificate"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveCertificate"
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\install-wps-plugin.ps1"" -InstallDir ""{app}"" -Uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveWps"

[Code]
var
  LastCopyProgress: Integer;

function ExistingInstallDirectory(Param: String): String;
var
  Path: String;
  Key: String;
begin
  Result := ExpandConstant('{localappdata}\Programs\SANDUNPPTOpenSource');
  Key := 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{DFB0641B-FA91-4437-9134-BB59480C8C8E}_is1';
  if RegQueryStringValue(HKCU64, Key, 'InstallLocation', Path) and DirExists(Path) then Result := Path
  else if RegQueryStringValue(HKCU32, Key, 'InstallLocation', Path) and DirExists(Path) then Result := Path
  else if RegQueryStringValue(HKLM64, Key, 'InstallLocation', Path) and DirExists(Path) then Result := Path
  else if RegQueryStringValue(HKLM32, Key, 'InstallLocation', Path) and DirExists(Path) then Result := Path;
end;

procedure CurInstallProgressChanged(CurProgress, MaxProgress: Integer);
var
  Value: Integer;
begin
  if MaxProgress <= 0 then Exit;
  Value := 8 + Round(67.0 * CurProgress / MaxProgress);
  if Value <> LastCopyProgress then begin
    LastCopyProgress := Value;
    Log('SANDUN_PROGRESS|' + IntToStr(Value) + '|正在安装插件文件');
  end;
end;

procedure RunChecked(Filename, Parameters, Status: String; Percent: Integer);
var
  ResultCode: Integer;
begin
  WizardForm.StatusLabel.Caption := Status;
  Log('SANDUN_PROGRESS|' + IntToStr(Percent) + '|' + Status);
  if not Exec(Filename, Parameters, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    RaiseException(Status + ' 无法启动安装步骤，请查看安装日志。');
  if ResultCode <> 0 then
    RaiseException(Status + ' 失败，退出码：' + IntToStr(ResultCode) + '。请查看安装日志后重试。');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Core, Scripts, InstallDir: String;
  ResultCode: Integer;
begin
  if CurStep <> ssPostInstall then Exit;
  Core := ExpandConstant('{app}\local\{#MyAppExeName}');
  Scripts := ExpandConstant('{app}\scripts\');
  InstallDir := ExpandConstant('{app}');
  RunChecked(Core, '--generate-certificate', '正在生成本机 HTTPS 证书...', 77);
  RunChecked(ExpandConstant('{sys}\certutil.exe'), '-addstore -f Root "' + ExpandConstant('{localappdata}\SANDUNPPTOpenSource\certificates\localhost-cert.pem') + '"', '正在信任本机 HTTPS 证书...', 80);
  RunChecked(Core, '--verify-certificate', '正在验证本机 HTTPS 证书...', 83);
  RunChecked(Core, '--self-test', '正在检查本地 AI 核心...', 86);
  RunChecked('powershell.exe', '-NoProfile -ExecutionPolicy Bypass -File "' + Scripts + 'install-wps-plugin.ps1" -InstallDir "' + InstallDir + '"', '正在注册 WPS 插件...', 93);
  RunChecked('powershell.exe', '-NoProfile -ExecutionPolicy Bypass -File "' + Scripts + 'install-native-bootstrap.ps1" -InstallDir "' + InstallDir + '"', '正在注册 Office/WPS 插件...', 96);
  // The WPS ribbon is a JS plugin served by the local core over HTTPS. WPS does not
  // auto-connect the COM addin that would start the core, and security software
  // commonly blocks Office hosts from spawning processes at all, so after install
  // or an update nothing else would bring the core up. Start it keep-alive; the
  // per-user Run key written by install-native-bootstrap.ps1 does the same at logon.
  Exec(ExpandConstant('{app}\local\{#MyAppExeName}'), '--keep-alive', ExpandConstant('{app}\local'), SW_HIDE, ewNoWait, ResultCode);
  Log('SANDUN_PROGRESS|100|安装完成');
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  if CheckForMutexes('SANDUNPPTOpenSource-Installer') then
  begin
    SuppressibleMsgBox('SANDUN 插件安装程序已经在运行。', mbError, MB_OK, IDOK);
    Result := False;
  end;
  if Result then CreateMutex('SANDUNPPTOpenSource-Installer');
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  ReportPath: String;
  Detail: AnsiString;
begin
  Result := '';
  ExtractTemporaryFile('prepare-plugin-update.ps1');
  ReportPath := ExpandConstant('{tmp}\sandun-update-status.txt');
  DeleteFile(ReportPath);
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\prepare-plugin-update.ps1') +
    '" -InstallDir "' + ExpandConstant('{app}') + '" -ReportPath "' + ReportPath + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    Result := '无法启动更新检查，请重试。';
    Exit;
  end;
  LoadStringFromFile(ReportPath, Detail);
  Log('SANDUN update preparation: ' + IntToStr(ResultCode) + ' ' + String(Detail));
  if ResultCode = 2 then Log('SANDUN_BLOCK|HOST')
  else if ResultCode = 3 then Log('SANDUN_BLOCK|PORT|' + String(Detail))
  else if ResultCode = 4 then Log('SANDUN_BLOCK|CORE');
  case ResultCode of
    0: Result := '';
    2: Result := '请先保存文稿并关闭 PowerPoint 和 WPS 演示，再点击重试。安装器会自动处理本插件的旧服务。';
    3: Result := '端口 17667 被其他程序占用：' + String(Detail) + '。请关闭该程序后点击重试，无需退出安装器。';
    4: Result := '本插件的旧服务尚未退出，请稍后点击重试。';
  else
    Result := '更新环境检查失败，请重试；详细原因已写入安装日志。';
  end;
end;
