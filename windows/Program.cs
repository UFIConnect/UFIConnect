using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Security.Principal;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace UfiConnect.Vpn {
  internal static class Program {
    [STAThread] private static int Main(string[] args) {
      if(args.Length>0&&args[0]=="--watchdog")return Platform.Administrator?Watchdog.Run(args):2;
      string uri;
      var user=WindowsIdentity.GetCurrent().User;
      try{uri=LaunchPolicy.Arguments(args,user,Platform.Administrator);}
      catch(InvalidDataException error){MessageBox.Show(error.Message,"UFIConnect VPN");return 2;}
      // Forward before requesting elevation: an open app needs no further UAC.
      if(LaunchPipe.Forward(uri))return 0;
      if(!Platform.Administrator){
        try{
          // Elevate this fixed executable only. The validated URI is an argument,
          // never a command, shell expression, or executable path.
          Process.Start(new ProcessStartInfo(System.Reflection.Assembly.GetExecutingAssembly().Location,
            "--elevated-owner "+user.Value+(uri.Length==0?"":" \""+uri+"\"")){UseShellExecute=true,Verb="runas",WindowStyle=ProcessWindowStyle.Normal});return 0;
        }catch{MessageBox.Show("Administrator permission is needed to manage the VPN tunnel. Open UFIConnect VPN to try again.","UFIConnect VPN");return 1;}
      }
      bool created;
      using(var mutex=new Mutex(true,"Global\\UFIConnectManagedVpn",out created)){
        if(!created){
          // Another launch may still be constructing this user's window.
          for(var attempt=0;attempt<3;attempt++)if(LaunchPipe.Forward(uri))return 0;
          MessageBox.Show("The VPN app is starting or belongs to another Windows user. Use the open app, or close it before switching Windows users.","UFIConnect VPN");return 1;
        }
        Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
        try{
          Platform.SafeDirectory(Platform.DataDirectory);
          if(File.Exists(Platform.OwnerFile))Platform.StopOwnedTunnel();
          Application.Run(new MainWindow(uri));return 0;
        }catch(Exception){MessageBox.Show("Windows could not prepare secure VPN storage or confirm an earlier tunnel stopped. Open WireGuard and stop UFIConnectManaged before trying again.","UFIConnect VPN");return 1;}
      }
    }
  }
  internal sealed class MainWindow : Form {
    private readonly Controller controller=new Controller();
    private readonly LaunchInbox inbox=new LaunchInbox();
    private readonly TextBox email=new TextBox(),password=new TextBox();
    private readonly Label status=new Label();
    private readonly Button login=new Button(),connect=new Button(),disconnect=new Button(),logout=new Button();
    private readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer{Interval=1000};
    private LaunchPipe pipe;
    private Task listener;
    private bool busy,ticking,closing,closed,pipeFailed;
    internal MainWindow(string initialUri){
      Text="UFIConnect VPN";ClientSize=new Size(540,650);MinimumSize=new Size(556,689);MaximumSize=new Size(740,780);
      BackColor=Color.FromArgb(18,24,33);ForeColor=Color.White;Font=new Font("Segoe UI",10);StartPosition=FormStartPosition.CenterScreen;
      Controls.Add(new Label{Text="UFIConnect VPN",Font=new Font("Segoe UI",22,FontStyle.Bold),AutoSize=true,Location=new Point(28,24)});
      Controls.Add(new Label{Text="Connect with your paid UFI Vault membership.",AutoSize=true,Location=new Point(30,78)});
      Controls.Add(new Label{Text="Your private tunnel key stays on this device. UFIConnect uses your account, public key, device label, and short-lived authorization to run the VPN. Hosting providers process traffic to deliver it. VPN activity is not sold, used for advertising or AI training, or collected by app analytics.",Location=new Point(30,112),Size=new Size(480,112),ForeColor=Color.LightGray});
      Controls.Add(new Label{Text="Email",AutoSize=true,Location=new Point(30,237)});email.SetBounds(30,264,480,30);email.AccessibleName="UFIConnect email";Controls.Add(email);
      Controls.Add(new Label{Text="Password",AutoSize=true,Location=new Point(30,304)});password.SetBounds(30,331,480,30);password.UseSystemPasswordChar=true;password.AccessibleName="UFIConnect password";Controls.Add(password);
      Configure(login,"Sign in",30,380,110);Configure(connect,"Connect",150,380,110);Configure(disconnect,"Disconnect",270,380,110);Configure(logout,"Sign out",390,380,120);
      status.SetBounds(30,439,480,78);status.Text=controller.Message;status.AccessibleName="VPN connection status";Controls.Add(status);
      Controls.Add(new Label{Text="Closing stops VPN and keeps your encrypted sign-in.\nSign out removes this device's saved sign-in.\nKeep this window open while connected. IPv6 is blocked.\nRequires official WireGuard and administrator access.",Location=new Point(30,536),Size=new Size(480,96),ForeColor=Color.LightGray});
      login.Click+=async(sender,args)=>await Action(async()=>{var secret=password.Text;password.Clear();await controller.Login(email.Text.Trim(),secret);});
      connect.Click+=async(sender,args)=>await Action(()=>controller.Connect());
      disconnect.Click+=async(sender,args)=>{inbox.Clear();await Action(()=>controller.Disconnect());};
      logout.Click+=async(sender,args)=>{inbox.Clear();await Action(()=>controller.Logout());};
      Shown+=(sender,args)=>{
        pipe=new LaunchPipe(value=>{
          if(closing||closed)throw new InvalidOperationException();
          BeginInvoke(new System.Action(()=>Receive(value)));
        });
        listener=pipe.Start();Receive(initialUri);
      };
      timer.Tick+=async(sender,args)=>{
        if(ticking||closed||closing)return;ticking=true;
        try{
          await controller.Tick();
          if(listener!=null&&listener.IsFaulted&&!pipeFailed){var ignored=listener.Exception;pipeFailed=true;controller.Message="Browser requests are unavailable. Close and reopen UFIConnect VPN to try again.";}
        }catch{if(controller.Active)controller.Message="Waiting for a verified VPN handshake. Authorization remains time limited.";}
        finally{ticking=false;if(!closed)RefreshState();}
      };
      FormClosing+=async(sender,args)=>{
        if(closed)return;args.Cancel=true;if(closing)return;closing=true;Enabled=false;inbox.Clear();
        try{await controller.Disconnect();closed=true;timer.Stop();if(pipe!=null)pipe.Dispose();controller.Dispose();Close();}
        catch{closing=false;Enabled=true;MessageBox.Show("Windows could not confirm the VPN stopped. Stop UFIConnectManaged in WireGuard, then close this window.","VPN still stopping");}
      };
      timer.Start();RefreshState();
    }
    private async void Receive(string uri){
      if(closing||closed)return;
      if(WindowState==FormWindowState.Minimized)WindowState=FormWindowState.Normal;Activate();
      if(uri.Length==0)return;
      try{
        if(!inbox.Receive(uri,controller.AccountId,DateTime.UtcNow)){controller.Message="This connection link was already received. Request a new link in UFIConnect.";RefreshState();return;}
        if(!controller.SignedIn){controller.Message="Sign in with the same UFIConnect account used in your browser to finish connecting.";RefreshState();return;}
        await Action(ProcessPending);
      }catch{controller.Message="This VPN connection link is invalid. Request a new link in UFIConnect.";RefreshState();}
    }
    private async Task ProcessPending(){
      var code=inbox.Take(controller.AccountId,DateTime.UtcNow);
      if(code!=null)await controller.ConsumeLaunch(code);
      else controller.Message="The connection link expired or belongs to an earlier sign-in. Click Connect in UFIConnect again.";
    }
    private void Configure(Button button,string text,int x,int y,int width){button.Text=text;button.SetBounds(x,y,width,36);button.BackColor=Color.FromArgb(33,110,211);button.ForeColor=Color.White;button.FlatStyle=FlatStyle.Flat;Controls.Add(button);}
    private async Task Action(Func<Task> action){
      if(busy||closing||closed)return;busy=true;RefreshState();
      try{
        bool expired=false;
        try{await action();}
        catch(ApiError error){expired=error.Status==401;controller.Message=error.Message;}
        catch(InvalidOperationException error){controller.Message=error.Message;}
        catch{controller.Message="VPN could not complete this request. Check your connection and try again.";}
        if(expired){
          inbox.Clear();
          try{controller.ForgetSession();await controller.Disconnect();controller.Message="Your sign-in expired. Sign in again, then request a new connection link.";}
          catch{controller.Message="Sign-in expired. Stop UFIConnectManaged in WireGuard before signing in again.";}
        }
      }
      finally{
        busy=false;if(!closed)RefreshState();
        if(inbox.Pending&&controller.SignedIn&&!closing&&!closed)BeginInvoke(new System.Action(async()=>await Action(ProcessPending)));
      }
    }
    private void RefreshState(){status.Text=controller.Message;login.Enabled=!busy&&!controller.SignedIn;email.Enabled=login.Enabled;password.Enabled=login.Enabled;connect.Enabled=!busy&&controller.SignedIn&&!controller.Active;disconnect.Enabled=!busy&&controller.Active;logout.Enabled=!busy&&controller.SignedIn;}
  }
}
