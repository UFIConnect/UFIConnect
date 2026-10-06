package org.uficonnect.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.SystemClock
import android.os.Handler
import android.os.Looper
import com.wireguard.android.backend.GoBackend
import com.wireguard.android.backend.Tunnel
import com.wireguard.crypto.Key
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

internal object VpnRuntime {
  val executor = Executors.newSingleThreadScheduledExecutor()
  var backend: GoBackend? = null
  var lease: VpnLease? = null
  @Volatile var deadline: Long = 0
  @Volatile var state = "down"
  val generation = AtomicLong(0)
  @Volatile var renewalConnection: HttpURLConnection? = null
  var service: UfiVpnService? = null
  var renewal: ScheduledFuture<*>? = null
  val tunnel = object: Tunnel {
    override fun getName() = "UFIConnect"
    override fun onStateChange(value: Tunnel.State) { state = if (value == Tunnel.State.UP) "up" else "down" }
  }
  fun status(): Map<String, Any?> {
    val active = backend?.getState(tunnel) == Tunnel.State.UP
    val handshake = if (active) backend?.getStatistics(tunnel)?.let { stats -> stats.peers().maxOfOrNull { stats.peer(it)?.latestHandshakeEpochMillis() ?: 0L } } ?: 0L else 0L
    return mapOf("supported" to true, "tunnelState" to if (active) "up" else state, "lastHandshakeAt" to handshake,
      "deviceId" to lease?.id, "leaseExpiresAt" to lease?.json?.optString("leaseExpiresAt"))
  }
  fun stop(context: Context) {
    generation.incrementAndGet(); renewalConnection?.disconnect(); renewal?.cancel(false); renewal = null
    state = "stopping"
    try { backend?.setState(tunnel, Tunnel.State.DOWN, null) }
    finally {
      lease = null; deadline = 0; VpnSecrets.clear(context)
      service?.stopForeground(android.app.Service.STOP_FOREGROUND_REMOVE); service?.stopSelf()
      state = if (backend?.getState(tunnel) == Tunnel.State.UP) "stopping" else "down"
    }
  }
  fun renew(context: Context) {
    val current = lease ?: return
    if (SystemClock.elapsedRealtime() >= deadline) { stop(context); return }
    val attempt = generation.get()
    try {
      val stored = VpnSecrets.read(context)
      val token = stored.getString("session")
      val connection = URL("https://api.uficonnect.org/vpn/devices").openConnection() as HttpURLConnection
      renewalConnection = connection
      connection.instanceFollowRedirects = false; connection.connectTimeout = 15000; connection.readTimeout = 15000
      connection.requestMethod = "POST"; connection.doOutput = true; connection.setRequestProperty("Authorization", "Bearer $token")
      connection.setRequestProperty("Content-Type", "application/json")
      try {
        connection.outputStream.use { it.write(JSONObject().put("publicKey", current.publicKey).put("gatewayId", current.gateway).put("label", "UFIConnect Android").toString().toByteArray(Charsets.UTF_8)) }
        if (connection.responseCode in listOf(401,403,409)) { stop(context); return }
        check(connection.responseCode in listOf(200,201))
        val bytes = connection.inputStream.use { input ->
          val output = ByteArrayOutputStream(); val buffer = ByteArray(2048)
          while (true) { val count = input.read(buffer); if (count == -1) break; check(output.size() + count <= 65536); output.write(buffer, 0, count) }
          output.toByteArray()
        }
        val response = JSONObject(String(bytes, Charsets.UTF_8)); check(response.getString("state") == "enrolled")
        val next = VpnLease(response.getJSONObject("device"), Key.fromBase64(stored.getString("privateKey")))
        check(next.id == current.id && next.gateway == current.gateway)
        if (generation.get() != attempt) return
        val changed = listOf("addresses", "endpoint", "serverPublicKey", "dns", "allowedIPs").any { current.json.get(it).toString() != next.json.get(it).toString() }
        if (changed) backend?.setState(tunnel, Tunnel.State.UP, next.config)
        if (generation.get() != attempt) { backend?.setState(tunnel, Tunnel.State.DOWN, null); return }
        lease = next; deadline = SystemClock.elapsedRealtime() + next.expires - System.currentTimeMillis()
        stored.put("lease", next.json); VpnSecrets.write(context, stored)
      } finally { connection.disconnect(); if (renewalConnection === connection) renewalConnection = null }
    } catch (_: Exception) {
      if (SystemClock.elapsedRealtime() >= deadline) stop(context)
    }
  }
}

class UfiVpnService: GoBackend.VpnService() {
  private val watchdog = Handler(Looper.getMainLooper())
  private val checkExpiry = object: Runnable {
    override fun run() {
      if (VpnRuntime.deadline > 0 && SystemClock.elapsedRealtime() >= VpnRuntime.deadline) {
        VpnRuntime.generation.incrementAndGet(); VpnRuntime.renewalConnection?.disconnect()
        stopSelf() // Independent of a blocked renewal request; closes the OS tunnel in onDestroy.
      } else watchdog.postDelayed(this, 1000)
    }
  }
  override fun onCreate() {
    super.onCreate()
    VpnRuntime.service = this
    watchdog.post(checkExpiry)
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel("ufi-vpn", "UFIConnect VPN", NotificationManager.IMPORTANCE_LOW))
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, "ufi-vpn") else Notification.Builder(this)
    val notification = builder.setContentTitle("UFIConnect VPN")
      .setContentText("VPN session active. Open UFIConnect to view connection status or disconnect.")
      .setSmallIcon(android.R.drawable.ic_lock_lock).setOngoing(true)
    if (launch != null) notification.setContentIntent(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
    if (Build.VERSION.SDK_INT >= 34) startForeground(8401, notification.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED)
    else startForeground(8401, notification.build())
  }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action != "org.uficonnect.vpn.START") { stopSelf(); return START_NOT_STICKY }
    val attempt = intent.getLongExtra("generation", -1)
    VpnRuntime.executor.execute {
      if (attempt != VpnRuntime.generation.get()) { stopSelf(); return@execute }
      try {
        val stored = VpnSecrets.read(this)
        val lease = VpnLease(stored.getJSONObject("lease"), Key.fromBase64(stored.getString("privateKey")))
        if (VpnRuntime.backend == null) VpnRuntime.backend = GoBackend(applicationContext)
        VpnRuntime.backend!!.setState(VpnRuntime.tunnel, Tunnel.State.UP, lease.config)
        if (attempt != VpnRuntime.generation.get()) { VpnRuntime.stop(applicationContext); return@execute }
        VpnRuntime.lease = lease; VpnRuntime.deadline = SystemClock.elapsedRealtime() + lease.expires - System.currentTimeMillis()
        VpnRuntime.renewal?.cancel(false)
        VpnRuntime.renewal = VpnRuntime.executor.scheduleWithFixedDelay({ VpnRuntime.renew(applicationContext) }, 30, 30, TimeUnit.SECONDS)
      } catch (_: Exception) { VpnRuntime.stop(applicationContext) }
    }
    return START_NOT_STICKY
  }
  override fun onRevoke() { VpnRuntime.generation.incrementAndGet(); VpnRuntime.renewalConnection?.disconnect(); VpnRuntime.executor.execute { VpnRuntime.stop(applicationContext) }; super.onRevoke() }
  override fun onDestroy() { watchdog.removeCallbacksAndMessages(null); VpnRuntime.generation.incrementAndGet(); VpnRuntime.renewalConnection?.disconnect(); VpnRuntime.renewal?.cancel(false); VpnRuntime.service = null; super.onDestroy(); VpnRuntime.state = "down" }
}
