import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { windowsDisplayNativeSource } from "../utm-windows-script.js";
import { windowsHelperScript } from "./helper.js";

const execute = promisify(execFile);
const vmId = "E7610018-F723-475D-9B98-DAF94E769CDB";
const app = "/Users/cminseo/Applications/UTM.app";
const selection = `const u=Application(${JSON.stringify(app)}); const v=u.virtualMachines.byId(${JSON.stringify(vmId)});`;
const powershell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const guestScratch = `C:\\Users\\Public\\opencua-windows-live-${randomUUID()}`;
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		interrupted = true;
	});
}

function pack(source: string): string {
	const compressed = gzipSync(Buffer.from(source)).toString("base64");
	return `$m=[IO.MemoryStream]::new([Convert]::FromBase64String('${compressed}')); $z=[IO.Compression.GZipStream]::new($m,[IO.Compression.CompressionMode]::Decompress); $r=[IO.StreamReader]::new($z); try { Invoke-Expression ($r.ReadToEnd()) } finally { $r.Dispose(); $z.Dispose(); $m.Dispose() }`;
}

function report(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function script(body: string): Promise<string> {
	const source = `function run(){${selection} ${body}}`;
	const { stdout } = await execute("/usr/bin/osascript", ["-l", "JavaScript", "-e", source], {
		timeout: 120_000,
		maxBuffer: 2 * 1024 * 1024,
	});
	return stdout.trim();
}

async function launch(at: string, args: readonly string[]): Promise<number> {
	const id = Number(
		await script(
			`return String(u.execute(v,{at:${JSON.stringify(at)},withArguments:${JSON.stringify(args)},outputCapturing:true}).id());`,
		),
	);
	if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Invalid guest process id: ${id}`);
	return id;
}

async function result(id: number): Promise<Record<string, unknown>> {
	const raw: unknown = JSON.parse(await script(`return JSON.stringify(u.getResult(v.guestProcesses.byId(${id})));`));
	if (typeof raw !== "object" || raw === null) throw new Error("Invalid guest result");
	return Object.fromEntries(Object.entries(raw));
}

async function collect(id: number, deadline: number): Promise<Record<string, unknown>> {
	while (Date.now() < deadline) {
		if (interrupted) throw new Error("Live check interrupted");
		const response = await result(id);
		if (response["exited"] === true) return response;
		await delay(500);
	}
	throw new Error(`Guest process ${id} did not exit before its deadline`);
}

async function readiness(): Promise<void> {
	const deadline = Date.now() + 300_000;
	let attempts = 0;
	while (Date.now() < deadline) {
		try {
			const id = await launch("cmd.exe", ["/d", "/c", "echo OPENCUA_READY"]);
			const response = await collect(id, deadline);
			report({ stage: "readiness", attempt: ++attempts, id, response });
			if (response["exitCode"] === 0 && String(response["outputText"]).includes("OPENCUA_READY")) return;
		} catch (error) {
			report({
				stage: "readiness",
				attempt: ++attempts,
				error: error instanceof Error ? error.message : String(error),
			});
		}
		await delay(1000);
	}
	throw new Error("Windows guest did not become ready within five minutes");
}

function replaceOnce(source: string, before: string, after: string): string {
	if (source.split(before).length !== 2) throw new Error(`Interactive launcher contract changed: ${before}`);
	return source.replace(before, after);
}

function liveChild(): string {
	const helperPath = `${guestScratch}\\helper.ps1`;
	const helper = `Invoke-Expression ([IO.File]::ReadAllText('${helperPath}'))`;
	const encodedHelper = Buffer.from(helper, "utf16le").toString("base64");
	const child = String.raw`
$ErrorActionPreference='Stop'
$pipe=$null; $hostProcess=$null; $notepad=$null; $scratch=$null; $ok=$false
$evidence=@{ok=$false}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OpenCuaLiveWindow {
 [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window,int command);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
}
'@
try {
 $pipe=[IO.Pipes.NamedPipeClientStream]::new('.', $pipeName,[IO.Pipes.PipeDirection]::InOut)
 $pipe.Connect(10000)
 if ($pipe.ReadByte() -ne 1) { throw 'Interactive peer identity acknowledgement failed' }
 $scratch=Join-Path ([IO.Path]::GetTempPath()) ('opencua-windows-live-'+[guid]::NewGuid().ToString('N'))
 [void][IO.Directory]::CreateDirectory($scratch)
 $marker='OpenCUA-live-'+[guid]::NewGuid().ToString('N')
 $document=Join-Path $scratch ($marker+'.txt')
 [IO.File]::WriteAllText($document,'OpenCUA before live check')
 $start=[Diagnostics.ProcessStartInfo]::new()
 $start.FileName=$PSHOME+'\powershell.exe'
 $start.Arguments='-NoLogo -NoProfile -NonInteractive -EncodedCommand __HELPER__'
 $start.UseShellExecute=$false; $start.CreateNoWindow=$true
 $start.RedirectStandardInput=$true; $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
 $hostProcess=[Diagnostics.Process]::new(); $hostProcess.StartInfo=$start
 [void]$hostProcess.Start()
 $errors=$hostProcess.StandardError.ReadToEndAsync()
 $script:RequestId=0
 function Call($method,$params) {
  $script:RequestId++
  $request=@{id=$script:RequestId;method=$method;params=$params}
  $hostProcess.StandardInput.WriteLine((ConvertTo-Json -InputObject $request -Depth 20 -Compress))
  $read=$hostProcess.StandardOutput.ReadLineAsync()
  if (-not $read.Wait(30000)) { throw ('Helper deadline: '+$method) }
  $line=$read.GetAwaiter().GetResult()
  if ($null -eq $line) {
   $diagnostic=''
   if ($hostProcess.HasExited) { $diagnostic=$errors.GetAwaiter().GetResult() }
   throw ('Helper exited before '+$method+': '+$diagnostic)
  }
  $response=ConvertFrom-Json $line
  if ($response.id -ne $script:RequestId) { throw 'Helper response id mismatch' }
  if ($null -ne $response.error) { throw ($response.error.code+': '+$response.error.message) }
  return $response.result
 }
 [void](Call 'screen' @{})
 $notepad=Start-Process -FilePath ($env:WINDIR+'\System32\notepad.exe') -ArgumentList ('"'+$document+'"') -WindowStyle Hidden -PassThru
 $deadline=[DateTime]::UtcNow.AddSeconds(60)
 $window=$null
 do {
  $windows=@(Call 'listWindows' @{})
  $window=$windows | Where-Object { $_.title.Contains($marker) } | Select-Object -First 1
  if ($null -ne $window) { break }
  [Threading.Thread]::Sleep(500)
 } while ([DateTime]::UtcNow -lt $deadline)
 if ($null -eq $window) {
  $evidence.launcherPid=$notepad.Id
  $evidence.windows=@($windows | ForEach-Object { $_.title })
  throw 'Notepad window did not appear within 60 seconds'
 }
 $foreground=[OpenCuaLiveWindow]::GetForegroundWindow()
 $cursor=New-Object OpenCuaLiveWindow+POINT
 [void][OpenCuaLiveWindow]::GetCursorPos([ref]$cursor)
 [void][OpenCuaLiveWindow]::ShowWindow([IntPtr]$window.id,4)
 $before=Call 'snapshot' @{windowId=$window.id;options=@{includeScreenshot=$false}}
 $evidence.before=@{pid=$before.pid;key=$before.observationKey;windowId=$before.windowId;elements=@($before.elements).Count}
 $edit=@($before.elements | Where-Object { $_.actions -contains 'setValue' }) | Select-Object -First 1
 if ($null -eq $edit) {
  $evidence.roles=@($before.elements | ForEach-Object { @{role=$_.role;label=$_.label;actions=$_.actions} })
  throw 'Notepad exposes no writable ValuePattern'
 }
 $expected='OpenCUA verified through background UIA'
 $evidence.before.ref=$edit.id; $evidence.before.value=$edit.value
 [void](Call 'action' @{pid=$before.pid;snapshot=$before.observationKey;ref=$edit.id;action='setValue';value=$expected})
 $after=Call 'snapshot' @{pid=$before.pid;windowId=$before.windowId;options=@{includeScreenshot=$false}}
 $updated=@($after.elements | Where-Object { $_.value -eq $expected }) | Select-Object -First 1
 if ($null -eq $updated) { throw 'Second snapshot did not verify the requested value' }
 $evidence.after=@{key=$after.observationKey;ref=$updated.id;value=$updated.value}
 $settled=[OpenCuaLiveWindow]::GetForegroundWindow()
 $cursorAfter=New-Object OpenCuaLiveWindow+POINT
 [void][OpenCuaLiveWindow]::GetCursorPos([ref]$cursorAfter)
 $evidence.background=@{foregroundBefore=$foreground.ToInt64();foregroundAfter=$settled.ToInt64();
  cursorUnchanged=($cursor.X -eq $cursorAfter.X -and $cursor.Y -eq $cursorAfter.Y)}
 if ($foreground -ne $settled -or -not $evidence.background.cursorUnchanged) {
  throw 'Guest focus or pointer changed during the background workflow'
 }
 $evidence.ok=$true; $ok=$true
} catch {
 $evidence.error=$_.Exception.GetType().FullName+': '+$_.Exception.Message
} finally {
 if ($null -ne $hostProcess) {
  try {
   if (-not $hostProcess.HasExited) {
    $hostProcess.StandardInput.Close()
    if (-not $hostProcess.WaitForExit(5000)) { $hostProcess.Kill(); $hostProcess.WaitForExit() }
   }
  } finally { $hostProcess.Dispose() }
 }
 if ($null -ne $notepad) {
  try { if (-not $notepad.HasExited) { $notepad.Kill(); $notepad.WaitForExit() } } finally { $notepad.Dispose() }
 }
 if ($null -ne $scratch -and [IO.Directory]::Exists($scratch)) { [IO.Directory]::Delete($scratch,$true) }
 if ($null -ne $pipe) {
  try {
   $json=ConvertTo-Json -InputObject $evidence -Depth 10 -Compress
   $bytes=[Text.Encoding]::UTF8.GetBytes($json)
   if ($bytes.Length -gt 1024) {
    $bytes=[Text.Encoding]::UTF8.GetBytes('{"ok":false,"error":"Evidence exceeded 1024 bytes"}')
    $ok=$false
   }
   $frame=[byte[]]::new(7+$bytes.Length)
   [BitConverter]::GetBytes([uint32](3+$bytes.Length)).CopyTo($frame,0)
   $frame[4]=1; $frame[5]=[byte](-not $ok); $frame[6]=0
   [Array]::Copy($bytes,0,$frame,7,$bytes.Length)
   $pipe.Write($frame,0,$frame.Length)
  } finally { $pipe.Dispose() }
 }
}
if ($ok) { exit 65537 } else { exit 1 }
`.replace("__HELPER__", encodedHelper);
	return child;
}

function liveCommand(): string {
	const childBootstrap = `Invoke-Expression ([IO.File]::ReadAllText('${guestScratch}\\driver.ps1'))`;
	let native = replaceOnce(
		windowsDisplayNativeSource,
		"if (success!=(body[1]==0) || (success && (body.Length!=3 || body[2]!=0)))",
		"if (success!=(body[1]==0) || body[2]!=0)",
	);
	native = replaceOnce(
		native,
		"bool success=code>=65536;",
		`string evidence=Encoding.UTF8.GetString(body,3,body.Length-3); File.WriteAllText(@"${guestScratch}\\result.json",evidence,new UTF8Encoding(false)); Console.WriteLine("OPENCUA_LIVE:"+evidence); bool success=code>=65536;`,
	);
	native = replaceOnce(
		native,
		'Console.Error.WriteLine("stage="+stage+"; error="+message);',
		`File.AppendAllText(@"${guestScratch}\\native-errors.txt","stage="+stage+"; error="+message+"\\r\\n"); Console.Error.WriteLine("stage="+stage+"; error="+message);`,
	);
	const nativePacked = gzipSync(Buffer.from(native)).toString("base64");
	const childPacked = gzipSync(Buffer.from(childBootstrap)).toString("base64");
	const parent = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $m=[IO.MemoryStream]::new([Convert]::FromBase64String('${nativePacked}')); $z=[IO.Compression.GZipStream]::new($m,[IO.Compression.CompressionMode]::Decompress); $r=[IO.StreamReader]::new($z); try { Add-Type -TypeDefinition ($r.ReadToEnd()) } finally { $r.Dispose(); $z.Dispose(); $m.Dispose() }; $result=([CuaInteractive]::new()).Run($PSHOME+'\\powershell.exe','${childPacked}'); if ($result -eq 65537) { exit 0 }; exit 1`;
	return Buffer.from(pack(parent), "utf16le").toString("base64");
}

async function runPowerShell(source: string): Promise<Record<string, unknown>> {
	const encoded = Buffer.from(source, "utf16le").toString("base64");
	if (encoded.length > 30_000) throw new Error("Guest command exceeds Windows command-line length");
	const id = await launch(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded]);
	report({ stage: "powershell-process", id });
	return collect(id, Date.now() + 150_000);
}

