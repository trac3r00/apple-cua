import { gzipSync } from "node:zlib";
import type { Point } from "../types/index.js";

// allow: SIZE_OK - The self-contained cross-session helper and wire decoder share the approved single-file boundary.

/** Only fixed generated source enters here; indentation and standalone comments have no runtime meaning. */
function compactWindowsScript(script: string): string {
	return script
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("//") && !line.startsWith("#"))
		.join("\n");
}

/** Decode only the helper's failed-child envelope; callers must still quote and bound this untrusted text. */
export function windowsDisplayDiagnostic(output: string): string {
	if (!output.startsWith("CUA1:")) return output;
	const invalid = "stage=parent-frame; error=invalid child diagnostic envelope";
	if (output.length > 1400) return invalid;
	const match = /^CUA1:([A-Za-z0-9+/]+={0,2}):([0-9]{1,5})\r?\n?$/u.exec(output);
	if (match?.[1] === undefined || match[2] === undefined) return invalid;
	const frame = Buffer.from(match[1], "base64");
	const exit = Number(match[2]);
	if (
		frame.toString("base64") !== match[1] ||
		frame.length < 7 ||
		frame.length > 1031 ||
		frame.readUInt32LE(0) !== frame.length - 4 ||
		(frame[4] !== 1 && frame[4] !== 2) ||
		frame[6] === undefined ||
		frame[6] > 1 ||
		exit >= 65536
	) {
		return invalid;
	}
	const stages: Readonly<Record<number, string>> = {
		1: "child-add-type",
		2: "child-metrics",
		3: "child-cursor-bounds",
		4: "child-cursor",
	};
	const stage = frame[5] === undefined ? undefined : stages[frame[5]];
	if (stage === undefined) return invalid;
	try {
		const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
		if (frame[4] === 1) {
			const error = utf8.decode(frame.subarray(7));
			return `stage=${stage}; childExit=${exit}; errorTruncated=${frame[6] === 1}; error=${error}`;
		}
		const lengthText = frame.subarray(7, 10).toString("latin1");
		if (!/^[0-9]{3}$/u.test(lengthText)) return invalid;
		const length = Number(lengthText);
		if (length > 512 || frame.length < 10 + length) return invalid;
		const error = utf8.decode(frame.subarray(10, 10 + length));
		const values = utf8.decode(frame.subarray(10 + length)).split("\0");
		const names = [
			"childSid",
			"TEMP",
			"TMP",
			"USERPROFILE",
			"localApplicationData",
			"tempPath",
			"selectedSid",
		] as const;
		const statuses = ["value", "truncated", "unavailable", "unset"] as const;
		if (values.shift() !== "" || values.length !== names.length) return invalid;
		// Build only the fixed, bounded diagnostic fields; never expose an environment dictionary.
		const context: Record<string, { status: string; value: string }> = {};
		for (const [index, name] of names.entries()) {
			const field = values[index];
			if (field === undefined || !/^[0-3]/u.test(field)) return invalid;
			const status = statuses[Number(field[0])];
			const value = field.slice(1);
			if (
				status === undefined ||
				Buffer.byteLength(value, "utf8") > 64 ||
				((status === "unavailable" || status === "unset") && value !== "")
			) {
				return invalid;
			}
			context[name] = { status, value };
		}
		return `stage=${stage}; childExit=${exit}; envPolicy=console-token-block-v1; errorTruncated=${frame[6] === 1}; error=${error}; context=${JSON.stringify(context)}`;
	} catch (error) {
		if (error instanceof TypeError) return invalid;
		throw error;
	}
}

