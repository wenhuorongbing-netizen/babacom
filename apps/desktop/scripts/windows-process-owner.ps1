param([Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$OwnerProcessId)

$ErrorActionPreference = 'Stop'
$owner = $null
try {
    # Open the actual process before compiling, so PID reuse cannot change ownership.
    $owner = [Diagnostics.Process]::GetProcessById($OwnerProcessId)
    $ownerHandle = $owner.Handle
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class BabaComProcessOwner {
    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimits {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters {
        public ulong ReadOperations, WriteOperations, OtherOperations;
        public ulong ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimits {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, IntPtr name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int informationClass, IntPtr information, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);

    public static void Run(IntPtr owner) {
        // This helper is started BEFORE its owner joins the job. It stays outside
        // that job and holds the sole, unnamed, non-inheritable job handle.
        IntPtr job = CreateJobObject(IntPtr.Zero, IntPtr.Zero);
        if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            var limits = new ExtendedLimits();
            limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE; no breakaway.
            int size = Marshal.SizeOf(limits);
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try {
                Marshal.StructureToPtr(limits, buffer, false);
                if (!SetInformationJobObject(job, 9, buffer, (uint)size))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
            } finally { Marshal.FreeHGlobal(buffer); }
            if (!AssignProcessToJobObject(job, owner))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            // Resource allocation is gated on this acknowledgement. Every child
            // subsequently created by the worker inherits the job, including
            // Electron descendants after Playwright's cmd.exe wrapper exits.
            Console.Out.WriteLine("BABACOM_PROCESS_OWNER_READY");
            Console.Out.Flush();
            if (WaitForSingleObject(owner, 0xffffffff) != 0)
                throw new Win32Exception(Marshal.GetLastWin32Error());
        } finally {
            // Worker exit (normal or forced), or helper death, closes this handle.
            // Windows then terminates the entire owned job without a PID scan.
            if (!CloseHandle(job)) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
    }
}
'@
    [BabaComProcessOwner]::Run($ownerHandle)
} catch {
    [Console]::Error.WriteLine('PROCESS_OWNER_FAILED')
    exit 1
} finally {
    if ($null -ne $owner) { $owner.Dispose() }
}
