import type { Point } from "../types/index.js";

/** QGA runs as SYSTEM in session 0; pointer and display APIs must run on the interactive desktop. */
export function windowsDisplayScript(position?: Point): string {
	const child = `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class D {
[DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); }';
$w=[D]::GetSystemMetrics(0); $h=[D]::GetSystemMetrics(1);
if ($w -le 0 -or $h -le 0 -or $w -gt 32767 -or $h -gt 32767) { exit 0 };
${position === undefined ? "" : `if (${Math.round(position.x)} -ge $w -or ${Math.round(position.y)} -ge $h) { exit 0 }; if (-not [D]::SetCursorPos(${Math.round(position.x)},${Math.round(position.y)})) { exit 0 };`}
exit (($w -shl 16) -bor $h)`;
	const encoded = Buffer.from(child, "utf16le").toString("base64");
	return `Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public class CuaInteractive {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 public struct STARTUPINFO {
  public int cb; public string reserved; public string desktop; public string title;
  public int x,y,width,height,xchars,ychars,fill,flags; public short show,reserved2;
  public IntPtr reservedPtr,input,output,error;
 }
 [StructLayout(LayoutKind.Sequential)]
 public struct PROCESSINFO { public IntPtr process,thread; public int pid,tid; }
 [DllImport("kernel32.dll")] static extern uint WTSGetActiveConsoleSessionId();
 [DllImport("wtsapi32.dll",SetLastError=true)] static extern bool WTSQueryUserToken(uint session,out IntPtr token);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern bool CreateProcessAsUser(IntPtr token,string app,StringBuilder command,IntPtr pa,IntPtr ta,
  bool inherit,uint flags,IntPtr env,string directory,ref STARTUPINFO startup,out PROCESSINFO process);
 [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
 [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 public static uint Run(string command) {
  IntPtr token;
  if (!WTSQueryUserToken(WTSGetActiveConsoleSessionId(),out token)) throw new Win32Exception();
  try {
   STARTUPINFO startup=new STARTUPINFO(); startup.cb=Marshal.SizeOf(startup); startup.desktop="winsta0\\\\default";
   PROCESSINFO process;
   if (!CreateProcessAsUser(token,null,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,false,
    0x08000000,IntPtr.Zero,null,ref startup,out process)) throw new Win32Exception();
   try {
    if (WaitForSingleObject(process.process,90000)!=0) {
     TerminateProcess(process.process,1);
     throw new TimeoutException("Interactive guest query timed out");
    }
    uint code; if (!GetExitCodeProcess(process.process,out code)) throw new Win32Exception();
    return code;
   } finally { CloseHandle(process.thread); CloseHandle(process.process); }
  } finally { CloseHandle(token); }
 }
}
'@
$command='"'+$PSHOME+'\\powershell.exe" -NoProfile -NonInteractive -EncodedCommand ${encoded}';
$result=[CuaInteractive]::Run($command);
if ($result -eq 0) { exit 2 };
[Console]::WriteLine(($result -shr 16).ToString()+"x"+($result -band 65535).ToString())`;
}