/** The exact TypeDefinition shipped to the existing outer Add-Type call, compressed only for command size. */
export const windowsDisplayNativeSource = String.raw`using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;
public class CuaInteractive {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 public struct STARTUPINFO {
  public int cb; public string reserved; public string desktop; public string title;
  public int x,y,width,height,xchars,ychars,fill,flags; public short show,reserved2;
  public IntPtr reservedPtr,input,output,error;
 }
 [StructLayout(LayoutKind.Sequential)]
 public struct PROCESSINFO { public IntPtr process,thread; public int pid,tid; }
 [StructLayout(LayoutKind.Sequential)]
 public struct STARTUPEX { public STARTUPINFO startup; public IntPtr attributes; }
 [StructLayout(LayoutKind.Sequential)]
 public struct SECURITY { public int length; public IntPtr descriptor; public int inherit; }
 [StructLayout(LayoutKind.Sequential)]
 public struct BASICLIMITS {
  public long processTime,jobTime; public uint flags;
  public UIntPtr minWorking,maxWorking; public uint activeLimit; public UIntPtr affinity;
  public uint priority,scheduling;
 }
 [StructLayout(LayoutKind.Sequential)]
 public struct LIMITS {
  public BASICLIMITS basic;
  public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes;
  public UIntPtr processMemory,jobMemory,peakProcessMemory,peakJobMemory;
 }
 [StructLayout(LayoutKind.Sequential)]
 public struct PORT { public IntPtr key,port; }
 [StructLayout(LayoutKind.Sequential)]
 public struct ACCOUNTING {
  public long userTime,kernelTime,periodUserTime,periodKernelTime;
  public uint faults,total,active,terminated;
 }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern IntPtr CreateJobObject(IntPtr security,string name);
 [DllImport("kernel32.dll",SetLastError=true)]
 static extern bool SetInformationJobObject(IntPtr job,int kind,ref LIMITS value,int size);
 [DllImport("kernel32.dll",SetLastError=true)]
 static extern bool SetInformationJobObject(IntPtr job,int kind,ref PORT value,int size);
 [DllImport("kernel32.dll",SetLastError=true)]
 static extern bool QueryInformationJobObject(IntPtr job,int kind,ref ACCOUNTING value,int size,IntPtr returned);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
 [DllImport("kernel32.dll",SetLastError=true)]
 static extern IntPtr CreateIoCompletionPort(IntPtr file,IntPtr port,IntPtr key,uint threads);
 [DllImport("kernel32.dll",SetLastError=true)]
 static extern bool GetQueuedCompletionStatus(IntPtr port,out uint message,out IntPtr key,out IntPtr value,uint timeout);
 [DllImport("kernel32.dll",SetLastError=true)]
 static extern bool PostQueuedCompletionStatus(IntPtr port,uint message,IntPtr key,IntPtr value);
 [DllImport("kernel32.dll",SetLastError=true)]
 static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32.dll",SetLastError=true)]
 static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool belongs);
 [DllImport("kernel32.dll",SetLastError=true)]
 static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,uint flags,ref UIntPtr size);
 [DllImport("kernel32.dll",SetLastError=true)]
 static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,UIntPtr attribute,
  IntPtr value,UIntPtr size,IntPtr previous,IntPtr returned);
 [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern SafePipeHandle CreateNamedPipe(string name,uint access,uint mode,uint instances,
  uint output,uint input,uint timeout,ref SECURITY security);
 [DllImport("kernel32.dll",SetLastError=true)]
 static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe,out uint pid);
 [DllImport("kernel32.dll",SetLastError=true)]
 static extern bool CancelIoEx(SafePipeHandle pipe,IntPtr overlapped);
 [DllImport("kernel32.dll")] static extern uint WTSGetActiveConsoleSessionId();
 [DllImport("wtsapi32.dll",SetLastError=true)] static extern bool WTSQueryUserToken(uint session,out IntPtr token);
 [DllImport("userenv.dll",SetLastError=true)]
 static extern bool CreateEnvironmentBlock(out IntPtr environment,IntPtr token,bool inherit);
 [DllImport("userenv.dll",SetLastError=true)]
 static extern bool DestroyEnvironmentBlock(IntPtr environment);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern bool CreateProcessAsUser(IntPtr token,string app,StringBuilder command,IntPtr pa,IntPtr ta,
   bool inherit,uint flags,IntPtr env,string directory,ref STARTUPEX startup,out PROCESSINFO process);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 readonly Stopwatch clock=Stopwatch.StartNew();
 readonly Dictionary<uint,IntPtr> members=new Dictionary<uint,IntPtr>();
 IntPtr job,port;
 PROCESSINFO process;
 Task collector;
 int Remaining() {
  long remaining=90000-clock.ElapsedMilliseconds;
  if (remaining<=0) throw new TimeoutException("Guest query deadline");
  return (int)remaining;
 }
 void Await(Task task) {
  try {
   if (!task.Wait(Remaining())) throw new TimeoutException("Guest pipe deadline");
   task.GetAwaiter().GetResult();
  } finally {
   // A pending operation retains its managed buffer and native OVERLAPPED until completion.
   // Never free request storage or synchronously wait for cancellation on this thread.
   if (task.IsCompleted) task.Dispose();
   else task.ContinueWith(t => { if (t.IsFaulted) t.Exception.Handle(error => true); t.Dispose(); },
    TaskScheduler.Default);
  }
 }
 void Collect() {
  uint? total=null;
  while (true) {
   int remaining=95000-(int)clock.ElapsedMilliseconds;
   if (remaining<=0) throw new TimeoutException("Tree observation deadline");
   uint message; IntPtr key,value;
   if (!GetQueuedCompletionStatus(port,out message,out key,out value,(uint)remaining))
    throw new Win32Exception();
   if (key==IntPtr.Zero && message==0) throw new OperationCanceledException("Tree capture interrupted");
   if (key!=job) throw new InvalidDataException("Unexpected job completion key");
   if (message==6) {
    uint pid=unchecked((uint)value.ToInt64());
    if (pid!=(uint)process.pid && !members.ContainsKey(pid)) {
     IntPtr member=OpenProcess(0x00100400,false,pid); // SYNCHRONIZE | QUERY_INFORMATION
     if (member==IntPtr.Zero) throw new Win32Exception();
     try {
      bool belongs;
      if (!IsProcessInJob(member,job,out belongs)) throw new Win32Exception();
      if (!belongs) throw new InvalidDataException("Descendant identity is no longer in the job");
      if (members.Count>=64) throw new InvalidDataException("Descendant handle bound exceeded");
      members.Add(pid,member); member=IntPtr.Zero;
     } finally { if (member!=IntPtr.Zero) CloseHandle(member); }
    }
   } else if (message==4) {
    ACCOUNTING accounting=new ACCOUNTING();
    if (!QueryInformationJobObject(job,1,ref accounting,Marshal.SizeOf(accounting),IntPtr.Zero))
     throw new Win32Exception();
    if (accounting.active!=0 || accounting.total<1 || accounting.total>65)
     throw new InvalidDataException("Invalid completed-tree accounting");
    total=accounting.total;
   }
   // Counts prove handle coverage only. ConfirmTree still waits every actual process handle.
   if (total.HasValue) {
    if ((uint)members.Count+1>total.Value) throw new InvalidDataException("Tree coverage mismatch");
    if ((uint)members.Count+1==total.Value) return;
   }
  }
 }
 void ConfirmTree(int milliseconds) {
  Stopwatch wait=Stopwatch.StartNew();
  if (collector==null) throw new InvalidOperationException("Tree observer was not started");
  if (!collector.Wait(milliseconds)) throw new TimeoutException("Tree completion not observed");
  collector.GetAwaiter().GetResult();
  List<IntPtr> handles=new List<IntPtr>(members.Values); handles.Add(process.process);
  foreach (IntPtr handle in handles) {
   int remaining=Math.Max(0,milliseconds-(int)wait.ElapsedMilliseconds);
   uint status=WaitForSingleObject(handle,(uint)remaining);
   if (status==0xffffffff) throw new Win32Exception();
   if (status!=0) throw new TimeoutException("Descendant termination not confirmed");
  }
  // Recheck coverage after real exits: a notification/counter transition is not itself an exit barrier.
  ACCOUNTING final=new ACCOUNTING();
  if (!QueryInformationJobObject(job,1,ref final,Marshal.SizeOf(final),IntPtr.Zero)) throw new Win32Exception();
  if (final.active!=0 || final.total!=(uint)members.Count+1)
   throw new InvalidDataException("Tree membership changed before the exit barrier");
 }
 void ReleaseTree() {
  // This runs only after the consumer has settled, or when no consumer was started.
  if (job!=IntPtr.Zero) CloseHandle(job);
  foreach (IntPtr member in members.Values) CloseHandle(member);
  if (process.process!=IntPtr.Zero) CloseHandle(process.process);
  if (port!=IntPtr.Zero) CloseHandle(port);
  if (collector!=null) {
   if (collector.IsFaulted) collector.Exception.Handle(error => true);
   collector.Dispose();
  }
 }
 void ReadExact(NamedPipeServerStream pipe,byte[] bytes) {
  int offset=0;
  while (offset<bytes.Length) {
   Task<int> read=pipe.ReadAsync(bytes,offset,bytes.Length-offset);
   Await(read);
   int count=read.GetAwaiter().GetResult();
   if (count==0) throw new InvalidDataException("Partial child diagnostic frame");
   offset+=count;
  }
 }
 static void Failure(string stage,Exception error) {
  Exception cause=error.GetBaseException();
  string message=cause.GetType().Name+": "+cause.Message;
  if (message.Length>1024) message=message.Substring(0,1024)+" [truncated]";
  Console.Error.WriteLine("stage="+stage+"; error="+message);
 }
 public uint Run(string executable,string encodedChild) {
  string stage="parent-token";
  IntPtr token=IntPtr.Zero;
  NamedPipeServerStream pipe=null;
  bool treeExited=false;
  uint result=1;
  try {
   uint session=WTSGetActiveConsoleSessionId();
   if (session==0xffffffff) throw new InvalidOperationException("No active console session");
   if (!WTSQueryUserToken(session,out token)) throw new Win32Exception();
   stage="parent-job-create";
   job=CreateJobObject(IntPtr.Zero,null);
   if (job==IntPtr.Zero) throw new Win32Exception();
   LIMITS limits=new LIMITS(); limits.basic.flags=0x2000; // KILL_ON_JOB_CLOSE; no breakaway
   if (!SetInformationJobObject(job,9,ref limits,Marshal.SizeOf(limits))) throw new Win32Exception();
   stage="parent-job-port";
   port=CreateIoCompletionPort(new IntPtr(-1),IntPtr.Zero,IntPtr.Zero,1);
   if (port==IntPtr.Zero) throw new Win32Exception();
   PORT association=new PORT(); association.key=job; association.port=port;
   if (!SetInformationJobObject(job,7,ref association,Marshal.SizeOf(association))) throw new Win32Exception();
   stage="parent-pipe-security";
   string sid;
   using (WindowsIdentity identity=new WindowsIdentity(token)) { sid=identity.User.Value; }
   RawSecurityDescriptor acl=new RawSecurityDescriptor("D:P(A;;GA;;;SY)(A;;GRGW;;;"+sid+")");
   byte[] descriptor=new byte[acl.BinaryLength]; acl.GetBinaryForm(descriptor,0);
   string name="apple-cua-display-"+Guid.NewGuid().ToString("N");
   IntPtr memory=Marshal.AllocHGlobal(descriptor.Length);
   try {
    Marshal.Copy(descriptor,0,memory,descriptor.Length);
    SECURITY security=new SECURITY(); security.length=Marshal.SizeOf(security); security.descriptor=memory;
    stage="parent-pipe-create";
    // DUPLEX | OVERLAPPED | FIRST_PIPE_INSTANCE; byte mode | REJECT_REMOTE_CLIENTS.
    SafePipeHandle handle=CreateNamedPipe(@"\\.\pipe\"+name,0x40080003,0x8,1,128,4096,0,ref security);
    if (handle.IsInvalid) { int error=Marshal.GetLastWin32Error(); handle.Dispose(); throw new Win32Exception(error); }
    try { pipe=new NamedPipeServerStream(PipeDirection.InOut,true,false,handle); }
    catch { handle.Dispose(); throw; }
   } finally { Marshal.FreeHGlobal(memory); }
   stage="parent-job-startup";
   string source;
   using (MemoryStream payload=new MemoryStream(Convert.FromBase64String(encodedChild)))
   using (System.IO.Compression.GZipStream zip=new System.IO.Compression.GZipStream(payload,
    System.IO.Compression.CompressionMode.Decompress))
   using (StreamReader reader=new StreamReader(zip,Encoding.UTF8)) { source=reader.ReadToEnd(); }
   string child="$pipeName='"+name+"';\n"+source;
   string command="\""+executable+"\" -NoProfile -NonInteractive -EncodedCommand "+
    Convert.ToBase64String(Encoding.Unicode.GetBytes(child));
   UIntPtr size=UIntPtr.Zero;
   InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size);
   if (Marshal.GetLastWin32Error()!=122) throw new Win32Exception();
   IntPtr attributes=Marshal.AllocHGlobal(checked((int)size.ToUInt64()));
   IntPtr jobValue=IntPtr.Zero;
   bool initialized=false;
   try {
    if (!InitializeProcThreadAttributeList(attributes,1,0,ref size)) throw new Win32Exception();
    initialized=true;
    jobValue=Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobValue,job);
    // JOB_LIST makes confinement atomic with creation, including outer-process cancellation.
    if (!UpdateProcThreadAttribute(attributes,0,new UIntPtr(0x2000d),jobValue,
     new UIntPtr((uint)IntPtr.Size),IntPtr.Zero,IntPtr.Zero)) throw new Win32Exception();
    STARTUPEX startup=new STARTUPEX(); startup.startup.cb=Marshal.SizeOf(startup);
    startup.startup.desktop="winsta0\\default"; startup.attributes=attributes;
    stage="parent-environment-create";
    IntPtr environment;
    if (!CreateEnvironmentBlock(out environment,token,false)) throw new Win32Exception();
    try {
     stage="parent-process-create";
     // NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT | UNICODE_ENVIRONMENT | SUSPENDED; no handle inheritance/breakaway.
     if (!CreateProcessAsUser(token,null,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,false,
      0x08080404,environment,null,ref startup,out process)) throw new Win32Exception();
    } finally {
     // CreateProcessAsUser copies the block before returning; only this successful allocation is owned here.
     if (!DestroyEnvironmentBlock(environment)) {
      stage="parent-environment-destroy";
      throw new Win32Exception();
     }
    }
   } finally {
    if (initialized) DeleteProcThreadAttributeList(attributes);
    if (jobValue!=IntPtr.Zero) Marshal.FreeHGlobal(jobValue);
    Marshal.FreeHGlobal(attributes);
   }
   stage="parent-job-observer";
   collector=Task.Factory.StartNew(Collect,CancellationToken.None,TaskCreationOptions.LongRunning,TaskScheduler.Default);
   stage="parent-child-resume";
   uint suspended=ResumeThread(process.thread);
   if (suspended==0xffffffff) throw new Win32Exception();
   if (suspended!=1) throw new InvalidOperationException("Unexpected child suspend count");
   stage="parent-pipe-connect";
   Await(pipe.WaitForConnectionAsync());
   stage="parent-pipe-identity";
   uint client;
   if (!GetNamedPipeClientProcessId(pipe.SafePipeHandle,out client)) throw new Win32Exception();
   if (client!=(uint)process.pid) throw new InvalidDataException("Child diagnostic PID mismatch");
   // Keep the child connected until its identity has been checked.
   stage="parent-pipe-ack";
   Await(pipe.WriteAsync(new byte[] {1},0,1));
   stage="parent-pipe-header";
   byte[] header=new byte[4]; ReadExact(pipe,header);
   uint length=BitConverter.ToUInt32(header,0);
   if (length<3 || length>1027) throw new InvalidDataException("Invalid child diagnostic length");
   stage="parent-pipe-body";
   byte[] body=new byte[(int)length]; ReadExact(pipe,body);
   stage="parent-pipe-frame";
   if (body[0]!=1 || body[1]>4 || body[2]>1) throw new InvalidDataException("Invalid child diagnostic fields");
   new UTF8Encoding(false,true).GetString(body,3,body.Length-3);
   // One frame only. EOF, like every read, is subject to the shared deadline.
   Task<int> tail=pipe.ReadAsync(new byte[1],0,1); Await(tail);
   if (tail.GetAwaiter().GetResult()!=0) throw new InvalidDataException("Trailing child diagnostic data");
   stage="parent-child-exit";
   uint wait=WaitForSingleObject(process.process,(uint)Remaining());
   if (wait==0xffffffff) throw new Win32Exception();
   if (wait!=0) throw new TimeoutException("Interactive child exit deadline");
   uint code; if (!GetExitCodeProcess(process.process,out code)) throw new Win32Exception();
   stage="parent-pipe-frame";
   bool success=code>=65536;
   if (success!=(body[1]==0) || (success && (body.Length!=3 || body[2]!=0)))
    throw new InvalidDataException("Child diagnostic disagrees with exit status");
   if (success && ((code>>16)>32767 || (code&65535)==0 || (code&65535)>32767))
    throw new InvalidDataException("Invalid packed display dimensions");
   if (!success) {
    byte[] selected=Encoding.UTF8.GetBytes("\0"+(sid.Length>64?"1"+sid.Substring(0,64):"0"+sid));
    int framedLength=body.Length+selected.Length;
    if (framedLength>1027) throw new InvalidDataException("Invalid context diagnostic length");
    byte[] frame=new byte[4+framedLength];
    Buffer.BlockCopy(BitConverter.GetBytes((uint)framedLength),0,frame,0,4);
    Buffer.BlockCopy(body,0,frame,4,body.Length);
    Buffer.BlockCopy(selected,0,frame,4+body.Length,selected.Length);
    // Version 2 attests this parent's successful console-token environment launch, not just child script text.
    frame[4]=2;
    Console.WriteLine("CUA1:"+Convert.ToBase64String(frame)+":"+code);
   } else {
    stage="parent-tree-exit";
    ConfirmTree(Remaining());
    treeExited=true;
   }
   result=code;
  } catch (Exception error) {
   Failure(stage,error);
   if (process.process!=IntPtr.Zero) {
    uint code;
    if (GetExitCodeProcess(process.process,out code))
     Console.Error.WriteLine("stage=parent-child-status; childExit="+code);
   }
   result=1;
  } finally {
   try {
    if (pipe!=null) {
     // Cancel all operations on this task-owned handle; ERROR_NOT_FOUND means none pending.
     try {
      if (!CancelIoEx(pipe.SafePipeHandle,IntPtr.Zero)) {
       int error=Marshal.GetLastWin32Error();
       if (error!=1168) { Failure("parent-pipe-cancel",new Win32Exception(error)); result=1; }
      }
     } finally { pipe.Dispose(); }
    }
   } finally {
    try {
     if (process.process!=IntPtr.Zero && !treeExited) {
      if (!TerminateJobObject(job,1)) { Failure("parent-job-terminate",new Win32Exception()); result=1; }
      try { ConfirmTree(5000); }
      catch (Exception error) { Failure("parent-tree-cleanup-unconfirmed",error); result=1; }
     }
    } finally {
     if (process.thread!=IntPtr.Zero) CloseHandle(process.thread);
     if (token!=IntPtr.Zero) CloseHandle(token);
     if (collector!=null && !collector.IsCompleted) {
      // Keep job/port/member handles alive until the blocking consumer is out of native code.
      try {
       if (!PostQueuedCompletionStatus(port,0,IntPtr.Zero,IntPtr.Zero)) {
        result=1; Failure("parent-job-observer-stop",new Win32Exception());
       }
      } finally { collector.ContinueWith(completed => ReleaseTree(),TaskScheduler.Default); }
     } else { ReleaseTree(); }
    }
   }
  }
  return result;
 }
}`;

