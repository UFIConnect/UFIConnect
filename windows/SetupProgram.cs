using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace UfiConnect.Vpn {
  internal static class SetupPolicy {
    internal const string Url="https://download.wireguard.com/windows-client/wireguard-amd64-1.1.1.msi";
    internal const string MsiHash="7bfed60ad61b785c914b38b61555a975488e1d3ec472dbfb2fcdf498fca75242";
    internal static void ValidateUrl(string value){if(value!=Url)throw new InvalidDataException("The WireGuard download address did not match the pinned release.");}
    internal static void ValidatePackage(string hash,bool trusted,string publisher){
      if(!String.Equals(hash,MsiHash,StringComparison.OrdinalIgnoreCase)||!trusted||publisher!="WireGuard LLC")throw new InvalidDataException("WireGuard package verification failed. Installation was cancelled.");
    }
    internal static string Hash(string path){using(var stream=File.OpenRead(path))using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant();}
    internal static bool Within(string root,string target){
      var directory=Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
      return Path.GetFullPath(target).StartsWith(directory,StringComparison.OrdinalIgnoreCase);
    }
    internal static void InstallOnlyIfApproved(bool approved,Action verify,Action install){if(!approved)return;verify();install();}
    internal static void PublicDirectory(string directory){
      for(var item=new DirectoryInfo(directory);item!=null;item=item.Parent)if(item.Exists&&(item.Attributes&FileAttributes.ReparsePoint)!=0)throw new IOException("Installation cannot use linked directories.");
      if(Directory.Exists(directory)){
        var owner=Directory.GetAccessControl(directory).GetOwner(typeof(SecurityIdentifier));
        if(!owner.Equals(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid,null))&&!owner.Equals(new SecurityIdentifier(WellKnownSidType.LocalSystemSid,null)))throw new IOException("Installation directory has an unexpected owner.");
      }
      var acl=new DirectorySecurity();acl.SetAccessRuleProtection(true,false);acl.SetOwner(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid,null));
      foreach(var sid in new[]{WellKnownSidType.BuiltinAdministratorsSid,WellKnownSidType.LocalSystemSid})
        acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid,null),FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
      acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid,null),FileSystemRights.ReadAndExecute,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
      if(Directory.Exists(directory))Directory.SetAccessControl(directory,acl);else Directory.CreateDirectory(directory,acl);
    }
    internal static void PublicFileOwner(string file){var acl=File.GetAccessControl(file);acl.SetOwner(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid,null));File.SetAccessControl(file,acl);}
  }
  internal static class SetupProgram {
    [STAThread] private static int Main(){
      Application.EnableVisualStyles();
      if(!Environment.Is64BitOperatingSystem||!Platform.Administrator){MessageBox.Show("Setup needs Windows x64 and administrator permission.","UFIConnect VPN setup");return 1;}
      var approved=MessageBox.Show("Install UFIConnect VPN and its official WireGuard prerequisite?\n\nSetup downloads the pinned WireGuard 1.1.1 release, verifies its trusted WireGuard LLC signature and checksum, and creates a Start menu shortcut. No tunnel is started and no account credentials are requested.\n\nThis UFIConnect validation build is unsigned. Continue only if you trust its source.","UFIConnect VPN setup",MessageBoxButtons.YesNo,MessageBoxIcon.Question)==DialogResult.Yes;
      if(!approved)return 0;
      try{
        var result=Task.Run(()=>Install()).GetAwaiter().GetResult();
        MessageBox.Show("UFIConnect VPN is installed. Open it from the Start menu and sign in to connect."+(result==3010?"\nWindows requests a restart to finish the WireGuard installation.":""),"UFIConnect VPN setup");return 0;
      }catch(Exception){MessageBox.Show("Installation could not be verified or completed. No VPN tunnel was started. Check your connection and administrator access, then try again. Keep the complete setup folder together.","UFIConnect VPN setup",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;}
    }
    private static async Task<int> Install(){
      var bundle=Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
      var payload=Path.Combine(bundle,"UFIConnectVpn.exe");
      if(!SetupPolicy.Within(bundle,payload)||!File.Exists(payload)||(File.GetAttributes(payload)&FileAttributes.ReparsePoint)!=0
        ||!String.Equals(SetupPolicy.Hash(payload),SetupHashes.ClientHash,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Client payload did not match this setup build.");
      // Do not replace a running app or change an existing UFIConnect tunnel.
      if(Process.GetProcessesByName("UFIConnectVpn").Length>0||Platform.ServiceRunning())throw new InvalidOperationException("Close UFIConnect VPN before installing.");
      var exit=0;bool installed=File.Exists(Platform.WireGuard)&&File.Exists(Platform.Wg);
      if(installed)Platform.VerifyTools();
      if(!installed){
        var cache=Path.Combine(Platform.DataDirectory,"setup");Platform.SafeDirectory(Platform.DataDirectory);Platform.SafeDirectory(cache);
        var msi=Path.Combine(cache,"wireguard-amd64-1.1.1.msi");SetupPolicy.ValidateUrl(SetupPolicy.Url);
        ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;
        using(var client=new HttpClient(new HttpClientHandler{AllowAutoRedirect=false,UseCookies=false}){Timeout=TimeSpan.FromMinutes(3)})
        using(var response=await client.GetAsync(SetupPolicy.Url,HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false)){
          response.EnsureSuccessStatusCode();
          using(var cancellation=new System.Threading.CancellationTokenSource(TimeSpan.FromMinutes(3)))
          using(var stream=await response.Content.ReadAsStreamAsync().ConfigureAwait(false))using(var output=new MemoryStream()){
            var buffer=new byte[16384];int count;
            while((count=await stream.ReadAsync(buffer,0,buffer.Length,cancellation.Token).ConfigureAwait(false))>0){if(output.Length+count>20000000)throw new InvalidDataException("Unexpected WireGuard package size.");output.Write(buffer,0,count);}
            if(output.Length<100000)throw new InvalidDataException("Unexpected WireGuard package size.");Platform.WriteFile(msi,output.ToArray());
          }
        }
        var hash=SetupPolicy.Hash(msi);
        // The Windows trust API validates the chain/timestamp and exact publisher.
        Process installer=null;
        SetupPolicy.InstallOnlyIfApproved(true,()=>{Platform.VerifySignature(msi);SetupPolicy.ValidatePackage(hash,true,"WireGuard LLC");},()=>{
          installer=Process.Start(new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"msiexec.exe"),
            "/i \""+msi+"\" /passive /norestart DO_NOT_LAUNCH=1"){UseShellExecute=false,CreateNoWindow=true});
        });
        using(var process=installer){
          if(process==null)throw new InvalidOperationException("Could not start installer.");await Task.Run(()=>process.WaitForExit()).ConfigureAwait(false);exit=process.ExitCode;
          if(exit!=0&&exit!=3010)throw new InvalidOperationException("WireGuard installation failed.");
        }
        Platform.VerifyTools();File.Delete(msi);
      }
      var destination=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"UFIConnect VPN");SetupPolicy.PublicDirectory(destination);
      var target=Path.Combine(destination,"UFIConnectVpn.exe");
      if(!SetupPolicy.Within(destination,target)||(File.Exists(target)&&(File.GetAttributes(target)&FileAttributes.ReparsePoint)!=0))throw new IOException("Unsafe installation path.");
      var bytes=File.ReadAllBytes(payload);
      using(var sha=SHA256.Create())if(!String.Equals(BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-",""),SetupHashes.ClientHash,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Client payload changed.");
      var staging=Path.Combine(destination,Guid.NewGuid().ToString("N")+".tmp");
      try{File.WriteAllBytes(staging,bytes);SetupPolicy.PublicFileOwner(staging);if(File.Exists(target))File.Replace(staging,target,null);else File.Move(staging,target);SetupPolicy.PublicFileOwner(target);}
      finally{if(File.Exists(staging))File.Delete(staging);}
      var shortcuts=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms),"UFIConnect");SetupPolicy.PublicDirectory(shortcuts);
      var shortcut=Path.Combine(shortcuts,"UFIConnect VPN.lnk");if(File.Exists(shortcut)&&(File.GetAttributes(shortcut)&FileAttributes.ReparsePoint)!=0)throw new IOException("Unsafe shortcut path.");
      var shellType=Type.GetTypeFromProgID("WScript.Shell");var shell=Activator.CreateInstance(shellType);
      var link=shellType.InvokeMember("CreateShortcut",BindingFlags.InvokeMethod,null,shell,new object[]{shortcut});
      var linkType=link.GetType();linkType.InvokeMember("TargetPath",BindingFlags.SetProperty,null,link,new object[]{target});
      linkType.InvokeMember("WorkingDirectory",BindingFlags.SetProperty,null,link,new object[]{destination});
      linkType.InvokeMember("Description",BindingFlags.SetProperty,null,link,new object[]{"UFIConnect VPN"});linkType.InvokeMember("Save",BindingFlags.InvokeMethod,null,link,null);
      SetupPolicy.PublicFileOwner(shortcut);return exit;
    }
  }
}
