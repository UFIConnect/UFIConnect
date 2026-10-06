using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace UfiConnect.Vpn {
  internal static class LaunchPolicy {
    internal const string Prefix="uficonnect-vpn://connect?code=";
    internal static string Code(string uri) {
      if(uri==null||!Regex.IsMatch(uri,"\\Auficonnect-vpn://connect\\?code=[A-Za-z0-9_-]{43}\\z"))throw new InvalidDataException("This VPN connection link is invalid. Request a new link in UFIConnect.");
      var code=uri.Substring(Prefix.Length);
      var bytes=Convert.FromBase64String(code.Replace('-','+').Replace('_','/')+"=");
      if(bytes.Length!=32||Convert.ToBase64String(bytes).TrimEnd('=').Replace('+','-').Replace('/','_')!=code)throw new InvalidDataException("This VPN connection link is invalid.");
      return code;
    }
    internal static bool SameUser(SecurityIdentifier expected,SecurityIdentifier actual){return expected!=null&&expected.Equals(actual);}
    internal static string Arguments(string[] args,SecurityIdentifier current,bool administrator){
      if(args.Length==0)return "";
      if(args.Length==1){Code(args[0]);return args[0];}
      if((args.Length==2||args.Length==3)&&args[0]=="--elevated-owner"&&administrator){
        SecurityIdentifier requested;try{requested=new SecurityIdentifier(args[1]);}catch(ArgumentException){throw new InvalidDataException("Invalid Windows user.");}
        if(!SameUser(current,requested))throw new InvalidDataException("Open UFIConnect VPN from an administrator Windows account. The browser and app must use the same Windows user.");
        if(args.Length==2)return "";Code(args[2]);return args[2];
      }
      throw new InvalidDataException("This VPN connection request is invalid.");
    }
    internal static string PipeName(SecurityIdentifier sid){return "UFIConnectVpn-"+sid.Value;}
    internal static PipeSecurity Security(SecurityIdentifier sid){
      var acl=new PipeSecurity();acl.SetAccessRuleProtection(true,false);acl.SetOwner(sid);
      acl.AddAccessRule(new PipeAccessRule(sid,PipeAccessRights.FullControl,AccessControlType.Allow));
      return acl;
    }
    internal static RawSecurityDescriptor Descriptor(SecurityIdentifier sid){
      // PipeSecurity's SystemAcl drops mandatory-label ACEs. Preserve the raw
      // medium label so this user's ordinary browser can reach the elevated GUI.
      // The protected DACL still grants access exclusively to that exact SID.
      return new RawSecurityDescriptor(Security(sid).GetSecurityDescriptorSddlForm(AccessControlSections.Owner|AccessControlSections.Access)+"S:(ML;;NW;;;ME)");
    }
    internal static string ProtocolCommand(string executable){
      if(String.IsNullOrEmpty(executable)||executable.IndexOfAny(new[]{'"','\r','\n'})>=0||!Path.IsPathRooted(executable))throw new InvalidDataException("Invalid installed executable.");
      return "\""+executable+"\" \"%1\"";
    }
  }
  internal sealed class LaunchInbox {
    private string code,account;
    private DateTime expiry;
    private readonly HashSet<string> seen=new HashSet<string>();
    private readonly Queue<string> order=new Queue<string>();
    internal bool Pending { get { return code!=null; } }
    internal bool Receive(string uri,string currentAccount,DateTime now){
      var value=LaunchPolicy.Code(uri);if(!seen.Add(value))return false;
      order.Enqueue(value);while(order.Count>64)seen.Remove(order.Dequeue());
      code=value;account=currentAccount;expiry=now.AddSeconds(180);return true;
    }
    internal string Take(string currentAccount,DateTime now){
      if(code==null)return null;
      if(now>=expiry||(account!=null&&account!=currentAccount)){Clear();return null;}
      if(currentAccount==null)return null;
      var value=code;Clear();return value;
    }
    internal void Clear(){code=null;account=null;expiry=DateTime.MinValue;}
  }
  internal sealed class StoredSession {
    internal readonly string Token,AccountId;
    internal StoredSession(string token,string accountId){Token=token;AccountId=accountId;}
  }
  internal static class SessionPolicy {
    internal static string Encode(string token,string accountId){
      Guid id;if(token==null||token.Length<20||token.Length>16384||!Guid.TryParse(accountId,out id))throw new InvalidDataException("Invalid saved sign-in.");
      return Json.Encode(new{token=token,accountId=accountId});
    }
    internal static StoredSession Read(string text){
      var data=Json.Decode(text);var token=Json.Text(data,"token");var account=Json.Text(data,"accountId");
      Encode(token,account);return new StoredSession(token,account);
    }
  }
  internal sealed class LaunchPipe : IDisposable {
    private readonly SecurityIdentifier owner=WindowsIdentity.GetCurrent().User;
    private readonly Action<string> receive;
    private readonly string name;
    private readonly object sync=new object();
    private NamedPipeServerStream active;
    private bool stopped;
    internal LaunchPipe(Action<string> handler):this(handler,LaunchPolicy.PipeName(WindowsIdentity.GetCurrent().User)){}
    internal LaunchPipe(Action<string> handler,string pipeName){receive=handler;name=pipeName;}
    internal Task Start(){return Task.Run((Action)Listen);}
    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes {internal int Length;internal IntPtr Descriptor;[MarshalAs(UnmanagedType.Bool)]internal bool Inherit;}
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
    private static extern SafePipeHandle CreateNamedPipe(string pipeName,uint mode,uint pipeMode,uint instances,uint outputBuffer,uint inputBuffer,uint timeout,ref SecurityAttributes attributes);
    private NamedPipeServerStream Create(){
      var descriptor=LaunchPolicy.Descriptor(owner);var bytes=new byte[descriptor.BinaryLength];descriptor.GetBinaryForm(bytes,0);
      var address=Marshal.AllocHGlobal(bytes.Length);
      try{
        Marshal.Copy(bytes,0,address,bytes.Length);
        var attributes=new SecurityAttributes{Length=Marshal.SizeOf(typeof(SecurityAttributes)),Descriptor=address,Inherit=false};
        // Duplex, overlapped, first instance; byte mode, local clients only.
        var handle=CreateNamedPipe(@"\\.\pipe\"+name,0x40080003,0x8,1,256,256,0,ref attributes);
        if(handle.IsInvalid){var error=Marshal.GetLastWin32Error();handle.Dispose();throw new Win32Exception(error);}
        try{return new NamedPipeServerStream(PipeDirection.InOut,true,false,handle);}catch{handle.Dispose();throw;}
      }finally{Marshal.FreeHGlobal(address);}
    }
    private void Listen(){
      while(true){
        NamedPipeServerStream pipe;
        lock(sync){if(stopped)return;pipe=Create();active=pipe;}
        try{
          pipe.WaitForConnection();
          // A stalled same-user client cannot hold the single instance forever.
          using(var timeout=new System.Threading.Timer(_=>{try{pipe.Dispose();}catch{}},null,3000,Timeout.Infinite)){
            var bytes=new byte[256];int size=0;
            while(size<bytes.Length){var value=pipe.ReadByte();if(value<0)throw new IOException();if(value=='\n')break;bytes[size++]=(byte)value;}
            if(size==bytes.Length)throw new InvalidDataException();
            var uri=Encoding.ASCII.GetString(bytes,0,size);if(uri.Length>0)LaunchPolicy.Code(uri);
            SecurityIdentifier sender=null;
            // Impersonate only to inspect the caller SID, never to perform I/O.
            pipe.RunAsClient(()=>sender=WindowsIdentity.GetCurrent(true).User);
            if(!LaunchPolicy.SameUser(owner,sender))throw new UnauthorizedAccessException();
            receive(uri);pipe.WriteByte(1);pipe.Flush();
          }
        }catch(IOException){}catch(UnauthorizedAccessException){}catch(ObjectDisposedException){}catch(System.Security.SecurityException){}catch(InvalidOperationException){}
        finally{pipe.Dispose();lock(sync){if(active==pipe)active=null;}}
      }
    }
    internal static bool Forward(string uri){return Forward(uri,LaunchPolicy.PipeName(WindowsIdentity.GetCurrent().User));}
    internal static bool Forward(string uri,string name){
      if(uri.Length>0)LaunchPolicy.Code(uri);
      try{
        using(var pipe=new NamedPipeClientStream(".",name,PipeDirection.InOut,PipeOptions.Asynchronous,TokenImpersonationLevel.Identification)){
          pipe.Connect(1000);
          using(var timeout=new System.Threading.Timer(_=>{try{pipe.Dispose();}catch{}},null,3000,Timeout.Infinite)){
            var bytes=Encoding.ASCII.GetBytes(uri+"\n");pipe.Write(bytes,0,bytes.Length);pipe.Flush();return pipe.ReadByte()==1;
          }
        }
      }catch(IOException){return false;}catch(TimeoutException){return false;}catch(UnauthorizedAccessException){return false;}catch(ObjectDisposedException){return false;}
    }
    public void Dispose(){lock(sync){stopped=true;if(active!=null)active.Dispose();}}
  }
}