async function upload(name: string, content: string): Promise<void> {
	const compressed = gzipSync(Buffer.from(content)).toString("base64");
	const source = `$ErrorActionPreference='Stop'; [void][IO.Directory]::CreateDirectory('${guestScratch}'); $m=[IO.MemoryStream]::new([Convert]::FromBase64String('${compressed}')); $z=[IO.Compression.GZipStream]::new($m,[IO.Compression.CompressionMode]::Decompress); $f=[IO.File]::Create('${guestScratch}\\${name}'); try { $z.CopyTo($f) } finally { $f.Dispose(); $z.Dispose(); $m.Dispose() }; [Console]::WriteLine('UPLOADED ${name}')`;
	const response = await runPowerShell(source);
	report({ stage: "upload", name, response });
	if (response["exitCode"] !== 0) throw new Error(`Guest upload failed: ${name}`);
}

async function main(): Promise<void> {
	if (process.argv[2] === "--cleanup-owned") {
		const directory = process.argv[3];
		if (!directory || !/^C:\\Users\\Public\\opencua-windows-live-[a-f0-9-]{36}$/u.test(directory)) {
			throw new Error("Expected a task-owned public scratch path");
		}
		const helperHash = createHash("sha256")
			.update(`$PhysicalAllowed=$false; $WmCharAllowed=$false;\n${windowsHelperScript}`)
			.digest("hex");
		const source = `$ErrorActionPreference='Stop'; $file='${directory}\\helper.ps1'; if ([IO.Directory]::Exists('${directory}')) { $hash=(Get-FileHash $file -Algorithm SHA256).Hash.ToLowerInvariant(); if ($hash -ne '${helperHash}') { throw 'Scratch helper identity mismatch' }; [IO.Directory]::Delete('${directory}',$true) }; [Console]::WriteLine('CLEANED ${directory}')`;
		const response = await runPowerShell(source);
		report({ stage: "cleanup-owned", response });
		if (response["exitCode"] !== 0) throw new Error("Owned scratch cleanup failed");
		return;
	}
	if (process.argv[2] === "--audit") {
		const source = String.raw`$ErrorActionPreference='Stop'
$directories=@(Get-ChildItem 'C:\Users\Public' -Directory -Filter 'opencua-windows-live-*' | ForEach-Object {
 @{path=$_.FullName;created=$_.CreationTimeUtc.ToString('o');files=@(Get-ChildItem $_.FullName | Select-Object -ExpandProperty Name)}
})
$userScratch=@(Get-ChildItem 'C:\Users' -Directory | ForEach-Object {
 $temp=Join-Path $_.FullName 'AppData\Local\Temp'
 if ([IO.Directory]::Exists($temp)) {
  Get-ChildItem $temp -Directory -Filter 'opencua-windows-live-*' | ForEach-Object {
   @{path=$_.FullName;files=@(Get-ChildItem $_.FullName | ForEach-Object { @{name=$_.Name;content=[IO.File]::ReadAllText($_.FullName)} })}
  }
 }
})
$processes=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('notepad.exe','powershell.exe') } |
 Select-Object ProcessId,ParentProcessId,Name)
ConvertTo-Json -InputObject @{directories=$directories;userScratch=$userScratch;processes=$processes} -Depth 8 -Compress`;
		report({ stage: "audit", response: await runPowerShell(source) });
		return;
	}
	await readiness();
	let guestProcess: number | undefined;
	let exited = false;
	try {
		report({ stage: "scratch", guestScratch });
		await upload("helper.ps1", `$PhysicalAllowed=$false; $WmCharAllowed=$false;\n${windowsHelperScript}`);
		await upload("driver.ps1", liveChild());
		const encoded = liveCommand();
		report({ stage: "launch", vmId, executable: powershell, encodedCommandCharacters: encoded.length });
		if (encoded.length > 30_000) throw new Error("Guest parent command exceeds safe Windows command-line length");
		guestProcess = await launch(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded]);
		report({ stage: "guest-process", id: guestProcess });
		try {
			const response = await collect(guestProcess, Date.now() + 300_000);
			exited = true;
			report({ stage: "live-result", id: guestProcess, response });
			if (response["exitCode"] !== 0 || !String(response["outputText"]).includes('"ok":true')) {
				throw new Error("Windows live verification failed; see captured guest output");
			}
		} catch (error) {
			report({ stage: "collection-error", error: error instanceof Error ? error.message : String(error) });
			const response = await runPowerShell(
				`$ErrorActionPreference='Stop'; $p='${guestScratch}\\result.json'; if ([IO.File]::Exists($p)) { [Console]::WriteLine([IO.File]::ReadAllText($p)) } else { $e='${guestScratch}\\native-errors.txt'; if ([IO.File]::Exists($e)) { [Console]::WriteLine([IO.File]::ReadAllText($e)) }; exit 1 }`,
			);
			report({ stage: "persisted-live-result", response });
			if (response["exitCode"] !== 0 || !String(response["outputText"]).includes('"ok":true')) throw error;
		}
	} finally {
		interrupted = false;
		try {
			if (guestProcess !== undefined && !exited) {
				const id = await launch("taskkill.exe", ["/PID", String(guestProcess), "/T", "/F"]);
				report({ stage: "terminate", response: await collect(id, Date.now() + 30_000) });
			}
		} finally {
			const response = await runPowerShell(
				`$ErrorActionPreference='Stop'; if ([IO.Directory]::Exists('${guestScratch}')) { [IO.Directory]::Delete('${guestScratch}',$true) }; [Console]::WriteLine('CLEANED ${guestScratch}')`,
			);
			report({ stage: "cleanup", response });
			if (response["exitCode"] !== 0) {
				report({ stage: "cleanup-error", guestScratch });
				process.exitCode = 1;
			}
		}
	}
}

main().catch((error: unknown) => {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
