Unicode true
Name "Browser"
OutFile "Browser-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Browser"
RequestExecutionLevel user
SetCompressor zlib
Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles
Section "Browser"
 SetOutPath "$INSTDIR"
 File /r "dist\Windows\*"
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 CreateDirectory "$SMPROGRAMS\Browser"
 CreateShortcut "$SMPROGRAMS\Browser\Browser.lnk" "$INSTDIR\Browser.exe"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Browser" "DisplayName" "Browser"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Browser" "UninstallString" '"$INSTDIR\Uninstall.exe"'
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Browser" "DisplayIcon" "$INSTDIR\Browser.exe"
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Browser" "NoModify" 1
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Browser" "NoRepair" 1
SectionEnd
Section "Uninstall"
 Delete "$SMPROGRAMS\Browser\Browser.lnk"
 RMDir "$SMPROGRAMS\Browser"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Browser"
 Delete "$INSTDIR\Uninstall.exe"
 Delete "$INSTDIR\Browser.exe"
 RMDir /r "$INSTDIR\runtime"
 RMDir "$INSTDIR"
SectionEnd
