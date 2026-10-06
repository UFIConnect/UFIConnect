using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Threading.Tasks;

namespace UfiConnect.Vpn {
  internal static class Platform {
    internal const string Tunnel = "UFIConnectManaged";
    internal const string Service = "WireGuardTunnel$" + Tunnel;
    internal static readonly string DataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"UFIConnectVPN");
    internal static readonly string ConfigFile = Path.Combine(DataDirectory,Tunnel + ".conf.dpapi");
    internal static readonly string WatchFile = Path.Combine(DataDirectory,"watch.json");
    internal static readonly string OwnerFile = Path.Combine(DataDirectory,"owner");
    internal static readonly string WireGuard = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"WireGuard","wireguard.exe");
    internal static readonly string Wg = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"WireGuard","wg.exe");
    internal static bool Administrator { get { return new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator); } }
    internal static long Monotonic { get { return unchecked((long)GetTickCount64()); } }
    [DllImport("kernel32.dll")] private static extern ulong GetTickCount64();
    internal static void SafeDirectory(string directory) {
      var current = new DirectoryInfo(directory);
      for (var item = current; item != null; item = item.Parent) if (item.Exists && (item.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("VPN storage cannot use a linked directory.");
      var acl = new DirectorySecurity(); acl.SetAccessRuleProtection(true,false);
      acl.SetOwner(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid,null));
      foreach (var sid in new[] { WellKnownSidType.BuiltinAdministratorsSid, WellKnownSidType.LocalSystemSid })
        acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid,null),FileSystemRights.FullControl,InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
      if(Directory.Exists(directory)) {
        var owner=Directory.GetAccessControl(directory).GetOwner(typeof(SecurityIdentifier));
        if(!owner.Equals(WindowsIdentity.GetCurrent().User)&&!owner.Equals(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid,null))
          &&!owner.Equals(new SecurityIdentifier(WellKnownSidType.LocalSystemSid,null)))throw new IOException("VPN storage has an unexpected owner.");
        Directory.SetAccessControl(directory,acl);
      } else Directory.CreateDirectory(directory,acl);
    }
    internal static void WriteFile(string file, byte[] bytes) {
      SafeDirectory(Path.GetDirectoryName(file));
      if (File.Exists(file) && (File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) throw new IOException("VPN storage cannot use a linked file.");
      var temp = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
      try {
        File.WriteAllBytes(temp,bytes);
        var acl=new FileSecurity();acl.SetAccessRuleProtection(true,false);acl.SetOwner(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid,null));
        foreach(var sid in new[]{WellKnownSidType.BuiltinAdministratorsSid,WellKnownSidType.LocalSystemSid})
          acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid,null),FileSystemRights.FullControl,AccessControlType.Allow));
        File.SetAccessControl(temp,acl);
        if (File.Exists(file)) File.Replace(temp,file,null); else File.Move(temp,file);
        File.SetAccessControl(file,acl);
      }
      finally { if (File.Exists(temp)) File.Delete(temp); }
    }
    internal static void StoreSecrets(string token, string privateKey) {
      var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"UFIConnectVPN");
      var bytes = Encoding.UTF8.GetBytes(Json.Encode(new { token = token, privateKey = privateKey }));
      try { WriteFile(Path.Combine(directory,"session.dpapi"),ProtectedData.Protect(bytes,null,DataProtectionScope.CurrentUser)); }
      finally { Array.Clear(bytes,0,bytes.Length); }
    }
    internal static void ClearSecrets() {
      var file = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"UFIConnectVPN","session.dpapi");
      if (File.Exists(file)) File.Delete(file);
    }
    // WireGuard's .conf.dpapi reader requires the tunnel name as DPAPI description.
    // Machine scope lets its LocalSystem service decrypt; the directory ACL limits access.
    internal static void WriteConfiguration(string configuration) {
      var bytes = Encoding.UTF8.GetBytes(configuration); var input = new Blob(); var output = new Blob();
      try {
        input.Size = bytes.Length; input.Data = Marshal.AllocHGlobal(bytes.Length); Marshal.Copy(bytes,0,input.Data,bytes.Length);
        if (!CryptProtectData(ref input,Tunnel,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,5,out output)) throw new Win32Exception();
        var encrypted = new byte[output.Size]; Marshal.Copy(output.Data,encrypted,0,encrypted.Length); WriteFile(ConfigFile,encrypted);
      } finally { if (input.Data != IntPtr.Zero) { for(int i=0;i<input.Size;i++) Marshal.WriteByte(input.Data,i,0); Marshal.FreeHGlobal(input.Data); } if(output.Data!=IntPtr.Zero) LocalFree(output.Data); Array.Clear(bytes,0,bytes.Length); }
    }
    [StructLayout(LayoutKind.Sequential)] private struct Blob { internal int Size; internal IntPtr Data; }
    [DllImport("crypt32.dll",CharSet=CharSet.Unicode,SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptProtectData(ref Blob input,string description,IntPtr entropy,IntPtr reserved,IntPtr prompt,int flags,out Blob output);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr value);

    internal static void VerifyTools() { VerifySignature(WireGuard); VerifySignature(Wg); }
    internal static void VerifySignature(string file) {
      if (!File.Exists(file)) throw new InvalidOperationException("Install the official WireGuard for Windows app first, then reopen UFIConnect VPN.");
      for (var item = new FileInfo(file).Directory; item != null; item = item.Parent) if ((item.Attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("WireGuard must use its standard installation directory.");
      if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("WireGuard executable cannot be a link.");
      var info = new TrustFile(file); var trust = new TrustData(info); var action = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");
      try { if (WinVerifyTrust(new IntPtr(-1),ref action,trust) != 0) throw new InvalidOperationException("WireGuard signature verification failed. Reinstall it from wireguard.com."); }
      finally { trust.Dispose(); info.Dispose(); }
      using (var certificate = new X509Certificate2(X509Certificate.CreateFromSignedFile(file))) {
        if (certificate.GetNameInfo(X509NameType.SimpleName,false) != "WireGuard LLC") throw new InvalidOperationException("Unexpected WireGuard publisher.");
      }
    }
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] private sealed class TrustFile : IDisposable {
      internal uint Size=(uint)Marshal.SizeOf(typeof(TrustFile)); internal IntPtr Path; internal IntPtr File=IntPtr.Zero, Subject=IntPtr.Zero;
      internal TrustFile(string path) { Path=Marshal.StringToCoTaskMemUni(path); }
      public void Dispose() { Marshal.FreeCoTaskMem(Path); }
    }
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] private sealed class TrustData : IDisposable {
      internal uint Size=(uint)Marshal.SizeOf(typeof(TrustData)); internal IntPtr Policy=IntPtr.Zero,Sip=IntPtr.Zero;
      internal uint Ui=2,Revocation=1,Choice=1; internal IntPtr File; internal uint Action=0; internal IntPtr State=IntPtr.Zero,Url=IntPtr.Zero; internal uint Flags=0x80,Context=0;
      internal TrustData(TrustFile file) { File=Marshal.AllocHGlobal(Marshal.SizeOf(file));Marshal.StructureToPtr(file,File,false); }
      public void Dispose(){Marshal.DestroyStructure(File,typeof(TrustFile));Marshal.FreeHGlobal(File);}
    }
    [DllImport("wintrust.dll",ExactSpelling=true)] private static extern uint WinVerifyTrust(IntPtr window,ref Guid action,[In,Out] TrustData data);
    internal static async Task<string> Run(string file,string arguments,string input) {
      using (var process = new Process { StartInfo = new ProcessStartInfo(file,arguments) { UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,RedirectStandardInput=true } }) {
        if (!process.Start()) throw new InvalidOperationException("Could not start WireGuard.");
        var stdout=process.StandardOutput.ReadToEndAsync(); var stderr=process.StandardError.ReadToEndAsync();
        if(input!=null) await process.StandardInput.WriteAsync(input).ConfigureAwait(false); process.StandardInput.Close();
        if(!await Task.Run(()=>process.WaitForExit(10000)).ConfigureAwait(false)){try{process.Kill();}catch{}throw new System.TimeoutException("WireGuard operation timed out.");}
        await stderr.ConfigureAwait(false); var text=await stdout.ConfigureAwait(false);
        if(process.ExitCode!=0||text.Length>65536)throw new InvalidOperationException("WireGuard could not complete the operation.");
        return text.Trim();
      }
    }
    internal static bool ServiceExists() { try { using(var service=new ServiceController(Service)){var ignored=service.Status;return true;} }catch(InvalidOperationException){return false;} }
    internal static bool ServiceRunning() { try { using(var service=new ServiceController(Service)) return service.Status==ServiceControllerStatus.Running; }catch(InvalidOperationException){return false;} }
    internal static void DemandStart() { WithService(2,handle=>{if(!ChangeServiceConfig(handle,0xffffffff,3,0xffffffff,null,null,IntPtr.Zero,null,null,null,null))throw new Win32Exception();}); }
    internal static void StopOwnedTunnel() {
      if(!File.Exists(OwnerFile))return;
      if(ServiceExists()) {
        using(var service=new ServiceController(Service)){if(service.Status!=ServiceControllerStatus.Stopped){service.Stop();service.WaitForStatus(ServiceControllerStatus.Stopped,TimeSpan.FromSeconds(8));}}
        WithService(0x10000,handle=>{if(!DeleteService(handle))throw new Win32Exception();});
      }
      if(File.Exists(ConfigFile))File.Delete(ConfigFile);
      if(File.Exists(WatchFile))File.Delete(WatchFile);
    }
    private static void WithService(uint access,Action<IntPtr> work) {
      var manager=OpenSCManager(null,null,1);if(manager==IntPtr.Zero)throw new Win32Exception();
      try{var service=OpenService(manager,Service,access);if(service==IntPtr.Zero)throw new Win32Exception();try{work(service);}finally{CloseServiceHandle(service);}}finally{CloseServiceHandle(manager);}
    }
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern IntPtr OpenSCManager(string machine,string database,uint access);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern IntPtr OpenService(IntPtr manager,string name,uint access);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool ChangeServiceConfig(IntPtr service,uint type,uint start,uint error,string binary,string group,IntPtr tag,string deps,string account,string password,string display);
    [DllImport("advapi32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool DeleteService(IntPtr service);
    [DllImport("advapi32.dll")] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool CloseServiceHandle(IntPtr service);
  }
}