/** QGA runs as SYSTEM in session 0; pointer and display APIs must run on the interactive desktop. */
export function windowsDisplayScript(position?: Point): string {
	const child = `$pipe=$null;
try {
 $pipe=[IO.Pipes.NamedPipeClientStream]::new('.', $pipeName, [IO.Pipes.PipeDirection]::InOut);
 $pipe.Connect(10000);
 if ($pipe.ReadByte() -ne 1) { throw 'Diagnostic peer did not acknowledge identity' };
 $stage=1; $result=1; $message='';
 try {
  Add-Type -ErrorAction Stop -TypeDefinition 'using System.Runtime.InteropServices; public class D {
[DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); }';
  $stage=2; $w=[D]::GetSystemMetrics(0); $h=[D]::GetSystemMetrics(1);
  if ($w -le 0 -or $h -le 0 -or $w -gt 32767 -or $h -gt 32767) {
   $result=0; $message='Invalid display metrics: '+$w+'x'+$h;
  } else {
   $result=($w -shl 16) -bor $h;
   ${position === undefined ? "" : `$stage=3; if (${Math.round(position.x)} -ge $w -or ${Math.round(position.y)} -ge $h) { $result=2; $message='Cursor outside display' } else { $stage=4; if (-not [D]::SetCursorPos(${Math.round(position.x)},${Math.round(position.y)})) { $result=3; $message='SetCursorPos returned false' } };`}
   if ($result -ge 65536) { $stage=0 };
  };
 } catch {
  $result=1;
  $message=$_.Exception.GetType().FullName+': '+$_.Exception.Message;
 };
 # Reserve the primary error before collecting only named identity/path facts on failure.
 $bytes=[byte[]]::new(512); $charsUsed=0; $bytesUsed=0; $complete=$false;
 $truncated=$message.Length -gt 2048;
 if ($truncated) { $message=$message.Substring(0,2048) };
 $chars=$message.ToCharArray();
 [Text.Encoding]::UTF8.GetEncoder().Convert($chars,0,$chars.Length,$bytes,0,512,$true,
  [ref]$charsUsed,[ref]$bytesUsed,[ref]$complete);
 $errorTruncated=$truncated -or -not $complete;
 if ($result -lt 65536) {
  $primary=[Text.Encoding]::UTF8.GetString($bytes,0,$bytesUsed);
  try {
   function Field($read) {
    try {
     $value=& $read;
     if ($null -eq $value) { return '3' };
     $text=[string]$value;
     if ($text.IndexOf([char]0) -ge 0) { return '2' };
     $flag='0'; if ($text.Length -gt 128) { $text=$text.Substring(0,128); $flag='1' };
     $b=[byte[]]::new(64); $c=0; $n=0; $done=$false; $a=$text.ToCharArray();
     [Text.Encoding]::UTF8.GetEncoder().Convert($a,0,$a.Length,$b,0,64,$true,[ref]$c,[ref]$n,[ref]$done);
     if (-not $done) { $flag='1' };
     return $flag+[Text.Encoding]::UTF8.GetString($b,0,$n);
    } catch { return '2' };
   };
   $facts=@(
    (Field { $i=[Security.Principal.WindowsIdentity]::GetCurrent(); try { $i.User.Value } finally { $i.Dispose() } })
    (Field { [Environment]::GetEnvironmentVariable('TEMP') })
    (Field { [Environment]::GetEnvironmentVariable('TMP') })
    (Field { [Environment]::GetEnvironmentVariable('USERPROFILE') })
    (Field { [Environment]::GetFolderPath('LocalApplicationData','DoNotVerify') })
    (Field { [IO.Path]::GetTempPath() })
   );
  } catch { $facts=@('2','2','2','2','2','2') };
  $text=$bytesUsed.ToString('D3',[Globalization.CultureInfo]::InvariantCulture)+$primary+[char]0+($facts -join [char]0);
  $bytes=[Text.Encoding]::UTF8.GetBytes($text); $bytesUsed=$bytes.Length;
 };
 $frame=[byte[]]::new(7+$bytesUsed);
 [BitConverter]::GetBytes([uint32](3+$bytesUsed)).CopyTo($frame,0);
 $frame[4]=1; $frame[5]=[byte]$stage; $frame[6]=[byte]$errorTruncated;
 [Array]::Copy($bytes,0,$frame,7,$bytesUsed);
 $pipe.Write($frame,0,$frame.Length);
} catch { $result=1 } finally { if ($null -ne $pipe) { $pipe.Dispose() } };
exit $result`;
	const encoded = gzipSync(Buffer.from(compactWindowsScript(child), "utf8")).toString("base64");
	const native = gzipSync(Buffer.from(windowsDisplayNativeSource, "utf8")).toString("base64");
	return compactWindowsScript(`$memory=$null; $zip=$null; $reader=$null;
try {
 $native=[Convert]::FromBase64String('${native}');
 $memory=[IO.MemoryStream]::new($native,$false);
 $zip=[IO.Compression.GZipStream]::new($memory,[IO.Compression.CompressionMode]::Decompress);
 $reader=[IO.StreamReader]::new($zip,[Text.Encoding]::UTF8);
 Add-Type -ErrorAction Stop -TypeDefinition ($reader.ReadToEnd());
} catch {
 $message=$_.Exception.GetType().FullName+': '+$_.Exception.Message;
 if ($message.Length -gt 1024) { $message=$message.Substring(0,1024)+' [truncated]' };
 [Console]::WriteLine('stage=parent-add-type; error='+$message);
 exit 1;
} finally {
 if ($null -ne $reader) { $reader.Dispose() }
 elseif ($null -ne $zip) { $zip.Dispose() }
 elseif ($null -ne $memory) { $memory.Dispose() };
};
$result=([CuaInteractive]::new()).Run($PSHOME+'\\powershell.exe','${encoded}');
if ($result -lt 65536) { exit ([Math]::Max(1,$result)) };
[Console]::WriteLine(($result -shr 16).ToString()+"x"+($result -band 65535).ToString())`);
}
