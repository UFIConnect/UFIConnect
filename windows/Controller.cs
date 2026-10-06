using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace UfiConnect.Vpn {
  internal sealed class Controller : IDisposable {
    private readonly Api api=new Api();
    private readonly SemaphoreSlim gate=new SemaphoreSlim(1,1);
    private string token,privateKey,publicKey;
    private Lease lease;
    private long deadline;
    private int generation;
    private Process watcher;
    private readonly string nonce=Guid.NewGuid().ToString("N");
    private long renewedAt;
    private bool renewing;
    private Task renewalTask;
    internal bool SignedIn { get { return token!=null; } }
    internal bool Active { get { return lease!=null; } }
    internal string Message="Sign in with your UFIConnect email and password.";
    internal async Task Login(string email,string password) {
      if(Active)throw new InvalidOperationException("Disconnect before changing account.");
      var result=await api.Request("POST","/auth/login",null,new{email=email,password=password});
      var value=Json.Text(result,"token");if(value.Length<20||value.Length>16384)throw new InvalidDataException("Invalid sign-in response.");
      token=value;Platform.StoreSecrets(token,null);Message="Signed in. Connect requires an active paid UFI Vault membership.";
    }
    internal async Task Connect() {
      await gate.WaitAsync();var attempt=Interlocked.Increment(ref generation);string enrolled=null;
      Exception failure=null;
      try{try{
        if(token==null)throw new InvalidOperationException("Sign in first.");
        if(Active)throw new InvalidOperationException("VPN is already starting or connected.");
        await Task.Run(()=>Platform.VerifyTools());
        var available=await api.Request("GET","/vpn/config",token,null);
        object ready;if(!available.TryGetValue("available",out ready)||!Object.Equals(ready,true))throw new InvalidOperationException("UFIConnect VPN gateway setup is pending.");
        if(attempt!=generation)throw new OperationCanceledException();
        if(Platform.ServiceExists()){
          if(!File.Exists(Platform.OwnerFile))throw new InvalidOperationException("A tunnel named UFIConnectManaged already exists. Resolve it in WireGuard before connecting.");
          await Task.Run(()=>Platform.StopOwnedTunnel());
        }
        privateKey=await Platform.Run(Platform.Wg,"genkey",null);
        if(!Lease.KeyValid(privateKey))throw new InvalidDataException("Could not create a local VPN key.");
        publicKey=await Platform.Run(Platform.Wg,"pubkey",privateKey+"\n");
        if(!Lease.KeyValid(publicKey))throw new InvalidDataException("Could not create a local VPN key.");
        Platform.StoreSecrets(token,privateKey);
        var response=await api.Request("POST","/vpn/devices",token,new{publicKey=publicKey,label="UFIConnect Windows"});
        if(Json.Text(response,"state")!="enrolled")throw new InvalidDataException("VPN enrollment was not accepted.");
        var data=response["device"] as Dictionary<string,object>;
        if(data!=null)enrolled=Json.Text(data,"deviceId");
        var next=Lease.Read(data,publicKey,DateTime.UtcNow);
        if(attempt!=generation)throw new OperationCanceledException();
        Platform.WriteConfiguration(next.Configuration(privateKey));
        Platform.WriteFile(Platform.OwnerFile,Encoding.UTF8.GetBytes("UFIConnect managed VPN v1"));
        lease=next;deadline=Platform.Monotonic+(long)(next.Expires-DateTime.UtcNow).TotalMilliseconds;renewedAt=Platform.Monotonic;
        Heartbeat();
        watcher=Process.Start(new ProcessStartInfo(System.Reflection.Assembly.GetExecutingAssembly().Location,
          "--watchdog "+Process.GetCurrentProcess().Id+" "+Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks+" "+nonce){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden});
        await Platform.Run(Platform.WireGuard,"/installtunnelservice \""+Platform.ConfigFile+"\"",null);
        await Task.Run(()=>Platform.DemandStart());
        if(attempt!=generation||watcher==null||watcher.HasExited)throw new OperationCanceledException();
        Message="Connecting. Waiting for a WireGuard handshake.";
      }catch(Exception error){failure=error;}
      if(failure!=null){
        try{await Task.Run(()=>Platform.StopOwnedTunnel());}catch{Message="Windows could not confirm disconnection. Stop UFIConnectManaged in WireGuard.";}
        lease=null;deadline=0;privateKey=null;publicKey=null;Platform.ClearSecrets();
        if(enrolled!=null)try{await api.Request("DELETE","/vpn/devices/"+enrolled,token,null);}catch{}
        throw failure;
      }}finally{gate.Release();}
    }
    private void Heartbeat(){
      if(lease==null)return;
      Platform.WriteFile(Platform.WatchFile,Encoding.UTF8.GetBytes(Json.Encode(new{nonce=nonce,parent=Process.GetCurrentProcess().Id,
        parentStart=Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks,expires=lease.Expires.ToString("o"),deadline=deadline,heartbeat=Platform.Monotonic})));
    }
    internal async Task Tick() {
      if(lease==null)return;
      if(Health.Expired(deadline,Platform.Monotonic,lease.Expires,DateTime.UtcNow)||watcher==null||watcher.HasExited){
        await Disconnect();Message="VPN stopped because its authorization or local watchdog expired.";return;
      }
      Heartbeat();
      if(!renewing&&Platform.Monotonic-renewedAt>=30000){renewing=true;renewalTask=Renew();}
      if(renewalTask!=null&&renewalTask.IsFaulted){var ignored=renewalTask.Exception;}
      var current=lease;if(current==null)return;
      var output=await Platform.Run(Platform.Wg,"show "+Platform.Tunnel+" latest-handshakes",null);
      var line=output.Split('\n').FirstOrDefault(value=>value.StartsWith(current.ServerKey+"\t",StringComparison.Ordinal));
      long seconds=0;if(line!=null)long.TryParse(line.Substring(current.ServerKey.Length+1).Trim(),out seconds);
      var handshake=seconds>0&&seconds<253402300799L?new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc).AddSeconds(seconds):DateTime.MinValue;
      if(lease==current)Message=Health.Connected(Platform.ServiceRunning(),current.Expires,handshake,DateTime.UtcNow)?"Connected · WireGuard handshake verified":"Connecting · no recent handshake yet";
    }
    private async Task Renew(){
      await gate.WaitAsync();var attempt=generation;var current=lease;
      string stopMessage=null;
      try{try{
        if(current==null)return;
        var result=await api.Request("POST","/vpn/devices",token,new{publicKey=current.PublicKey,label="UFIConnect Windows",gatewayId=current.Gateway});
        if(Json.Text(result,"state")!="enrolled")throw new InvalidDataException("VPN renewal failed.");
        var next=Lease.Read(result["device"] as Dictionary<string,object>,current.PublicKey,DateTime.UtcNow);
        if(attempt!=generation||lease!=current)return;
        if(!current.SameTunnel(next))throw new InvalidDataException("VPN gateway configuration changed. Reconnect.");
        lease=next;deadline=Platform.Monotonic+(long)(next.Expires-DateTime.UtcNow).TotalMilliseconds;renewedAt=Platform.Monotonic;Heartbeat();
      }catch(ApiError error){
        if(error.Status==401||error.Status==403||error.Status==409)stopMessage="VPN authorization ended. Sign in and reconnect.";
        else{Message="VPN renewal is temporarily unavailable. Authorization remains time limited.";renewedAt=Platform.Monotonic;}
      }
      catch(InvalidDataException){stopMessage="VPN configuration changed. Reconnect.";}
      catch{Message="VPN renewal is temporarily unavailable. Authorization will expire shortly.";renewedAt=Platform.Monotonic;}
      if(stopMessage!=null){Interlocked.Increment(ref generation);await StopLocal();Message=stopMessage;}
      }finally{renewing=false;gate.Release();}
    }
    private async Task StopLocal(){await Task.Run(()=>Platform.StopOwnedTunnel());lease=null;deadline=0;privateKey=null;publicKey=null;Platform.ClearSecrets();}
    internal async Task Disconnect(){
      Interlocked.Increment(ref generation);var current=lease;
      // Stop the OS tunnel before waiting for an in-flight network request.
      await StopLocal();
      await gate.WaitAsync();
      try{
        if(current!=null&&token!=null)try{await api.Request("DELETE","/vpn/devices/"+current.Id,token,null);}catch{Message="Disconnected. Server removal could not be confirmed; the previous authorization expires within five minutes.";return;}
        Message="Disconnected.";
      }finally{gate.Release();}
    }
    internal async Task Logout(){await Disconnect();var old=token;token=null;Platform.ClearSecrets();if(old!=null)try{await api.Request("POST","/auth/logout",old,null);}catch{}Message="Signed out.";}
    public void Dispose(){api.Dispose();gate.Dispose();if(watcher!=null)watcher.Dispose();}
  }
  internal static class Watchdog {
    internal static int Run(string[] args){
      int parent;long born;if(args.Length!=4||!int.TryParse(args[1],out parent)||!long.TryParse(args[2],out born)||!System.Text.RegularExpressions.Regex.IsMatch(args[3],"^[a-f0-9]{32}$"))return 2;
      try{
        using(var process=Process.GetProcessById(parent)){
          while(true){
            if(process.HasExited||process.StartTime.ToUniversalTime().Ticks!=born)break;
            var data=Json.Decode(File.ReadAllText(Platform.WatchFile));
            // A newer app instance owns a different watch nonce. Never stop its tunnel.
            if(Json.Text(data,"nonce")!=args[3])return 0;
            var deadline=Convert.ToInt64(data["deadline"],CultureInfo.InvariantCulture);
            var heartbeat=Convert.ToInt64(data["heartbeat"],CultureInfo.InvariantCulture);
            var expiry=DateTime.Parse(Json.Text(data,"expires"),CultureInfo.InvariantCulture,DateTimeStyles.RoundtripKind).ToUniversalTime();
            if(Json.Text(data,"nonce")!=args[3]||Convert.ToInt32(data["parent"])!=parent||Convert.ToInt64(data["parentStart"])!=born
              ||heartbeat>Platform.Monotonic||Platform.Monotonic-heartbeat>12000||deadline-Platform.Monotonic>360000
              ||Health.Expired(deadline,Platform.Monotonic,expiry,DateTime.UtcNow))break;
            Thread.Sleep(1000);
          }
        }
      }catch{}
      // Retry service stop independently of UI/network availability.
      for(int attempt=0;attempt<3;attempt++){try{Platform.StopOwnedTunnel();return 0;}catch{Thread.Sleep(1000);}}
      return 1;
    }
  }
}
